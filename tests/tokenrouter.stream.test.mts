// Parsing TokenRouter's OpenAI-style SSE.
//
// This upstream is a third-party gateway on a free tier with no published
// contract, so the parser has to survive frames the spec never promised: vendor
// keepalives, `event:` lines, missing `[DONE]`, and an error object arriving
// after a 200. Each case below is one of those.

import { tokenRouterDeltas, tokenRouterText, TokenRouterError } from "../lib/tokenrouter.ts";

let passed = 0;
let failed = 0;
function check(name: string, cond: boolean, detail = "") {
  if (cond) {
    passed++;
  } else {
    failed++;
    console.error(`  FAIL: ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

/** A Response whose body streams `chunks`, split exactly as given. */
function sse(chunks: string[]): Response {
  const encoder = new TextEncoder();
  return new Response(
    new ReadableStream({
      start(c) {
        for (const ch of chunks) c.enqueue(encoder.encode(ch));
        c.close();
      },
    })
  );
}

const frame = (content: string) => `data: ${JSON.stringify({ choices: [{ delta: { content } }] })}\n\n`;

async function collect(res: Response): Promise<string> {
  let out = "";
  for await (const d of tokenRouterDeltas(res)) out += d.text;
  return out;
}

// 1. The ordinary case.
{
  const out = await collect(sse([frame("Hello"), frame(" world"), "data: [DONE]\n\n"]));
  check("plain stream concatenates", out === "Hello world", JSON.stringify(out));
}

// 2. A frame split across chunk boundaries. Network reads land anywhere, and
//    parsing per-chunk would drop or corrupt the frame that straddles one.
{
  const f = frame("split me");
  const mid = Math.floor(f.length / 2);
  const out = await collect(sse([f.slice(0, mid), f.slice(mid)]));
  check("frame split across chunks survives", out === "split me", JSON.stringify(out));
}

// 3. Multi-byte characters split mid-codepoint. Decoding each chunk
//    independently would produce a replacement character here.
{
  const f = frame("héllo → 世界");
  const bytes = new TextEncoder().encode(f);
  const cut = 12; // lands inside a multi-byte sequence
  const res = new Response(
    new ReadableStream({
      start(c) {
        c.enqueue(bytes.slice(0, cut));
        c.enqueue(bytes.slice(cut));
        c.close();
      },
    })
  );
  const out = await collect(res);
  check("multi-byte split mid-codepoint survives", out === "héllo → 世界", JSON.stringify(out));
}

// 4. Not every gateway sends [DONE]; the body simply ending must terminate.
{
  const out = await collect(sse([frame("no sentinel")]));
  check("missing [DONE] still terminates", out === "no sentinel", JSON.stringify(out));
}

// 5. Noise between frames. A keepalive comment or an `event:` line must not
//    break a reply that is otherwise streaming fine.
{
  const out = await collect(sse([": keepalive\n\n", "event: ping\n\n", frame("after noise"), "\n"]));
  check("comments and event lines ignored", out === "after noise", JSON.stringify(out));
}

// 6. An unparseable data frame is skipped rather than thrown: one bad frame
//    should not destroy the whole answer.
{
  const out = await collect(sse([frame("a"), "data: {not json\n\n", frame("b")]));
  check("malformed frame skipped", out === "ab", JSON.stringify(out));
}

// 7. Frames carrying no content (role openers, empty deltas) yield nothing.
{
  const roleOnly = `data: ${JSON.stringify({ choices: [{ delta: { role: "assistant" } }] })}\n\n`;
  const out = await collect(sse([roleOnly, frame("only text")]));
  check("contentless frames yield nothing", out === "only text", JSON.stringify(out));
}

// 8. An error after a 200 is the one case worth interrupting for: continuing
//    would hand back a silently truncated answer.
{
  let threw: unknown = null;
  try {
    await collect(sse([frame("partial"), `data: ${JSON.stringify({ error: { message: "rate limited" } })}\n\n`]));
  } catch (e) {
    threw = e;
  }
  check("mid-stream error throws", threw instanceof TokenRouterError, String(threw));
  check("mid-stream error keeps upstream message", String((threw as Error)?.message).includes("rate limited"));
}

// 9. The buffered path reads the reply straight out of the OpenAI envelope.
{
  check("buffered text extracted", tokenRouterText({ choices: [{ message: { content: "buffered" } }] }) === "buffered");
  check("buffered missing content is empty", tokenRouterText({ choices: [{}] }) === "");
  check("buffered garbage is empty", tokenRouterText(null) === "");
  // A content array (some gateways return parts) is not a string, and must not
  // be stringified into "[object Object]" in the reply.
  check("non-string content is empty", tokenRouterText({ choices: [{ message: { content: [{ text: "x" }] } }] }) === "");
}

console.log(`tokenrouter.stream: ${passed} passed, ${failed} failed`);
if (failed) process.exit(1);

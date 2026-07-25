// The DeepSeek completion stream is a JSON-patch protocol, not choices[].delta:
// a snapshot of typed fragments (THINK = reasoning, RESPONSE = answer), then
// patches that append to a fragment by path, then bare {v} continuations that
// append to whichever fragment was last touched.
//
// Terminating promptly matters beyond tidiness: the caller deletes the chat
// session as soon as this generator returns, so a missed terminator leaves a
// user's conversation sitting in the account until the socket drops.

import { deepseekDeltas, DeepSeekError } from "../lib/deepseek.ts";

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

/** Feed raw SSE text through the parser, optionally split into fixed-size chunks. */
async function collect(sse: string, chunkSize = 0) {
  const bytes = new TextEncoder().encode(sse);
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      if (chunkSize <= 0) {
        controller.enqueue(bytes);
      } else {
        for (let i = 0; i < bytes.length; i += chunkSize) controller.enqueue(bytes.slice(i, i + chunkSize));
      }
      controller.close();
    },
  });
  const out: { kind: string; text: string }[] = [];
  for await (const d of deepseekDeltas(new Response(stream) as any)) out.push(d);
  return out;
}

const joined = (out: { kind: string; text: string }[], kind: string) =>
  out.filter((d) => d.kind === kind).map((d) => d.text).join("");

// A representative exchange: reasoning first, then the answer, then the trailer.
const SNAPSHOT = `data: {"v":{"response":{"fragments":[{"type":"THINK","content":"Let me "}]}}}`;
const THINK_MORE = `data: {"p":"response/fragments/0/content","v":"think."}`;
const NEW_FRAG = `data: {"p":"response/fragments","o":"APPEND","v":[{"type":"RESPONSE","content":"Hi"}]}`;
const BARE = `data: {"v":" there"}`;

// 1. Fragments route to the right channel, and bare {v} follows the last one.
{
  const out = await collect([SNAPSHOT, THINK_MORE, NEW_FRAG, BARE, ""].join("\n"));
  check("reasoning is assembled in order", joined(out, "thinking") === "Let me think.", joined(out, "thinking"));
  check("answer is assembled in order", joined(out, "answer") === "Hi there", joined(out, "answer"));
  check("reasoning never leaks into the answer", !joined(out, "answer").includes("think"));
}

// 2. The same bytes arriving one at a time must parse identically — a frame
//    split mid-JSON is normal on a real socket.
{
  const sse = [SNAPSHOT, THINK_MORE, NEW_FRAG, BARE, ""].join("\n");
  const whole = await collect(sse);
  const drip = await collect(sse, 1);
  check("byte-at-a-time parses identically", JSON.stringify(drip) === JSON.stringify(whole), JSON.stringify(drip));
}

// 3. `event: close` ends the stream — anything after it is not ours to read.
{
  const out = await collect(
    [SNAPSHOT, NEW_FRAG, "event: close", `data: {}`, `data: {"v":"AFTER"}`, ""].join("\n")
  );
  check("close terminates", !joined(out, "answer").includes("AFTER"), joined(out, "answer"));
}

// 4. So does the FINISHED batch, which arrives while the connection stays open.
{
  const out = await collect(
    [
      SNAPSHOT,
      NEW_FRAG,
      `data: {"o":"BATCH","v":[{"p":"elapsed_secs","v":2},{"p":"quasi_status","v":"FINISHED"}]}`,
      `data: {"v":"AFTER"}`,
      "",
    ].join("\n")
  );
  check("FINISHED batch terminates", !joined(out, "answer").includes("AFTER"), joined(out, "answer"));
  check("content before FINISHED is kept", joined(out, "answer") === "Hi");
}

// 5. A BATCH that is not finished must not end the stream early.
{
  const out = await collect(
    [SNAPSHOT, NEW_FRAG, `data: {"o":"BATCH","v":[{"p":"elapsed_secs","v":1}]}`, BARE, ""].join("\n")
  );
  check("non-final BATCH keeps streaming", joined(out, "answer") === "Hi there", joined(out, "answer"));
}

// 6. Housekeeping events carry no answer text and must not be emitted.
{
  const out = await collect(
    [
      "event: ready",
      `data: {"v":"IGNORED"}`,
      "event: title",
      `data: {"v":"Some chat title"}`,
      "event: update_session",
      `data: {"v":"IGNORED"}`,
      SNAPSHOT,
      NEW_FRAG,
      "",
    ].join("\n")
  );
  check("ready/title/update_session are dropped", joined(out, "answer") === "Hi", joined(out, "answer"));
  check("a chat title never reaches the caller", !JSON.stringify(out).includes("Some chat title"));
}

// 7. [DONE] still terminates.
{
  const out = await collect([SNAPSHOT, NEW_FRAG, "data: [DONE]", `data: {"v":"AFTER"}`, ""].join("\n"));
  check("[DONE] terminates", joined(out, "answer") === "Hi", joined(out, "answer"));
}

// 8. An error frame surfaces as an error rather than a truncated answer.
{
  let caught: unknown = null;
  try {
    await collect([SNAPSHOT, `data: {"error":{"message":"rate limited"}}`, ""].join("\n"));
  } catch (e) {
    caught = e;
  }
  check("stream error throws", caught instanceof DeepSeekError, String(caught));
  check("stream error keeps the reason", String((caught as Error)?.message || "").includes("rate limited"));
}

// 9. Malformed JSON is skipped, not fatal — one bad frame shouldn't kill a reply.
{
  const out = await collect([SNAPSHOT, "data: {not json", NEW_FRAG, BARE, ""].join("\n"));
  check("unparseable frame is skipped", joined(out, "answer") === "Hi there", joined(out, "answer"));
}

console.log(`${passed} passed, ${failed} failed`);
if (failed) process.exit(1);

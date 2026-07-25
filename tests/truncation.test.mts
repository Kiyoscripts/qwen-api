// A severed upstream stream must be reported as truncated, not as a finished
// reply — and, just as importantly, a finished one must NOT be.
//
// These frames are copied from a real capture of chat.qwen.ai. Qwen does not
// send a [DONE] sentinel; it closes with delta.status === "finished". An earlier
// version of this file invented [DONE]-terminated fixtures, so it passed while
// production marked every single reply truncated. Fixtures have to come from the
// wire, not from what the protocol ought to look like.

import { qwenDeltas, type StreamStatus } from "../lib/qwen";

function sseResponse(chunks: string[]): Response {
  const enc = new TextEncoder();
  return new Response(
    new ReadableStream({
      start(c) {
        for (const ch of chunks) c.enqueue(enc.encode(ch));
        c.close();
      },
    })
  );
}

const delta = (t: string) =>
  `data: ${JSON.stringify({ choices: [{ delta: { role: "assistant", content: t, phase: "answer", status: "typing" } }] })}\n\n`;
/** The real closing frame: empty content, status "finished". */
const finished = () =>
  `data: ${JSON.stringify({ choices: [{ delta: { content: "", role: "assistant", status: "finished", phase: "answer" } }] })}\n\n`;
/** Qwen reports token counts on the closing frames. */
const withUsage = (t: string) =>
  `data: ${JSON.stringify({ choices: [{ delta: { role: "assistant", content: t, phase: "answer", status: "typing" } }], usage: { input_tokens: 96, output_tokens: 28, total_tokens: 124 } })}\n\n`;

let pass = 0, fail = 0;
const note = (ok: boolean, name: string, detail = "") => {
  if (ok) pass++;
  else { fail++; console.error(`✗ ${name}${detail ? " — " + detail : ""}`); }
};

async function collect(res: Response) {
  const st: StreamStatus = { complete: false };
  let text = "";
  for await (const d of qwenDeltas(res, st)) text += d.text;
  return { text, st };
}

// 1. Clean finish, exactly as Qwen ends a stream.
{
  const { text, st } = await collect(sseResponse([delta("Hello "), delta("world."), finished()]));
  note(text === "Hello world.", "clean stream keeps its text", text);
  note(st.complete === true, "status:finished reports complete");
}

// 1b. The [DONE] fallback still works if it ever appears.
{
  const { st } = await collect(sseResponse([delta("x"), "data: [DONE]\n\n"]));
  note(st.complete === true, "[DONE] fallback still reports complete");
}

// 1c. Token counts are picked up off the wire.
{
  const { st } = await collect(sseResponse([withUsage("hi"), finished()]));
  note(st.usage?.total_tokens === 124, "usage captured", JSON.stringify(st.usage));
  note(st.usage?.completion_tokens === 28, "completion tokens captured");
}

// 2. Severed mid-reply — no [DONE].
{
  const { text, st } = await collect(sseResponse([delta("The answer is "), delta("forty-t")]));
  note(text === "The answer is forty-t", "severed stream keeps the partial", text);
  note(st.complete === false, "severed stream reports incomplete");
}

// 3. Severed on a chunk boundary, mid-SSE-frame.
{
  const { st } = await collect(sseResponse([delta("a"), 'data: {"choices":[{"delta":{"con']));
  note(st.complete === false, "half-written frame reports incomplete");
}

// 4. Empty body.
{
  const { text, st } = await collect(sseResponse([]));
  note(text === "" && st.complete === false, "empty stream reports incomplete");
}

// 5. Status is optional — the old call signature must still work.
{
  let text = "";
  for await (const d of qwenDeltas(sseResponse([delta("x"), finished()]))) text += d.text;
  note(text === "x", "works without a status object");
}

// 6. The regression this file exists for: a normal reply must not be flagged.
{
  const { st } = await collect(sseResponse([delta("Say "), delta("hello"), finished()]));
  note(st.complete === true, "a completed reply is NOT reported as truncated");
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

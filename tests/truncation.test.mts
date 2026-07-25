// A severed upstream stream must be reported as truncated, not as a finished
// reply. Feeds qwenDeltas synthetic SSE bodies: one that ends properly with
// [DONE], one that just stops — which is what the 300s function cap looks like.

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

const delta = (t: string) => `data: ${JSON.stringify({ choices: [{ delta: { content: t, phase: "answer" } }] })}\n\n`;

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

// 1. Clean finish.
{
  const { text, st } = await collect(sseResponse([delta("Hello "), delta("world."), "data: [DONE]\n\n"]));
  note(text === "Hello world.", "clean stream keeps its text", text);
  note(st.complete === true, "clean stream reports complete");
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
  for await (const d of qwenDeltas(sseResponse([delta("x"), "data: [DONE]\n\n"]))) text += d.text;
  note(text === "x", "works without a status object");
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

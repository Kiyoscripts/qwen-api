// Parsing OpenCode Zen's OpenAI-style SSE, including reasoning_content.
//
// Big Pickle streams a long think phase as reasoning_content before content.
// The parser must surface both kinds, survive frame splits, and not die on a
// single malformed keepalive.

import {
  openCodeZenDeltas,
  openCodeZenText,
  OpenCodeZenError,
  OPENCODE_ZEN_MODELS,
} from "../lib/opencodezen.ts";

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

const contentFrame = (content: string) =>
  `data: ${JSON.stringify({ choices: [{ delta: { content } }] })}\n\n`;
const reasonFrame = (reasoning_content: string) =>
  `data: ${JSON.stringify({ choices: [{ delta: { reasoning_content } }] })}\n\n`;

async function collect(res: Response): Promise<{ text: string; reasoning: string }> {
  let text = "";
  let reasoning = "";
  for await (const d of openCodeZenDeltas(res)) {
    if (d.kind === "reasoning") reasoning += d.text;
    else text += d.text;
  }
  return { text, reasoning };
}

// 1. Content-only stream.
{
  const out = await collect(sse([contentFrame("Hello"), contentFrame(" world"), "data: [DONE]\n\n"]));
  check("plain stream concatenates", out.text === "Hello world", JSON.stringify(out));
}

// 2. Reasoning then content (Big Pickle shape).
{
  const out = await collect(
    sse([reasonFrame("think"), reasonFrame("ing"), contentFrame("done"), "data: [DONE]\n\n"])
  );
  check("reasoning then content", out.reasoning === "thinking" && out.text === "done", JSON.stringify(out));
}

// 3. Frame split across chunks.
{
  const f = contentFrame("split me");
  const mid = Math.floor(f.length / 2);
  const out = await collect(sse([f.slice(0, mid), f.slice(mid)]));
  check("frame split across chunks survives", out.text === "split me", JSON.stringify(out));
}

// 4. Missing [DONE].
{
  const out = await collect(sse([contentFrame("no sentinel")]));
  check("missing [DONE] still terminates", out.text === "no sentinel", JSON.stringify(out));
}

// 5. Noise between frames.
{
  const out = await collect(sse([": keepalive\n\n", "event: ping\n\n", contentFrame("after noise"), "\n"]));
  check("comments and event lines ignored", out.text === "after noise", JSON.stringify(out));
}

// 6. Malformed frame skipped.
{
  const out = await collect(sse([contentFrame("a"), "data: {not json\n\n", contentFrame("b")]));
  check("malformed frame skipped", out.text === "ab", JSON.stringify(out));
}

// 7. Mid-stream error interrupts.
{
  let threw = false;
  try {
    await collect(
      sse([
        contentFrame("partial"),
        `data: ${JSON.stringify({ error: { message: "boom" } })}\n\n`,
        contentFrame("should not appear"),
      ])
    );
  } catch (e: any) {
    threw = e instanceof OpenCodeZenError && e.message.includes("boom");
  }
  check("mid-stream error throws OpenCodeZenError", threw);
}

// 8. Non-streaming envelope.
{
  const { content, reasoning } = openCodeZenText({
    choices: [{ message: { content: "hi", reasoning_content: "why" } }],
  });
  check("openCodeZenText content", content === "hi");
  check("openCodeZenText reasoning", reasoning === "why");
}

// 9. DeepSeek V4 Flash has two routes, because OneCompiler's runs into a daily
//    cap and Zen's is what you switch to when it does. They must stay distinct
//    ids — one registry claiming the other's id would make the fallback
//    unreachable, which is the entire point of having it.
{
  const zen = OPENCODE_ZEN_MODELS.find((m) => m.id === "deepseek/deepseek-v4-flash-zen");
  check("the Zen route exists", Boolean(zen), JSON.stringify(OPENCODE_ZEN_MODELS.map((m) => m.id)));
  check("it points at Zen's free slug", zen?.upstreamId === "deepseek-v4-flash-free", String(zen?.upstreamId));
  check("it keeps the effort ladder", zen?.reasoningEffort?.length === 3, JSON.stringify(zen?.reasoningEffort));
  check(
    "it does not claim OneCompiler's id",
    !OPENCODE_ZEN_MODELS.some((m) => m.id === "deepseek/deepseek-v4-flash"),
    "Zen must not shadow the OneCompiler route"
  );
  check("no public id says free", !OPENCODE_ZEN_MODELS.some((m) => /free/i.test(m.id) || /free/i.test(m.name)));
}

console.log(`opencodezen.stream: ${passed} passed, ${failed} failed`);
if (failed) process.exit(1);

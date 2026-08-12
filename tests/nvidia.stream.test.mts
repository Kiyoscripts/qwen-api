// NVIDIA NIM: SSE parsing, the reasoning switch, and the error envelope.
//
// The two things worth pinning down are the ones that are NOT the usual OpenAI
// shape: reasoning is chat_template_kwargs.enable_thinking (a `thinking` key is
// silently ignored upstream, which is a bug that looks like a working request),
// and errors arrive as {status,title,detail} rather than {error:{message}}.

import {
  nvidiaDeltas,
  nvidiaText,
  thinkingKwargs,
  isNvidiaModel,
  resolveNvidiaModel,
  NvidiaError,
  NVIDIA_MODELS,
} from "../lib/nvidia.ts";

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
  for await (const d of nvidiaDeltas(res)) {
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

// 2. Reasoning then content — GLM-5.2's shape with thinking on.
{
  const out = await collect(
    sse([reasonFrame("work"), reasonFrame("ing"), contentFrame("144"), "data: [DONE]\n\n"])
  );
  check("reasoning kept apart from text", out.reasoning === "working" && out.text === "144", JSON.stringify(out));
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

// 7. Mid-stream error interrupts rather than truncating silently.
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
    threw = e instanceof NvidiaError && e.message.includes("boom");
  }
  check("mid-stream error throws NvidiaError", threw);
}

// 8. Non-streaming envelope.
{
  const { content, reasoning } = nvidiaText({
    choices: [{ message: { content: "hi", reasoning_content: "why" } }],
  });
  check("nvidiaText content", content === "hi");
  check("nvidiaText reasoning", reasoning === "why");
  // A reasoning-only reply that hit the token cap has content:null.
  const capped = nvidiaText({ choices: [{ message: { content: null, reasoning_content: "cut" } }] });
  check("null content is an empty string", capped.content === "" && capped.reasoning === "cut", JSON.stringify(capped));
}

// --- the reasoning switch ---------------------------------------------------
//
// `enable_thinking` is the key that works; `thinking` is ignored upstream. The
// pairing with clear_thinking is what build.nvidia.com's playground sends.

const glm = resolveNvidiaModel("z-ai/glm-5.2")!;

// 9. Default is on, matching the playground.
{
  const k = thinkingKwargs(glm, undefined);
  check("default reasoning is on", k?.enable_thinking === true && k?.clear_thinking === false, JSON.stringify(k));
}

// 10. Explicitly on.
{
  const k = thinkingKwargs(glm, true);
  check("enable_thinking true", k?.enable_thinking === true && k?.clear_thinking === false, JSON.stringify(k));
}

// 11. Off flips both fields — clear_thinking is what actually suppresses it.
{
  const k = thinkingKwargs(glm, false);
  check("enable_thinking false clears too", k?.enable_thinking === false && k?.clear_thinking === true, JSON.stringify(k));
}

// 12. A non-reasoning model must not receive the field at all.
{
  const k = thinkingKwargs({ id: "x/y", name: "Y" }, true);
  check("no kwargs for a non-reasoning model", k === undefined, JSON.stringify(k));
}

// --- registry ---------------------------------------------------------------

// 13. Ids are NVIDIA's own, so they pass through unrewritten.
{
  const m = resolveNvidiaModel("meta/muse-glimmer-30b");
  check("muse glimmer resolves", m?.name === "Muse Glimmer 30B", String(m?.name));
  check("public id is the upstream id", m?.id === "meta/muse-glimmer-30b");
  check("both models reason", NVIDIA_MODELS.every((x) => x.thinking === true));
  check("no public id says free", !NVIDIA_MODELS.some((x) => /free/i.test(x.id) || /free/i.test(x.name)));
}

// 14. Routing is gated on configuration: with no key set nothing is routable,
//     so an unconfigured deploy 404s the id instead of advertising a dead model.
{
  const configured = Boolean(process.env.NVIDIA_API_KEY);
  check(
    "isNvidiaModel follows configuration",
    isNvidiaModel("z-ai/glm-5.2") === configured,
    `configured=${configured}`
  );
  check("unknown ids are never routable", !isNvidiaModel("z-ai/glm-9.9"));
}

console.log(`nvidia.stream: ${passed} passed, ${failed} failed`);
if (failed) process.exit(1);

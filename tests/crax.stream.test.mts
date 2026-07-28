// crax-gpt is OpenAI-shaped, so the parser is thin — but two upstream behaviours
// make it easy to hang the caller, and both are pinned down here:
//
//  1. THE SOCKET STAYS OPEN AFTER `data: [DONE]`. Measured: 7.1s to the
//     terminator, then 90s of nothing until the client gave up. A reader that
//     drains to EOF blocks until timeout on EVERY request, so stopping at the
//     terminator is correctness, not tidiness. The test proves it by feeding a
//     stream that never closes.
//  2. IT ALWAYS STREAMS, even unasked. There is no JSON-object mode, so the
//     buffered path reassembles the same SSE frames and must agree with the
//     streaming one.
//
// Also guarded: ids are matched exactly (they are bare names like `gpt-5`, and a
// loose match would swallow ids belonging to Qwen or OneCompiler), and icons
// resolve to files that exist.

import {
  craxDeltas,
  isCraxModel,
  resolveCraxModel,
  craxIcon,
  CraxError,
  CRAX_MODELS,
} from "../lib/crax.ts";
import { ONECOMPILER_MODELS } from "../lib/onecompiler.ts";
import { modelIcon } from "../lib/modelIcons.ts";
import { existsSync } from "node:fs";

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

const frame = (delta: Record<string, unknown>, finish: string | null = null) =>
  `data: ${JSON.stringify({ choices: [{ index: 0, delta, finish_reason: finish }] })}\n\n`;

/** A Response whose body ends normally. */
function sse(raw: string, chunkSize = 0): Response {
  const bytes = new TextEncoder().encode(raw);
  return new Response(
    new ReadableStream<Uint8Array>({
      start(controller) {
        if (chunkSize <= 0) controller.enqueue(bytes);
        else for (let i = 0; i < bytes.length; i += chunkSize) controller.enqueue(bytes.slice(i, i + chunkSize));
        controller.close();
      },
    }),
    { headers: { "Content-Type": "text/event-stream" } }
  );
}

/**
 * A Response that emits `raw` and then NEVER closes — the real upstream's
 * behaviour. If the parser waits for EOF, awaiting this generator hangs forever.
 */
function sseNeverCloses(raw: string): { res: Response; cancelled: () => boolean } {
  let wasCancelled = false;
  const bytes = new TextEncoder().encode(raw);
  const res = new Response(
    new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(bytes);
      },
      pull() {
        // Never resolves: mimics a socket held open with no further data.
        return new Promise<void>(() => {});
      },
      cancel() {
        wasCancelled = true;
      },
    }),
    { headers: { "Content-Type": "text/event-stream" } }
  );
  return { res, cancelled: () => wasCancelled };
}

async function collect(res: Response) {
  const out: Array<{ kind: string; text: string }> = [];
  for await (const d of craxDeltas(res)) out.push(d);
  return out;
}
const textOf = (ds: Array<{ kind: string; text: string }>) =>
  ds.filter((d) => d.kind === "text").map((d) => d.text).join("");

console.log("crax stream + registry");

// --- 1. terminator handling (the hang) --------------------------------------
{
  const raw = frame({ role: "assistant" }) + frame({ content: "PROXY " }) + frame({ content: "TEST OK" }, "stop") + "data: [DONE]\n\n";
  const { res, cancelled } = sseNeverCloses(raw);

  const finished = await Promise.race([
    collect(res).then((ds) => ({ ok: true as const, ds })),
    new Promise<{ ok: false }>((r) => setTimeout(() => r({ ok: false }), 3000)),
  ]);

  check("returns on [DONE] without waiting for EOF", finished.ok, "parser hung on a socket that never closes");
  if (finished.ok) {
    check("content complete before terminator", textOf(finished.ds) === "PROXY TEST OK", JSON.stringify(textOf(finished.ds)));
  }
  check("cancels the reader on exit", cancelled(), "socket left open");
}

// Anything after [DONE] is not emitted, even if it arrives in the same chunk.
{
  const raw = frame({ content: "a" }) + "data: [DONE]\n\n" + frame({ content: "LEAKED" });
  const ds = await collect(sse(raw));
  check("ignores frames after [DONE]", textOf(ds) === "a", JSON.stringify(textOf(ds)));
}

// --- 2. chunking ------------------------------------------------------------
{
  const raw = frame({ content: "PROXY " }) + frame({ content: "TEST " }) + frame({ content: "OK" }) + "data: [DONE]\n\n";
  for (const size of [1, 3, 7, 16, 64]) {
    const ds = await collect(sse(raw, size));
    check(`reassembles at chunk size ${size}`, textOf(ds) === "PROXY TEST OK", JSON.stringify(textOf(ds)));
  }
}

// Multi-byte characters split across a read boundary must not become U+FFFD.
{
  const raw = frame({ content: "héllo → 世界 🎉" }) + "data: [DONE]\n\n";
  for (const size of [1, 2, 3, 5]) {
    const ds = await collect(sse(raw, size));
    check(`multi-byte intact at chunk size ${size}`, textOf(ds) === "héllo → 世界 🎉", JSON.stringify(textOf(ds)));
  }
}

// --- 3. frame handling ------------------------------------------------------
{
  // ": keepalive" comments appear in real bodies during the long waits.
  const ds = await collect(sse(": keepalive\n\n" + frame({ content: "x" }) + ": keepalive\n\n" + "data: [DONE]\n\n"));
  check("skips keepalive comments", textOf(ds) === "x", JSON.stringify(textOf(ds)));
}
{
  const ds = await collect(sse(frame({}) + frame({ content: "" }) + "data: [DONE]\n\n"));
  check("empty deltas emit nothing", ds.length === 0, JSON.stringify(ds));
}
{
  const ds = await collect(sse(frame({ reasoning_content: "think" }) + frame({ content: "say" }) + "data: [DONE]\n\n"));
  check("reasoning separated from content", ds.length === 2 && ds[0].kind === "reasoning" && ds[1].kind === "text");
}
{
  let threw: unknown = null;
  try {
    await collect(sse(`data: ${JSON.stringify({ error: { message: "upstream exploded" } })}\n\n`));
  } catch (e) {
    threw = e;
  }
  check("mid-stream error frame throws CraxError", threw instanceof CraxError);
  check("error keeps its message", (threw as CraxError)?.message === "upstream exploded");
}

// --- 4. registry ------------------------------------------------------------
{
  check("all 21 requested models present", CRAX_MODELS.length === 21, String(CRAX_MODELS.length));
  const ids = CRAX_MODELS.map((m) => m.id);
  check("ids are unique", new Set(ids).size === ids.length);

  for (const id of ["gpt-5", "gpt-5-6-sol", "claude-opus-5", "fable-5", "glm-5-2", "llama-3-3-70b-versatile"]) {
    check(`claims ${id}`, isCraxModel(id));
  }

  // Must not shadow another provider's registry, nor match loosely.
  for (const miss of [
    "qwen3.8-max-preview", // Qwen
    "openai/gpt-5.4-mini", // OneCompiler
    "gpt-5-nonexistent", // near-miss on a real prefix
    "gpt", // prefix only
    "",
  ]) {
    check(`does not claim ${JSON.stringify(miss)}`, !isCraxModel(miss));
  }

  // Nothing here may collide with the OneCompiler registry.
  const oc = new Set(ONECOMPILER_MODELS.map((m) => m.id));
  check("no overlap with OneCompiler ids", ids.every((id) => !oc.has(id)));

  check("unknown id resolves to null", resolveCraxModel("nope") === null);
  check("resolve returns the display name", resolveCraxModel("gpt-4o")?.name === "GPT-4o");
}

// --- 5. icons ---------------------------------------------------------------
{
  const missing = CRAX_MODELS.map((m) => craxIcon(m.id)).filter((i) => i && !existsSync(`public${i}`));
  check("every mapped icon exists in public/", missing.length === 0, missing.join(", "));

  const cases: Array<[string, string]> = [
    ["gpt-5-6-sol", "/openai.svg"],
    ["claude-opus-5", "/claude.svg"],
    ["fable-5", "/claude.svg"], // Fable is Anthropic's
    ["gemini-3-pro", "/gemini.svg"],
    ["deepseek-r1", "/deepseek.svg"],
    ["kimi-k2-6", "/kimi.svg"],
    ["glm-5-2", "/zai.svg"],
    ["llama-3-3-70b-versatile", "/meta.svg"],
  ];
  for (const [id, expected] of cases) check(`${id} -> ${expected}`, craxIcon(id) === expected, craxIcon(id));

  // Every model should get a real mark; a bare fallback would mean a gap.
  const unbranded = CRAX_MODELS.filter((m) => !craxIcon(m.id));
  check("no model falls back to a neutral chip", unbranded.length === 0, unbranded.map((m) => m.id).join(", "));

  // Regression: a bare id must never inherit the Qwen mark by accident. This was
  // the original bug — every crax model rendered as Qwen in the chat picker,
  // because that surface calls modelIcon() and only /models had been fixed.
  const wrongQwen = CRAX_MODELS.filter((m) => craxIcon(m.id) === "/qwen.svg");
  check("no model wears the Qwen mark", wrongQwen.length === 0, wrongQwen.map((m) => m.id).join(", "));

  // modelIcon() is shared with the chat picker, playground and OneCompiler, so
  // teaching it bare-id prefixes must not disturb what already worked.
  const shared: Array<[string, string]> = [
    // Namespaced ids keep resolving by maker, as before.
    ["openai/gpt-5.4-mini", "/openai.svg"],
    ["moonshotai/kimi-k2.6", "/kimi.svg"],
    ["xai/grok-4.3", "/grok.svg"],
    ["google/gemma-3.12b", "/gemini.svg"],
    ["deepseek/deepseek-v4-pro", "/deepseek.svg"],
    ["qwen/qwen3-coder-480b", "/qwen.svg"],
    // Bare Qwen ids still fall to the Qwen mark.
    ["qwen3.8-max-preview", "/qwen.svg"],
    ["qwen-image-3.0", "/qwen.svg"],
    // An unknown maker, and an unknown bare id, keep the default.
    ["acme/whatever", "/qwen.svg"],
    ["something-unheard-of", "/qwen.svg"],
  ];
  for (const [id, expected] of shared) {
    check(`modelIcon(${id}) -> ${expected}`, modelIcon(id) === expected, modelIcon(id));
  }
  check("modelIcon(undefined) is the default", modelIcon(undefined) === "/qwen.svg");

  // Every OneCompiler model must still resolve to a file that exists.
  const ocMissing = ONECOMPILER_MODELS.map((m) => modelIcon(m.id)).filter((i) => !existsSync(`public${i}`));
  check("OneCompiler icons all exist", ocMissing.length === 0, ocMissing.join(", "));
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) process.exit(1);

// Solar Chat's WebSocket protocol: frame parsing, and the request normalisation
// that keeps a run from being rejected before it starts.
//
// The upstream is strict in ways HTTP providers are not — a sequence gap means a
// lost frame, a system role is refused outright, a trailing assistant turn is an
// error — so these are the rules worth pinning down. The frames here are copies
// of ones the live service actually sent.

import {
  solarDeltas,
  emptySummary,
  toSolarMessages,
  resolveSolarEffort,
  sourcesFooter,
  isSolarModel,
  resolveSolarModel,
  SolarError,
  SOLAR_INSTANT,
  SOLAR_THINK,
  SOLAR_MODELS,
} from "../lib/solar.ts";

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

/** The frames a run produces, wrapped in the { type, seq, event } envelope. */
async function* run(...events: any[]): AsyncGenerator<any> {
  let seq = 0;
  for (const e of events) yield { type: "event", seq: ++seq, event: e };
}

async function* raw(...frames: any[]): AsyncGenerator<any> {
  for (const f of frames) yield f;
}

const complete = (extra: any = {}) => ({
  type: "complete",
  data: {
    message: { role: "assistant", content: "" },
    model: "solar-pro4",
    usage: { input_tokens: 100, output_tokens: 20, total_tokens: 120 },
    sources: [],
    stop_reason: "complete",
    ...extra,
  },
});

async function collect(frames: AsyncIterable<any>, summary = emptySummary()) {
  let text = "";
  let reasoning = "";
  for await (const d of solarDeltas(frames, summary)) {
    if (d.kind === "reasoning") reasoning += d.text;
    else text += d.text;
  }
  return { text, reasoning, summary };
}

// 1. Text deltas concatenate.
{
  const out = await collect(
    run({ type: "delta", content: "Hello" }, { type: "delta", content: " world" }, complete())
  );
  check("delta frames concatenate", out.text === "Hello world", JSON.stringify(out.text));
}

// 2. Thinking is kept apart from the answer (Think mode's shape).
{
  const out = await collect(
    run(
      { type: "thinking_delta", content: "let me " },
      { type: "thinking_delta", content: "think" },
      { type: "delta", content: "42" },
      complete()
    )
  );
  check("thinking is separate from text", out.reasoning === "let me think" && out.text === "42", JSON.stringify(out));
}

// 3. Frames the answer does not need are skipped, not rejected — a new event
//    type upstream must not break a run.
{
  const out = await collect(
    run(
      { type: "progress", phase: "model_call", label: "…" },
      { type: "metrics", ttft_ms: 800 },
      { type: "tool_call", name: "web_search", arguments: {} },
      { type: "tool_result", id: "call_1", name: "web_search", result: {} },
      { type: "something_new_upstream", content: "ignored" },
      { type: "delta", content: "answer" },
      complete()
    )
  );
  check("unrelated events ignored", out.text === "answer", JSON.stringify(out.text));
}

// 4. A sequence gap means a dropped frame, so the answer is not silently short.
{
  let threw = false;
  try {
    await collect(
      raw(
        { type: "event", seq: 1, event: { type: "delta", content: "a" } },
        { type: "event", seq: 3, event: { type: "delta", content: "c" } }
      )
    );
  } catch (e: any) {
    threw = e instanceof SolarError && /dropped a frame/.test(e.message);
  }
  check("sequence gap throws", threw);
}

// 5. Mid-run error event, with its upstream status preserved.
{
  let status = 0;
  try {
    await collect(run({ type: "delta", content: "partial" }, { type: "error", status: 503, code: "CONFIGURATION_ERROR", error: "service is temporarily unavailable" }));
  } catch (e: any) {
    status = e instanceof SolarError ? e.status : -1;
  }
  check("error event keeps upstream status", status === 503, String(status));
}

// 6. Protocol-level rejection, outside the event envelope.
{
  let err: SolarError | null = null;
  try {
    await collect(raw({ type: "error", code: "INVALID_MESSAGE", message: "invalid websocket message" }));
  } catch (e: any) {
    err = e;
  }
  check("protocol error maps to 400", err instanceof SolarError && err.status === 400, String(err?.status));
}

// 7. `complete` ends the run, and its token counts are reported as usage.
{
  const out = await collect(
    run({ type: "delta", content: "done" }, complete(), { type: "delta", content: "after the end" })
  );
  check("complete terminates the stream", out.text === "done", JSON.stringify(out.text));
  check(
    "usage comes from complete",
    out.summary.usage?.prompt_tokens === 100 && out.summary.usage?.completion_tokens === 20 && out.summary.usage?.total_tokens === 120,
    JSON.stringify(out.summary.usage)
  );
}

// 8. Auto mode announces the level it settled on.
{
  const out = await collect(run({ type: "assessment", effort: "xhigh" }, { type: "delta", content: "x" }, complete()));
  check("assessment records the chosen effort", out.summary.effort === "xhigh", String(out.summary.effort));
}

// 9. Cited sources are appended, so the answer's [n] markers resolve.
{
  const out = await collect(
    run(
      { type: "citations", citations: [{ n: 1, url: "https://example.com/a", title: "A" }] },
      { type: "delta", content: "See [1]." },
      complete({ sources: [{ title: "A", url: "https://example.com/a" }] })
    )
  );
  check("answer text precedes the sources", out.text.startsWith("See [1]."), JSON.stringify(out.text));
  check("source list appended", out.text.includes("[A](https://example.com/a)"), JSON.stringify(out.text));
  check("sources captured", out.summary.sources.length === 1, JSON.stringify(out.summary.sources));
}

// 10. Nothing to cite, nothing appended.
{
  const out = await collect(run({ type: "delta", content: "no search here" }, complete()));
  check("no sources means no footer", out.text === "no search here", JSON.stringify(out.text));
  check("footer of empty list is empty", sourcesFooter([]) === "");
  check("sourceless entries skipped", sourcesFooter([{ title: "no url" }]) === "");
}

// --- request normalisation --------------------------------------------------

// 11. System is refused upstream, so it folds into the first user turn.
{
  const out = toSolarMessages([
    { role: "system", content: "You are terse." },
    { role: "user", content: "Hi" },
  ]);
  check("system is folded away", out.length === 1 && out[0].role === "user", JSON.stringify(out));
  check("system text is kept", out[0].content === "You are terse.\n\nHi", JSON.stringify(out[0].content));
}

// 12. Several system messages, folded in order into the FIRST user turn.
{
  const out = toSolarMessages([
    { role: "system", content: "One." },
    { role: "user", content: "first" },
    { role: "assistant", content: "ok" },
    { role: "system", content: "Two." },
    { role: "user", content: "second" },
  ]);
  check("folds into the first user turn", out[0].content === "One.\n\nTwo.\n\nfirst", JSON.stringify(out[0].content));
  check("later turns untouched", out.length === 3 && out[2].content === "second", JSON.stringify(out));
}

// 13. Empty content is rejected upstream, so it never gets sent.
{
  const out = toSolarMessages([
    { role: "user", content: "   " },
    { role: "assistant", content: "" },
    { role: "user", content: "real" },
  ]);
  check("blank messages dropped", out.length === 1 && out[0].content === "real", JSON.stringify(out));
}

// 14. Multimodal content arrays flatten to their text (images are refused
//     before this point; the text must still survive).
{
  const out = toSolarMessages([
    { role: "user", content: [{ type: "text", text: "describe" }, { type: "text", text: " this" }] as any },
  ]);
  check("content parts flatten to text", out[0].content === "describe this", JSON.stringify(out));
}

// 15. The last turn must be a user one.
{
  let status = 0;
  try {
    toSolarMessages([{ role: "user", content: "hi" }, { role: "assistant", content: "prefill" }]);
  } catch (e: any) {
    status = e instanceof SolarError ? e.status : -1;
  }
  check("trailing assistant is a 400", status === 400, String(status));
}

// 16. Nothing sendable at all.
{
  let status = 0;
  try {
    toSolarMessages([{ role: "user", content: "" }]);
  } catch (e: any) {
    status = e instanceof SolarError ? e.status : -1;
  }
  check("no content is a 400", status === 400, String(status));
}

// 17. A system-only conversation still produces a user turn to send.
{
  const out = toSolarMessages([{ role: "system", content: "Only a system prompt." }]);
  check("system-only becomes a user turn", out.length === 1 && out[0].role === "user", JSON.stringify(out));
}

// --- modes ------------------------------------------------------------------

// 18. Instant / Thinking, in both spellings.
{
  check("default is Instant", resolveSolarEffort({}) === SOLAR_INSTANT);
  check("enable_thinking false is Instant", resolveSolarEffort({ enableThinking: false }) === SOLAR_INSTANT);
  check("enable_thinking true is Thinking", resolveSolarEffort({ enableThinking: true }) === SOLAR_THINK);
  check("Instant is none", SOLAR_INSTANT === "none");
  check("Thinking is xhigh", SOLAR_THINK === "xhigh");
  check(
    "explicit effort wins over enable_thinking",
    resolveSolarEffort({ reasoningEffort: "medium", enableThinking: true }) === "medium"
  );
  check("effort is normalised", resolveSolarEffort({ reasoningEffort: " Adaptive " }) === "adaptive");
}

// 19. Registry.
{
  check("Solar Pro 4 is routable", isSolarModel("upstage/solar-pro-4"));
  check("unknown ids are not", !isSolarModel("upstage/solar-pro-5"));
  const m = resolveSolarModel("upstage/solar-pro-4");
  check("public id maps to the upstream one", m?.upstreamId === "solar-pro4", String(m?.upstreamId));
  check("both modes are advertised", Boolean(m?.reasoningEffort?.includes("none") && m?.reasoningEffort?.includes("xhigh")));
  check("context window is 512k", m?.contextLength === 524_288, String(m?.contextLength));
  check("no public id says free", !SOLAR_MODELS.some((x) => /free/i.test(x.id) || /free/i.test(x.name)));
}

console.log(`solar.stream: ${passed} passed, ${failed} failed`);
if (failed) process.exit(1);

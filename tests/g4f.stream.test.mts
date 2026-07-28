// g4f speaks standard OpenAI SSE, which makes the parser thin but shifts where
// the risk lives. The things worth pinning down here are:
//
//  1. Frames survive arbitrary chunking. A read boundary can land mid-line or
//     mid-codepoint; parsing per chunk mangles both.
//  2. The two channels stay separate. `reasoning_content` and `content` arrive in
//     the same frame shape, and collapsing them would leak the model's thinking
//     into the answer.
//  3. Registry matching stays exact. `glm-5.2` exists on two g4f routes AND as a
//     bare id elsewhere, so a loose match would silently route to the wrong
//     upstream.
//  4. Every 429 fails over to the alternate route, whatever language it is
//     phrased in. The two upstreams word their limits completely differently
//     ("Rate limit 10s exceeded" vs "1分钟内最多请求5次"), and matching on one
//     wording silently disabled failover for the other — the one case the
//     `alternates` field exists to cover.

import {
  g4fDeltas,
  isG4FModel,
  resolveG4FModel,
  openCompletion,
  resetCooldowns,
  G4FError,
  G4F_MODELS,
  quotaFrom,
} from "../lib/g4f.ts";

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

/** Wrap raw SSE bytes in a Response, optionally split into fixed-size chunks. */
function sse(raw: string, chunkSize = 0): Response {
  const bytes = new TextEncoder().encode(raw);
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      if (chunkSize <= 0) {
        controller.enqueue(bytes);
      } else {
        for (let i = 0; i < bytes.length; i += chunkSize) {
          controller.enqueue(bytes.slice(i, i + chunkSize));
        }
      }
      controller.close();
    },
  });
  return new Response(stream, { headers: { "Content-Type": "text/event-stream" } });
}

const frame = (delta: Record<string, unknown>) =>
  `data: ${JSON.stringify({ choices: [{ index: 0, delta }] })}\n\n`;

/** Drain a Response through the delta parser into its text content. */
async function collectRes(res: Response) {
  let out = "";
  for await (const d of g4fDeltas(res)) if (d.kind === "text") out += d.text;
  return out;
}

async function collect(raw: string, chunkSize = 0) {
  const out: Array<{ kind: string; text: string }> = [];
  for await (const d of g4fDeltas(sse(raw, chunkSize))) out.push(d);
  return out;
}

const text = (ds: Array<{ kind: string; text: string }>) =>
  ds.filter((d) => d.kind === "text").map((d) => d.text).join("");
const reasoning = (ds: Array<{ kind: string; text: string }>) =>
  ds.filter((d) => d.kind === "reasoning").map((d) => d.text).join("");

console.log("g4f stream + registry");

// --- 1. chunking ------------------------------------------------------------
{
  const raw =
    frame({ role: "assistant" }) +
    frame({ content: "PROXY " }) +
    frame({ content: "TEST " }) +
    frame({ content: "OK" }) +
    "data: [DONE]\n\n";

  for (const size of [0, 1, 3, 7, 16, 64]) {
    const ds = await collect(raw, size);
    check(`reassembles at chunk size ${size}`, text(ds) === "PROXY TEST OK", `got ${JSON.stringify(text(ds))}`);
  }
}

// Multi-byte characters split across a read boundary must not become U+FFFD.
{
  const raw = frame({ content: "héllo → 世界 🎉" }) + "data: [DONE]\n\n";
  for (const size of [1, 2, 3, 5]) {
    const ds = await collect(raw, size);
    check(`multi-byte intact at chunk size ${size}`, text(ds) === "héllo → 世界 🎉", `got ${JSON.stringify(text(ds))}`);
  }
}

// A final frame with no trailing newline still gets parsed.
{
  const ds = await collect(frame({ content: "a" }) + `data: ${JSON.stringify({ choices: [{ delta: { content: "b" } }] })}`);
  check("unterminated final frame is parsed", text(ds) === "ab", `got ${JSON.stringify(text(ds))}`);
}

// --- 2. channel separation --------------------------------------------------
{
  const raw =
    frame({ reasoning_content: "thinking " }) +
    frame({ reasoning_content: "hard" }) +
    frame({ content: "answer" }) +
    "data: [DONE]\n\n";
  const ds = await collect(raw, 5);
  check("reasoning kept separate", reasoning(ds) === "thinking hard", `got ${JSON.stringify(reasoning(ds))}`);
  check("content kept separate", text(ds) === "answer", `got ${JSON.stringify(text(ds))}`);
}

// Both channels in one frame, interleaved order preserved.
{
  const ds = await collect(frame({ reasoning_content: "r", content: "c" }));
  check("both channels in one frame", ds.length === 2 && ds[0].kind === "reasoning" && ds[1].kind === "text");
}

// [DONE] emits nothing, and neither do keepalive comments or empty deltas.
{
  const ds = await collect("data: [DONE]\n\n" + ": keepalive\n\n" + frame({}) + frame({ content: "" }));
  check("terminator/keepalive/empty emit no deltas", ds.length === 0, `got ${JSON.stringify(ds)}`);
}

// An error delivered mid-stream as a frame surfaces as G4FError, not as content.
{
  let threw: unknown = null;
  try {
    for await (const _ of g4fDeltas(sse(`data: ${JSON.stringify({ error: { message: "Rate limit 10s exceeded" } })}\n\n`))) {
      /* expected to throw */
    }
  } catch (e) {
    threw = e;
  }
  check("mid-stream error frame throws G4FError", threw instanceof G4FError);
  check("mid-stream error keeps its message", (threw as G4FError)?.message === "Rate limit 10s exceeded");
}

// --- 3. registry matching ---------------------------------------------------
{
  check("exact id matches", isG4FModel("g4f/ollama.pro/gpt-oss:120b"));
  check("colon ids survive", resolveG4FModel("g4f/ollama.pro/gpt-oss:120b")?.upstream === "gpt-oss:120b");

  // The same public model name on two routes must resolve to different upstreams.
  const a = resolveG4FModel("g4f/ollama.pro/glm-5.2");
  const b = resolveG4FModel("g4f/crowllm/glm-5.2");
  check("same model, two routes are distinct", !!a && !!b && a!.route !== b!.route);
  check("both carry the same upstream id", a!.upstream === "glm-5.2" && b!.upstream === "glm-5.2");
  check("routes cross-reference as alternates", a!.alternates?.includes(b!.id) === true && b!.alternates?.includes(a!.id) === true);

  // Ids belonging to other providers, or excluded combinations, must not match.
  for (const miss of [
    "glm-5.2", // bare — ambiguous
    "moonshotai/kimi-k2.6", // OneCompiler's registry
    "qwen3.8-max-preview", // Qwen
    "g4f/cloudflare/gpt-oss-120b", // verified non-working, deliberately absent
    "g4f/perplexity/o3", // ditto
    "g4f/ollama.pro/", // prefix only
    "g4f/", // prefix only
  ]) {
    check(`does not claim ${JSON.stringify(miss)}`, !isG4FModel(miss));
  }

  check("unknown id resolves to null", resolveG4FModel("g4f/nope/nope") === null);
}

// Registry invariants: ids unique, alternates resolvable, routes absolute.
{
  const ids = G4F_MODELS.map((m) => m.id);
  check("model ids are unique", new Set(ids).size === ids.length);
  check("every model has an upstream id", G4F_MODELS.every((m) => !!m.upstream));
  check("every route is absolute", G4F_MODELS.every((m) => /^https?:\/\//.test(m.route)));
  check(
    "every alternate resolves",
    G4F_MODELS.every((m) => (m.alternates || []).every((a) => !!resolveG4FModel(a)))
  );
  check(
    "no model lists itself as an alternate",
    G4F_MODELS.every((m) => !(m.alternates || []).includes(m.id))
  );
  check("registry covers both routes", new Set(G4F_MODELS.map((m) => m.route)).size === 2);
}

// --- 4. failover on rate limit ----------------------------------------------
// The regression this guards: crowllm reports its limit in Chinese
// ("1分钟内最多请求5次"), which does not match the ollama.pro wording. Treating
// only the English phrasing as retryable meant glm-5.2 never failed over to its
// alternate — the single case `alternates` exists to cover.
{
  const realFetch = globalThis.fetch;
  const rateLimited = (msg: string) =>
    new Response(JSON.stringify({ error: { message: msg } }), { status: 429 });

  for (const [label, msg] of [
    ["crowllm 5/min (Chinese)", "您已达到总请求数限制：1分钟内最多请求5次，包括失败次数"],
    ["ollama.pro burst", "Rate limit 10s exceeded"],
    ["daily cap", "You have exceeded your daily token limit."],
  ] as const) {
    resetCooldowns();
    const seen: string[] = [];
    globalThis.fetch = (async (url: any) => {
      const u = String(url);
      seen.push(u);
      // First route refuses; the alternate answers.
      if (seen.length === 1) return rateLimited(msg);
      return new Response(`data: ${JSON.stringify({ choices: [{ delta: { content: "ok" } }] })}\n\n`, {
        status: 200,
        headers: { "Content-Type": "text/event-stream" },
      });
    }) as typeof fetch;

    try {
      const res = await openCompletion({
        model: "g4f/crowllm/glm-5.2",
        messages: [{ role: "user", content: "hi" }] as any,
      });
      const body = await collectRes(res);
      check(`${label}: falls over to the alternate`, seen.length === 2 && body === "ok", `tried ${seen.length}, got ${JSON.stringify(body)}`);
      check(`${label}: alternate is the other host`, seen.length === 2 && !seen[1].includes("/custom/"), seen[1] || "");
    } catch (e: any) {
      check(`${label}: falls over to the alternate`, false, e.message);
    }
  }

  // A model with no alternate surfaces the 429 rather than inventing a route.
  {
    resetCooldowns();
    globalThis.fetch = (async () => rateLimited("Rate limit 10s exceeded")) as typeof fetch;
    let threw: any = null;
    try {
      await openCompletion({ model: "g4f/crowllm/gemini-3.1-flash-lite", messages: [{ role: "user", content: "hi" }] as any });
    } catch (e) {
      threw = e;
    }
    check("no alternate: surfaces 429", threw instanceof G4FError && threw.status === 429, String(threw?.message));
  }

  // Auth failure is terminal — retrying an alternate would fail identically.
  {
    resetCooldowns();
    let calls = 0;
    globalThis.fetch = (async () => {
      calls++;
      return new Response(JSON.stringify({ error: { message: "Authentication required" } }), { status: 401 });
    }) as typeof fetch;
    let threw: any = null;
    try {
      await openCompletion({ model: "g4f/crowllm/glm-5.2", messages: [{ role: "user", content: "hi" }] as any });
    } catch (e) {
      threw = e;
    }
    check("401 is terminal, not retried", calls === 1, `made ${calls} calls`);
    check("401 surfaces as 402", threw instanceof G4FError && threw.status === 402);
  }

  resetCooldowns();
  globalThis.fetch = realFetch;
}

// --- 5. quota headers -------------------------------------------------------
{
  const res = new Response("", {
    headers: {
      "x-ratelimit-remaining-requests": "81",
      "x-ratelimit-remaining-tokens": "495430",
      "x-provider": "ollama.pro",
    },
  });
  const q = quotaFrom(res);
  check("reads remaining requests", q.remainingRequests === 81);
  check("reads remaining tokens", q.remainingTokens === 495430);
  check("reads provider", q.provider === "ollama.pro");

  const bare = quotaFrom(new Response(""));
  check("absent headers become null", bare.remainingRequests === null && bare.remainingTokens === null);
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) process.exit(1);

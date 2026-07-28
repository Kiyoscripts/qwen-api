// g4f.dev client (server-side). Reverse-engineered from the web app's own
// client library (dist/js/client.js + providers.js).
//
// The easiest of the three upstreams by some distance: it already speaks
// OpenAI-compatible JSON — real roles, standard SSE, `reasoning_content` deltas —
// so this module is closer to a passthrough than to the translation layers the
// Qwen (session + history flattening + PoW) and OneCompiler (raw-text stream)
// paths need.
//
//   POST <route>/chat/completions   { model, messages, stream }
//
// TWO URL SHAPES, one request body. Named providers live at
// `g4f.space/api/<provider>`, community "custom servers" at
// `g4f.space/custom/<srv_id>`. Only the base differs, so each registry entry
// carries its own `route` and nothing downstream has to care which it is.
//
// NO AUTHENTICATION. Every model here was verified answering with no
// Authorization header and no cookies. The site's client only sends a bearer
// token when a member session exists in localStorage, and never sets
// `credentials: "include"` — g4f.space is cross-origin from g4f.dev, so cookies
// are not sent on these calls at all. G4F_TOKEN is plumbed through for the day
// that changes; unset is the normal case and works.
//
// THE REAL CONSTRAINT IS THE QUOTA, and it is per-IP: 200 requests / 500k tokens.
// On a single-egress deploy that budget is shared by every caller, which is what
// the cross-route `alternates` failover below exists to stretch. There is also a
// burst guard answering 429 "Rate limit 10s exceeded" — measured as a burst, not
// a rate (five sequential and six concurrent requests all pass), so it is handled
// by backing off after the fact rather than by pre-emptive spacing.

import type { OpenAIMessage } from "./qwen";

export const G4F_BASE = process.env.G4F_BASE || "https://g4f.space";

// Optional. See the header: anonymous is the expected mode and it works.
const G4F_TOKEN = process.env.G4F_TOKEN || "";

export class G4FError extends Error {
  status: number;
  /** True for failures another route or a later retry could plausibly survive. */
  retryable: boolean;
  constructor(message: string, status = 502, retryable = false) {
    super(message);
    this.status = status;
    this.retryable = retryable;
  }
}

// --- model registry ---------------------------------------------------------
// Public ids are namespaced "g4f/<provider>/<model>".
//
// The namespace is load-bearing, not decoration: `glm-5.2` exists on BOTH
// ollama.pro and crowllm, and ids like `kimi-k2.6` / `deepseek-v4-pro` collide
// with entries already in the OneCompiler registry. A bare id could not say
// which upstream was meant.
//
// `upstream` is stored verbatim rather than derived from the public id. ollama.pro
// uses Ollama's colon convention (`gpt-oss:120b`) where the same model is
// hyphenated elsewhere (`gpt-oss-120b`), so any substitution rule would be wrong
// for one provider or the other.
export interface G4FModel {
  id: string; // "g4f/ollama.pro/gpt-oss:120b"
  upstream: string; // "gpt-oss:120b"
  route: string; // base URL, no trailing slash
  name: string;
  /** Public ids of the same logical model on other routes, tried on failure. */
  alternates?: string[];
}

const OLLAMA_PRO = `${G4F_BASE}/api/ollama.pro`;
const CROWLLM = `${G4F_BASE}/custom/srv_mrgynwuz08a167112109`;

/**
 * Every entry below was verified end-to-end against the live upstream on
 * 2026-07-29: a completion returning the exact requested string, plus a
 * streaming check on the shape. Models that answered 401/429 anonymously are
 * deliberately absent — see docs/superpowers/specs/2026-07-29-g4f-provider-design.md
 * for the ten that were excluded and why.
 *
 * An absent model is better than a listed one that always fails: callers build
 * against /v1/models, and a permanently-402 entry is a trap rather than an offer.
 */
export const G4F_MODELS: G4FModel[] = [
  // --- ollama.pro (18) ---
  { id: "g4f/ollama.pro/deepseek-v4-flash", upstream: "deepseek-v4-flash", route: OLLAMA_PRO, name: "DeepSeek V4 Flash" },
  { id: "g4f/ollama.pro/deepseek-v4-pro", upstream: "deepseek-v4-pro", route: OLLAMA_PRO, name: "DeepSeek V4 Pro" },
  { id: "g4f/ollama.pro/nemotron-3-nano:30b", upstream: "nemotron-3-nano:30b", route: OLLAMA_PRO, name: "Nemotron 3 Nano 30B" },
  { id: "g4f/ollama.pro/gpt-oss:20b", upstream: "gpt-oss:20b", route: OLLAMA_PRO, name: "GPT-OSS 20B" },
  { id: "g4f/ollama.pro/glm-5.2", upstream: "glm-5.2", route: OLLAMA_PRO, name: "GLM 5.2", alternates: ["g4f/crowllm/glm-5.2"] },
  { id: "g4f/ollama.pro/minimax-m3", upstream: "minimax-m3", route: OLLAMA_PRO, name: "MiniMax M3" },
  { id: "g4f/ollama.pro/kimi-k2.6", upstream: "kimi-k2.6", route: OLLAMA_PRO, name: "Kimi K2.6" },
  { id: "g4f/ollama.pro/kimi-k2.7-code", upstream: "kimi-k2.7-code", route: OLLAMA_PRO, name: "Kimi K2.7 Code" },
  { id: "g4f/ollama.pro/gpt-oss:120b", upstream: "gpt-oss:120b", route: OLLAMA_PRO, name: "GPT-OSS 120B" },
  { id: "g4f/ollama.pro/mistral-large-3:675b", upstream: "mistral-large-3:675b", route: OLLAMA_PRO, name: "Mistral Large 3 675B" },
  { id: "g4f/ollama.pro/kimi-k2.5", upstream: "kimi-k2.5", route: OLLAMA_PRO, name: "Kimi K2.5" },
  { id: "g4f/ollama.pro/nemotron-3-ultra", upstream: "nemotron-3-ultra", route: OLLAMA_PRO, name: "Nemotron 3 Ultra" },
  { id: "g4f/ollama.pro/glm-5.1", upstream: "glm-5.1", route: OLLAMA_PRO, name: "GLM 5.1" },
  { id: "g4f/ollama.pro/minimax-m2.5", upstream: "minimax-m2.5", route: OLLAMA_PRO, name: "MiniMax M2.5" },
  { id: "g4f/ollama.pro/minimax-m2.7", upstream: "minimax-m2.7", route: OLLAMA_PRO, name: "MiniMax M2.7" },
  { id: "g4f/ollama.pro/nemotron-3-super", upstream: "nemotron-3-super", route: OLLAMA_PRO, name: "Nemotron 3 Super" },
  { id: "g4f/ollama.pro/qwen3.5:397b", upstream: "qwen3.5:397b", route: OLLAMA_PRO, name: "Qwen3.5 397B" },
  // ~79s to first and last token. Inside maxDuration (300s) and covered by the
  // route's SSE keepalive, but it is the entry most likely to read as a hang.
  { id: "g4f/ollama.pro/gemma4:31b", upstream: "gemma4:31b", route: OLLAMA_PRO, name: "Gemma 4 31B" },

  // --- crowllm (2) ---
  { id: "g4f/crowllm/glm-5.2", upstream: "glm-5.2", route: CROWLLM, name: "GLM 5.2", alternates: ["g4f/ollama.pro/glm-5.2"] },
  { id: "g4f/crowllm/gemini-3.1-flash-lite", upstream: "gemini-3.1-flash-lite", route: CROWLLM, name: "Gemini 3.1 Flash Lite" },
];

const BY_ID = new Map(G4F_MODELS.map((m) => [m.id, m]));

/**
 * Brand mark for a g4f model, or "" for a neutral chip.
 *
 * modelIcon() cannot be used here: it keys on a `maker/` prefix and falls back to
 * the Qwen mark for anything bare. Every id in this registry is bare, so routing
 * through it badges Mistral, GLM and Nemotron models with Qwen's logo — a false
 * claim of provenance on cards that are already flagged as unverified.
 *
 * Only prefixes we are confident about are mapped. Anything else gets the neutral
 * chip rather than a plausible-looking wrong badge, which is the failure mode
 * worth avoiding: there is no asset for GLM, MiniMax, Nemotron or Mistral, and
 * borrowing a neighbour's mark would misattribute the model.
 */
export function g4fIcon(upstream: string): string {
  const id = upstream.toLowerCase();
  if (id.startsWith("gpt-oss")) return "/openai.svg";
  if (id.startsWith("deepseek")) return "/deepseek.svg";
  if (id.startsWith("qwen")) return "/qwen.svg";
  if (id.startsWith("kimi")) return "/kimi.svg";
  // Gemini and Gemma are both Google; the Gemini mark is the recognisable one,
  // matching the reasoning already baked into MAKER_ICONS.
  if (id.startsWith("gemini") || id.startsWith("gemma")) return "/gemini.svg";
  return "";
}

/**
 * Exact-match only, deliberately — same rule as isOneCompilerModel().
 *
 * A prefix test on "g4f/" would claim ids this registry cannot actually serve
 * (every excluded provider still looks like a g4f id), turning a clean fall-through
 * into a 404 from the wrong handler. Matching the registry exactly means an
 * unknown id continues to the Qwen path untouched.
 */
export function isG4FModel(id: string): boolean {
  return BY_ID.has(id);
}

export function resolveG4FModel(id: string): G4FModel | null {
  return BY_ID.get(id) || null;
}

// --- pacing -----------------------------------------------------------------

/**
 * Back off a route only AFTER it complains, never before.
 *
 * The upstream's "Rate limit 10s exceeded" is a burst guard, not a steady rate.
 * Measured: five back-to-back requests with no gap all pass, and six concurrent
 * all pass; the 429s that first surfaced it came from sweeping the whole
 * eighteen-model registry at once. So proactive spacing would buy nothing and
 * cost every caller up to a full window of latency on an idle route — which is
 * why this is reactive.
 *
 * When a short-window 429 does arrive, that route is marked cooling and later
 * requests wait out the remainder rather than piling on and extending it.
 *
 * Deliberately in-process and best-effort: it damps one instance's own bursts and
 * makes no claim to be a distributed limiter. A multi-instance deploy leans on
 * the cross-route failover below instead.
 */
// Default is the longer of the two observed windows: crowllm counts failed
// attempts against its 5/min allowance, so coming back early actively hurts.
const COOLDOWN_MS = Number(process.env.G4F_COOLDOWN_MS || 60_000);
const coolingUntil = new Map<string, number>();

function markCooling(route: string, ms: number = COOLDOWN_MS): void {
  if (ms > 0) coolingUntil.set(route, Date.now() + ms);
}

/**
 * Clear all route cooldowns. Test seam only.
 *
 * The map is module-level and deliberately outlives a single request — that is
 * the point of it — which means a test that trips a limit would otherwise leak
 * that state into the next one.
 */
export function resetCooldowns(): void {
  coolingUntil.clear();
}

/** Milliseconds left on a route's cooldown, 0 if it is clear. */
function coolingFor(route: string): number {
  const until = coolingUntil.get(route);
  if (!until) return 0;
  const left = until - Date.now();
  if (left <= 0) {
    coolingUntil.delete(route);
    return 0;
  }
  return left;
}

// --- request ----------------------------------------------------------------

const CHROME_VERSION = "140";
const USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 " +
  `(KHTML, like Gecko) Chrome/${CHROME_VERSION}.0.0.0 Safari/537.36`;

function headers(): Record<string, string> {
  return {
    "Content-Type": "application/json",
    Accept: "*/*",
    "Accept-Language": "en-US,en;q=0.9",
    // Only when configured. The upstream treats a missing header as anonymous,
    // which is the mode every registry entry was verified in.
    ...(G4F_TOKEN ? { Authorization: `Bearer ${G4F_TOKEN}` } : {}),
    Origin: "https://g4f.dev",
    Referer: "https://g4f.dev/",
    "User-Agent": USER_AGENT,
  };
}

/** Remaining quota, read off every response. Null when the header is absent. */
export interface G4FQuota {
  remainingRequests: number | null;
  remainingTokens: number | null;
  provider: string | null;
}

export function quotaFrom(res: Response): G4FQuota {
  const num = (h: string) => {
    const v = res.headers.get(h);
    if (v === null) return null;
    const n = parseInt(v, 10);
    return Number.isFinite(n) ? n : null;
  };
  return {
    remainingRequests: num("x-ratelimit-remaining-requests"),
    remainingTokens: num("x-ratelimit-remaining-tokens"),
    provider: res.headers.get("x-provider"),
  };
}

/**
 * Messages pass through unchanged.
 *
 * Unlike the Qwen path (one message per call, state held upstream) and
 * OneCompiler (a split into conversation + currentMessage), this endpoint accepts
 * a standard OpenAI array with real system/user/assistant roles. Rewriting it
 * would only introduce a way to get it wrong.
 */
export interface G4FCompletionOpts {
  model: string; // public id
  messages: OpenAIMessage[];
  stream?: boolean;
}

async function openOne(model: G4FModel, messages: OpenAIMessage[], stream: boolean): Promise<Response> {
  let res: Response;
  try {
    res = await fetch(`${model.route}/chat/completions`, {
      method: "POST",
      headers: headers(),
      body: JSON.stringify({ model: model.upstream, messages, stream }),
    });
  } catch (e: any) {
    throw new G4FError(`Could not reach ${model.route}: ${e.message}`, 502, true);
  }

  if (!res.ok || !res.body) {
    const text = await res.text().catch(() => "");
    throw classify(res.status, text, model);
  }
  return res;
}

/**
 * Map an upstream failure onto a status and a retry decision.
 *
 * The distinction that matters is transient vs terminal. The 10s throttle and a
 * gateway hiccup are worth trying elsewhere; an exhausted daily cap or an auth
 * wall will fail identically on every attempt, and retrying only burns the
 * budget faster.
 */
function classify(status: number, body: string, model: G4FModel): G4FError {
  const snippet = body.slice(0, 300);
  let message = snippet;
  try {
    const j = JSON.parse(body);
    message = j?.error?.message || j?.message || snippet;
  } catch {
    /* not JSON — the raw snippet is the best we have */
  }

  if (status === 429) {
    // Every 429 is retryable, because "retry" here means a DIFFERENT route — a
    // separate host with its own budget — never the one that just refused us.
    // Falling over is the whole reason `alternates` exists.
    //
    // The cooldown length is the part worth reading off the message, and the two
    // upstreams word it very differently:
    //   ollama.pro  "Rate limit 10s exceeded"                      — burst guard
    //   crowllm     "1分钟内最多请求5次，包括失败次数"                 — 5/min, failures counted
    // Anything unrecognised gets the longer default: guessing short would have us
    // retrying into a limit that counts the failed attempts against us.
    const burst = message.match(/rate limit (\d+)s/i);
    markCooling(model.route, burst ? Number(burst[1]) * 1000 : COOLDOWN_MS);
    return new G4FError(message || "Rate limited upstream", 429, true);
  }
  if (status === 401 || status === 403) {
    return new G4FError(
      `${message || "Authentication required upstream"} (model '${model.id}')`,
      402
    );
  }
  if (status >= 500) return new G4FError(message || `Upstream error (${status})`, 502, true);
  return new G4FError(message || `Upstream error (${status})`, status >= 400 ? status : 502);
}

/**
 * Open a completion, falling back to the same model on another route.
 *
 * Failover happens at OPEN, before any bytes reach the client — once the caller
 * is streaming it is too late to switch, which is the same rule the Qwen and
 * OneCompiler pools follow.
 */
export async function openCompletion(opts: G4FCompletionOpts): Promise<Response> {
  const model = resolveG4FModel(opts.model);
  if (!model) throw new G4FError(`Model '${opts.model}' is not available.`, 404);

  const chain = [model, ...(model.alternates || []).map(resolveG4FModel).filter((m): m is G4FModel => !!m)];

  let last: G4FError | null = null;
  for (let i = 0; i < chain.length; i++) {
    const candidate = chain[i];
    const isLast = i === chain.length - 1;

    // A route we know is rate-limited is worth stepping over, not waiting on —
    // an alternate is a different host with an untouched budget, so trying it is
    // strictly faster than sitting out the window. Only wait when there is
    // nothing else left to try.
    const cooling = coolingFor(candidate.route);
    if (cooling > 0) {
      if (!isLast) {
        last = new G4FError(`${candidate.id} is rate-limited; trying another route`, 429, true);
        continue;
      }
      await new Promise((r) => setTimeout(r, cooling));
    }

    try {
      return await openOne(candidate, opts.messages, opts.stream !== false);
    } catch (e: any) {
      last = e instanceof G4FError ? e : new G4FError(e.message || "Upstream error", 502, true);
      // A terminal failure (auth, unknown model) would repeat identically.
      if (!last.retryable) break;
    }
  }
  throw last || new G4FError("Upstream error", 502);
}

// --- stream -----------------------------------------------------------------

export interface G4FDelta {
  kind: "text" | "reasoning";
  text: string;
}

/**
 * Yield the answer as it streams.
 *
 * Standard OpenAI SSE, so this is a `data:` frame parser over
 * `choices[0].delta`, splitting `content` from `reasoning_content` so the route
 * can honour QWEN_SHOW_REASONING exactly as it does for Qwen — one knob for the
 * whole proxy rather than a second one that means the same thing.
 *
 * Two things the buffering must get right, both easy to miss:
 *  1. Frames split across read boundaries. A chunk can end mid-line, so lines are
 *     only parsed once terminated; the remainder carries forward.
 *  2. Multi-byte characters split across a boundary. `stream: true` on the
 *     decoder holds the partial sequence back instead of emitting U+FFFD.
 */
export async function* g4fDeltas(res: Response): AsyncGenerator<G4FDelta> {
  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  const parse = function* (frame: string): Generator<G4FDelta> {
    const payload = frame.startsWith("data:") ? frame.slice(5).trim() : frame.trim();
    if (!payload || payload === "[DONE]") return;
    let j: any;
    try {
      j = JSON.parse(payload);
    } catch {
      return; // keepalive comment or a frame we do not model
    }
    // An error can arrive mid-stream as a normal frame rather than a status.
    if (j?.error?.message) throw new G4FError(j.error.message, 502);
    const d = j?.choices?.[0]?.delta;
    if (!d) return;
    if (typeof d.reasoning_content === "string" && d.reasoning_content) {
      yield { kind: "reasoning", text: d.reasoning_content };
    }
    if (typeof d.content === "string" && d.content) {
      yield { kind: "text", text: d.content };
    }
  };

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      // SSE separates events with a blank line, but tolerate lone newlines too:
      // parse whole lines and keep the unterminated tail.
      let nl: number;
      while ((nl = buffer.indexOf("\n")) !== -1) {
        const line = buffer.slice(0, nl);
        buffer = buffer.slice(nl + 1);
        yield* parse(line);
      }
    }
    // Flush a final frame that arrived without a trailing newline, plus any bytes
    // the decoder was holding mid-codepoint.
    buffer += decoder.decode();
    if (buffer.trim()) yield* parse(buffer);
  } finally {
    await reader.cancel().catch(() => {});
  }
}

// crax-gpt client (server-side). Currently the Railway host; the base URL is
// env-overridable via CRAX_BASE, and it has moved once already.
//
// An OpenAI-compatible aggregator: one base URL, one bearer key, standard
// `{model, messages, stream}` in and SSE frames out. That makes this the
// thinnest provider module in the codebase — no session to create, no history to
// flatten, no proof-of-work.
//
//   POST /v1/chat/completions   Authorization: Bearer <key>
//
// THREE UPSTREAM QUIRKS, all measured, and each one silently wrong if missed:
//
//  1. IT ALWAYS STREAMS. A request without `stream: true` still comes back as
//     `text/event-stream` full of `chat.completion.chunk` frames — there is no
//     JSON-object mode to ask for. Every response goes through the SSE parser and
//     non-streaming callers get the reassembled text.
//  2. THE SOCKET STAYS OPEN AFTER `data: [DONE]`. The server sends the
//     terminator and then simply does not close, so a reader that waits for EOF
//     blocks until its timeout — measured at 7.1s to [DONE] against a 90s hang
//     afterwards. The parser MUST stop at the terminator; `: keepalive` comments
//     appear in the body too and are skipped.
//  3. BACKEND FAILURES ARRIVE AS HTTP 200 WITH THE ERROR AS THE ANSWER. The relay
//     hands its own upstream's failure back as ordinary completion content:
//     "Error: Unexpected server response: 403", "Error: read ECONNRESET",
//     "Error: Socks4 Proxy rejected connection", "Error: connect ETIMEDOUT ...",
//     and "Please wait for the account pool to fill up. ETA: ~2 minutes". Status
//     codes cannot be trusted to signal failure, so see ERROR_SENTINELS below.
//
// It also rate-limits sharply: four concurrent requests earned an immediate
// 429 "Too many requests. Slow down."
//
// The ids are names advertised by a third-party aggregator, not verified
// deployments, so treat latency and quality as unrelated to what the name
// implies.

import type { OpenAIMessage } from "./qwen";
import { modelIcon } from "./modelIcons";

export const CRAX_BASE =
  process.env.CRAX_BASE || "https://overflowing-smile-production-9e13.up.railway.app/v1";

// The upstream's shared demo key. Not a secret — it ships in the clear and is the
// documented way in — but env-overridable so a rotation does not need a deploy.
const CRAX_API_KEY = process.env.CRAX_API_KEY || "crax";

export class CraxError extends Error {
  status: number;
  constructor(message: string, status = 502) {
    super(message);
    this.status = status;
  }
}

// --- model registry ---------------------------------------------------------
// Ids are used verbatim, not namespaced.
//
// The upstream's names are already distinctive (`gpt-5-6-sol`, `claude-opus-5`)
// and none collide with the Qwen, OneCompiler, media or persona registries —
// OneCompiler's are all `maker/model`, Qwen's all start `qwen`. Matching is exact,
// so an id that is not listed here falls through to the Qwen path untouched.
export interface CraxModel {
  /** What callers ask for. Stable across upstream renames. */
  id: string;
  /**
   * What the upstream calls it, when the two differ.
   *
   * Three ids were renamed when this provider moved hosts, so the public id is
   * pinned and the difference absorbed here. Changing the advertised ids instead
   * would have broken every caller already using them for the sake of an upstream
   * detail they never see.
   */
  upstream?: string;
  name: string;
}

/** The id to send upstream — the override when present, otherwise the public id. */
export const upstreamId = (m: CraxModel): string => m.upstream ?? m.id;

export const CRAX_MODELS: CraxModel[] = [
  // OpenAI
  { id: "gpt-5-6-sol", name: "GPT-5.6 Sol" },
  { id: "gpt-5-6-terra", name: "GPT-5.6 Terra" },
  { id: "gpt-5-5", name: "GPT-5.5" },
  { id: "gpt-5-1", name: "GPT-5.1" },
  { id: "gpt-5", name: "GPT-5" },
  { id: "gpt-5-mini", name: "GPT-5 Mini" },
  { id: "gpt-4o", name: "GPT-4o" },
  { id: "gpt-4o-mini", name: "GPT-4o Mini" },
  // Anthropic
  { id: "claude-opus-5", name: "Claude Opus 5" },
  { id: "claude-sonnet-5", name: "Claude Sonnet 5" },
  { id: "claude-opus-4-1", name: "Claude Opus 4.1" },
  { id: "fable-5", name: "Fable 5" },
  // Google
  { id: "gemini-3-1-pro", name: "Gemini 3.1 Pro" },
  { id: "gemini-3-pro", name: "Gemini 3 Pro" },
  { id: "gemini-3-flash", name: "Gemini 3 Flash" },
  { id: "gemini-2-5-flash", name: "Gemini 2.5 Flash" },
  // Others
  { id: "deepseek-v4-flash", upstream: "deepseek-flash", name: "DeepSeek V4 Flash" },
  { id: "deepseek-r1", name: "DeepSeek R1" },
  { id: "kimi-k2-6", upstream: "oc-kimi-k2-6", name: "Kimi K2.6" },
  { id: "glm-5-2", upstream: "glm-5.2", name: "GLM 5.2" },
  { id: "llama-3-3-70b-versatile", name: "Llama 3.3 70B Versatile" },
];

const BY_ID = new Map(CRAX_MODELS.map((m) => [m.id, m]));

/** Exact-match only, so an unknown id falls through to the Qwen path. */
export function isCraxModel(id: string): boolean {
  return BY_ID.has(id);
}

export function resolveCraxModel(id: string): CraxModel | null {
  return BY_ID.get(id) || null;
}

/**
 * Brand mark for a model id.
 *
 * Delegates rather than keeping its own table: the chat picker and playground
 * call modelIcon() directly, so a second mapping here would fix /models and leave
 * every other surface showing the wrong logo — which is exactly what happened.
 * The bare-id prefixes these models need live in lib/modelIcons.ts.
 */
export function craxIcon(id: string): string {
  return modelIcon(id);
}

// --- request ----------------------------------------------------------------

export interface CraxCompletionOpts {
  model: string;
  messages: OpenAIMessage[];
}

export async function openCompletion(opts: CraxCompletionOpts): Promise<Response> {
  const model = resolveCraxModel(opts.model);
  if (!model) {
    throw new CraxError(`Model '${opts.model}' is not available.`, 404);
  }

  let res: Response;
  try {
    res = await fetch(`${CRAX_BASE}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "text/event-stream",
        Authorization: `Bearer ${CRAX_API_KEY}`,
      },
      // `stream` is sent for correctness, but see the header note: the upstream
      // streams either way, so nothing downstream may depend on it being honoured.
      body: JSON.stringify({ model: upstreamId(model), messages: opts.messages, stream: true }),
    });
  } catch (e: any) {
    throw new CraxError(`Could not reach ${CRAX_BASE}: ${e.message}`, 502);
  }

  if (!res.ok || !res.body) {
    const text = await res.text().catch(() => "");
    throw classify(res.status, text);
  }
  return res;
}

function classify(status: number, body: string): CraxError {
  const snippet = body.slice(0, 300);
  let message = snippet;
  try {
    const j = JSON.parse(body);
    message = j?.error?.message || j?.message || snippet;
  } catch {
    /* not JSON — the raw snippet is the best we have */
  }
  if (status === 401 || status === 403) {
    return new CraxError(message || "Upstream rejected the API key", 402);
  }
  if (status === 429) return new CraxError(message || "Rate limited upstream", 429);
  if (status >= 500) return new CraxError(message || `Upstream error (${status})`, 502);
  return new CraxError(message || `Upstream error (${status})`, status >= 400 ? status : 502);
}

// --- stream -----------------------------------------------------------------

export interface CraxDelta {
  kind: "text" | "reasoning";
  text: string;
}

/**
 * Failures the relay hands back as ordinary completion content, HTTP 200.
 *
 * All observed against the live host: its own backend connections fail (403,
 * ECONNRESET, ETIMEDOUT, a rejected SOCKS proxy) and the message becomes the
 * "answer". Without this, a caller asking Claude a question gets a reply reading
 * "Error: read ECONNRESET" and no indication anything went wrong.
 *
 * 503 rather than 502 for the pool message: it is explicitly temporary and names
 * its own ETA, so it is worth retrying where a dead proxy connection is not.
 */
const ERROR_SENTINELS: Array<{ re: RegExp; status: number }> = [
  { re: /^please wait for the account pool/i, status: 503 },
  // "Error: " followed by a network/transport failure, not prose. Anchoring on
  // the recognised failure words is what keeps this from matching an answer that
  // merely begins with the word "Error".
  { re: /^error:\s*(unexpected server response|read econnreset|connect etimedout|socks\d? proxy|client network socket|getaddrinfo|connect econnrefused|socket hang up)/i, status: 502 },
];

/**
 * Cap on how much leading content is buffered before deciding.
 *
 * The point is to catch a body that is *nothing but* one of these messages. A
 * real answer that happens to open with "Error:" keeps streaming and so runs past
 * this bound, which is what stops a legitimate reply being swallowed — the same
 * rule lib/onecompiler.ts uses for its plain-text sentinels.
 */
const SENTINEL_MAX_LEN = 160;

function sentinelFor(text: string): { re: RegExp; status: number } | null {
  const trimmed = text.trim();
  if (!trimmed || trimmed.length > SENTINEL_MAX_LEN) return null;
  return ERROR_SENTINELS.find((s) => s.re.test(trimmed)) || null;
}

/**
 * Yield the answer as it streams, stopping at the terminator.
 *
 * Returning on `[DONE]` rather than reading to EOF is load-bearing, not tidiness:
 * the upstream holds the connection open afterwards, so waiting for the stream to
 * end blocks until the request times out. Every response ends this way, including
 * the ones a caller asked for non-streamed.
 *
 * Buffering has to survive two things: SSE frames split across read boundaries,
 * and multi-byte characters split mid-sequence (hence `stream: true` on the
 * decoder, which holds the partial bytes back rather than emitting U+FFFD).
 */
export async function* craxDeltas(res: Response): AsyncGenerator<CraxDelta> {
  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  const parse = function* (line: string): Generator<CraxDelta> {
    // ":" opens an SSE comment — the upstream sends ": keepalive" during long
    // waits, and it carries no payload.
    if (!line.startsWith("data:")) return;
    const payload = line.slice(5).trim();
    if (!payload) return;
    let j: any;
    try {
      j = JSON.parse(payload);
    } catch {
      return;
    }
    if (j?.error?.message) throw new CraxError(j.error.message, 502);
    const d = j?.choices?.[0]?.delta;
    if (!d) return;
    if (typeof d.reasoning_content === "string" && d.reasoning_content) {
      yield { kind: "reasoning", text: d.reasoning_content };
    }
    if (typeof d.content === "string" && d.content) {
      yield { kind: "text", text: d.content };
    }
  };

  // Leading answer text, held back until there is enough of it to tell an error
  // message from a real reply. Reasoning deltas pass straight through — the
  // sentinels only ever appear as content.
  let head = "";
  let decided = false;

  /** Release what was held back, once the content is known not to be an error. */
  const flush = function* (): Generator<CraxDelta> {
    decided = true;
    if (head) {
      yield { kind: "text", text: head };
      head = "";
    }
  };

  /** Gate a delta on the sentinel check, buffering until the answer is clear. */
  const gate = function* (d: CraxDelta): Generator<CraxDelta> {
    if (decided || d.kind === "reasoning") {
      yield d;
      return;
    }
    head += d.text;
    const hit = sentinelFor(head);
    if (hit) throw new CraxError(head.trim(), hit.status);
    // Past the bound it cannot be one of these messages, so stop holding it.
    if (head.length > SENTINEL_MAX_LEN) yield* flush();
  };

  try {
    outer: while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      let nl: number;
      while ((nl = buffer.indexOf("\n")) !== -1) {
        const line = buffer.slice(0, nl).trim();
        buffer = buffer.slice(nl + 1);
        if (line.startsWith("data:") && line.slice(5).trim() === "[DONE]") break outer;
        for (const d of parse(line)) yield* gate(d);
      }
    }
    // A reply shorter than the bound never tripped the flush, so release it —
    // and re-check, since this is the first point the whole answer is known.
    if (!decided && head) {
      const hit = sentinelFor(head);
      if (hit) throw new CraxError(head.trim(), hit.status);
      yield* flush();
    }
  } finally {
    // Cancel rather than drain: the socket does not close on its own.
    await reader.cancel().catch(() => {});
  }
}

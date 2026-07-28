// crax-gpt.vercel.app client (server-side).
//
// An OpenAI-compatible aggregator: one base URL, one bearer key, standard
// `{model, messages, stream}` in and SSE frames out. That makes this the
// thinnest provider module in the codebase — no session to create, no history to
// flatten, no proof-of-work.
//
//   POST /v1/chat/completions   Authorization: Bearer <key>
//
// TWO UPSTREAM QUIRKS, both measured, and both of which hang the caller if missed:
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
//
// The models are advertised names on a third-party aggregator, not verified
// deployments — see CRAX_WARNING in app/api/v1/models/route.ts.

import type { OpenAIMessage } from "./qwen";

export const CRAX_BASE = process.env.CRAX_BASE || "https://crax-gpt.vercel.app/v1";

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
  id: string;
  name: string;
}

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
  { id: "deepseek-v4-flash", name: "DeepSeek V4 Flash" },
  { id: "deepseek-r1", name: "DeepSeek R1" },
  { id: "kimi-k2-6", name: "Kimi K2.6" },
  { id: "glm-5-2", name: "GLM 5.2" },
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
 * Brand mark for a model id, or "" for a neutral chip.
 *
 * Keyed on the id's own prefix rather than modelIcon(), which maps `maker/model`
 * shapes and falls back to the Qwen mark for anything bare — every id here is
 * bare, so routing through it would badge Claude and Llama models as Qwen.
 */
export function craxIcon(id: string): string {
  if (id.startsWith("gpt-")) return "/openai.svg";
  // Fable is an Anthropic model, so it wears the same mark as Claude.
  if (id.startsWith("claude-") || id.startsWith("fable-")) return "/claude.svg";
  if (id.startsWith("gemini-")) return "/gemini.svg";
  if (id.startsWith("deepseek-")) return "/deepseek.svg";
  if (id.startsWith("kimi-")) return "/kimi.svg";
  if (id.startsWith("glm-")) return "/zai.svg";
  if (id.startsWith("llama-")) return "/meta.svg";
  return "";
}

// --- request ----------------------------------------------------------------

export interface CraxCompletionOpts {
  model: string;
  messages: OpenAIMessage[];
}

export async function openCompletion(opts: CraxCompletionOpts): Promise<Response> {
  if (!resolveCraxModel(opts.model)) {
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
      body: JSON.stringify({ model: opts.model, messages: opts.messages, stream: true }),
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
        yield* parse(line);
      }
    }
  } finally {
    // Cancel rather than drain: the socket does not close on its own.
    await reader.cancel().catch(() => {});
  }
}

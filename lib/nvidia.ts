// NVIDIA NIM — models hosted on build.nvidia.com, served through
// integrate.api.nvidia.com.
//
// The thinnest provider in this repo: NVIDIA's endpoint is already an
// OpenAI-compatible /chat/completions, so there is nothing to reverse-engineer.
// Public ids are NVIDIA's own (`z-ai/glm-5.2`), which happen to match the
// maker/model convention used here — no rewriting, and no id that says "free".
//
// Two things about it are not the usual OpenAI shape, and both are handled here:
//
//  1. REASONING IS NOT `reasoning_effort`. It is a two-state switch passed as
//     chat_template_kwargs, and the key is `enable_thinking` — NOT `thinking`,
//     which the endpoint silently ignores (a request sending `thinking:false`
//     comes back reasoning anyway). The pairing below is what build.nvidia.com's
//     own playground sends:
//
//        on   { enable_thinking: true,  clear_thinking: false }
//        off  { enable_thinking: false, clear_thinking: true  }
//
//     Verified against the live endpoint: off yields zero reasoning tokens, on
//     yields a full reasoning_content stream. Reasoning defaults ON because that
//     is the playground's default and these models' natural mode.
//
//  2. ERRORS ARE NOT THE OPENAI ENVELOPE. Failures arrive as
//     `{"status":403,"title":"Forbidden","detail":"Authorization failed"}`, so
//     the usual `error.message` lookup finds nothing. errorMessage() reads all
//     three shapes.
//
// COLD STARTS ARE SLOW. A model that has gone idle can take well over a minute
// to answer, and a buffered (non-stream) request against a cold model has been
// observed hanging past 200s. Upstream is therefore always opened with
// stream:true — headers and the first token land promptly, and a non-stream
// caller is served by buffering that stream here rather than by making the
// upstream buffer it.

import type { OpenAIMessage } from "./qwen";

export const NVIDIA_BASE = (
  process.env.NVIDIA_BASE || "https://integrate.api.nvidia.com/v1"
).replace(/\/+$/, "");

const NVIDIA_API_KEY = process.env.NVIDIA_API_KEY || "";

/**
 * How long to wait for the upstream to START responding.
 *
 * Deliberately generous: NIM cold starts are measured in tens of seconds, and a
 * timeout here turns a slow-but-fine model into a failed request.
 */
const NVIDIA_TIMEOUT_MS = Number(process.env.NVIDIA_TIMEOUT_MS || 120_000);

/** How long a live stream may go quiet between chunks before we cut it. */
const NVIDIA_IDLE_MS = Number(process.env.NVIDIA_IDLE_MS || 120_000);

/** Retries for transient 429/502/503. */
const NVIDIA_RETRIES = Math.max(0, Number(process.env.NVIDIA_RETRIES || 2));

export class NvidiaError extends Error {
  status: number;
  constructor(message: string, status = 502) {
    super(message);
    this.name = "NvidiaError";
    this.status = status;
  }
}

export interface NvidiaModel {
  /** Public id, which is also the id sent upstream. */
  id: string;
  name: string;
  contextLength?: number;
  /**
   * Whether the model reasons, and therefore whether chat_template_kwargs is
   * sent at all. Models without it must not receive the field.
   */
  thinking?: boolean;
}

// GLM-5.2 used to be served from here. It moved to lib/chatglm.ts, which gets
// the Fast/Standard/Deep thinking switch, vision and image generation that this
// endpoint does not expose. Moving the entry back here is the fallback if the
// consumer site's anti-bot scheme changes and that provider stops working.
export const NVIDIA_MODELS: NvidiaModel[] = [
  {
    id: "meta/muse-glimmer-30b",
    name: "Muse Glimmer 30B",
    contextLength: 131_072,
    thinking: true,
  },
];

/** Whether the provider has credentials. Nothing is advertised without them. */
export function nvidiaConfigured(): boolean {
  return NVIDIA_API_KEY.length > 0;
}

export function isNvidiaModel(id: string): boolean {
  return nvidiaConfigured() && NVIDIA_MODELS.some((m) => m.id === id);
}

export function resolveNvidiaModel(id: string): NvidiaModel | null {
  return NVIDIA_MODELS.find((m) => m.id === id) ?? null;
}

/**
 * The chat_template_kwargs for a reasoning model, or undefined when the model
 * does not reason (sending the field to those is not merely useless — it is a
 * template argument the model's chat template has no slot for).
 *
 * Reasoning is on unless the caller explicitly turns it off.
 */
export function thinkingKwargs(
  model: NvidiaModel,
  enableThinking?: boolean
): { enable_thinking: boolean; clear_thinking: boolean } | undefined {
  if (!model.thinking) return undefined;
  const on = enableThinking !== false;
  return { enable_thinking: on, clear_thinking: !on };
}

export interface NvidiaCompletionOpts {
  model: string;
  messages: OpenAIMessage[];
  /**
   * Whether the *caller* wants a streamed response. Upstream is always opened
   * with stream:true; this only affects how the route reassembles the result.
   */
  stream: boolean;
  temperature?: number;
  max_tokens?: number;
  top_p?: number;
  /** false turns reasoning off; omitted or true leaves it on. */
  enableThinking?: boolean;
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

export async function openCompletion(opts: NvidiaCompletionOpts): Promise<Response> {
  if (!NVIDIA_API_KEY) {
    throw new NvidiaError("NVIDIA NIM is not configured. Set NVIDIA_API_KEY.", 402);
  }

  const entry = resolveNvidiaModel(opts.model);
  if (!entry) {
    throw new NvidiaError(`Model '${opts.model}' is not available on NVIDIA NIM.`, 404);
  }

  const kwargs = thinkingKwargs(entry, opts.enableThinking);

  const body = JSON.stringify({
    model: entry.id,
    messages: opts.messages,
    stream: true,
    ...(opts.temperature !== undefined ? { temperature: opts.temperature } : {}),
    ...(opts.max_tokens !== undefined ? { max_tokens: opts.max_tokens } : {}),
    ...(opts.top_p !== undefined ? { top_p: opts.top_p } : {}),
    ...(kwargs ? { chat_template_kwargs: kwargs } : {}),
  });

  let lastErr: NvidiaError | null = null;
  const attempts = 1 + NVIDIA_RETRIES;

  for (let attempt = 0; attempt < attempts; attempt++) {
    if (attempt > 0) await sleep(250 * attempt);

    const ac = new AbortController();
    // TTFB only: once headers arrive the body reader's idle timeout takes over.
    const timer = setTimeout(() => ac.abort(), NVIDIA_TIMEOUT_MS);

    let res: Response;
    try {
      res = await fetch(`${NVIDIA_BASE}/chat/completions`, {
        method: "POST",
        signal: ac.signal,
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${NVIDIA_API_KEY}`,
          Accept: "text/event-stream",
        },
        body,
      });
    } catch (e: any) {
      clearTimeout(timer);
      if (e?.name === "AbortError") {
        lastErr = new NvidiaError(
          `NVIDIA did not respond within ${Math.round(NVIDIA_TIMEOUT_MS / 1000)}s. The model may be cold; try again.`,
          504
        );
        continue; // a cold model is exactly the case worth retrying
      }
      lastErr = new NvidiaError(`Could not reach ${NVIDIA_BASE}: ${e.message}`, 502);
      continue;
    } finally {
      clearTimeout(timer);
    }

    if (!res.ok || !res.body) {
      const text = await res.text().catch(() => "");
      const status = res.status >= 400 ? res.status : 502;
      lastErr = new NvidiaError(errorMessage(text) || `Upstream error (${res.status})`, status);
      if (status === 429 || status === 502 || status === 503 || status === 504) continue;
      throw lastErr;
    }
    return res;
  }

  throw lastErr || new NvidiaError("NVIDIA NIM request failed.", 502);
}

/**
 * A readable message out of whichever envelope came back.
 *
 * NVIDIA uses `detail`/`title` where OpenAI uses `error.message`, so checking
 * only the latter reports an empty error on the most common failure there is
 * (a rejected key).
 */
function errorMessage(body: string): string {
  if (!body) return "";
  try {
    const j = JSON.parse(body);
    return (
      j?.error?.message ||
      j?.detail ||
      j?.message ||
      j?.title ||
      body.slice(0, 300)
    );
  } catch {
    return body.slice(0, 300);
  }
}

export interface NvidiaDelta {
  kind: "text" | "reasoning";
  text: string;
}

/**
 * Yield reply tokens from NVIDIA's OpenAI-style SSE, reasoning included.
 *
 * Tolerant on purpose: unparseable frames are skipped rather than thrown, and
 * both `[DONE]` and a plain end-of-body terminate. A mid-stream error object
 * after a 200 is the one case that interrupts, so a caller is not handed a
 * silently truncated answer.
 */
export async function* nvidiaDeltas(res: Response): AsyncGenerator<NvidiaDelta> {
  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  const readWithIdle = (): Promise<ReadableStreamReadResult<Uint8Array>> =>
    new Promise((resolve, reject) => {
      const idle = setTimeout(() => {
        reader.cancel().catch(() => {});
        reject(
          new NvidiaError(
            `NVIDIA stream went quiet for ${Math.round(NVIDIA_IDLE_MS / 1000)}s.`,
            504
          )
        );
      }, NVIDIA_IDLE_MS);
      reader
        .read()
        .then((r) => {
          clearTimeout(idle);
          resolve(r);
        })
        .catch((e) => {
          clearTimeout(idle);
          reject(e);
        });
    });

  while (true) {
    const { done, value } = await readWithIdle();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    let idx: number;
    while ((idx = buffer.indexOf("\n")) !== -1) {
      const line = buffer.slice(0, idx).trim();
      buffer = buffer.slice(idx + 1);
      if (!line.startsWith("data:")) continue;

      const payload = line.slice(5).trim();
      if (!payload || payload === "[DONE]") continue;

      let j: any;
      try {
        j = JSON.parse(payload);
      } catch {
        continue;
      }
      if (j?.error) {
        await reader.cancel().catch(() => {});
        throw new NvidiaError(j.error.message || j.detail || "Upstream error mid-stream", 502);
      }

      const delta = j?.choices?.[0]?.delta;
      if (!delta || typeof delta !== "object") continue;

      const reasoning = delta.reasoning_content;
      if (typeof reasoning === "string" && reasoning) {
        yield { kind: "reasoning", text: reasoning };
      }
      const content = delta.content;
      if (typeof content === "string" && content) {
        yield { kind: "text", text: content };
      }
    }
  }
}

/** The whole reply from a non-streaming response (text + optional reasoning). */
export function nvidiaText(json: any): { content: string; reasoning: string } {
  const c = json?.choices?.[0];
  const msg = c?.message ?? {};
  const content = typeof msg.content === "string" ? msg.content : "";
  const reasoning = typeof msg.reasoning_content === "string" ? msg.reasoning_content : "";
  return { content, reasoning };
}

// OpenCode Zen — promo / stealth models (Big Pickle and friends) via the
// OpenAI-compatible chat/completions endpoint.
//
// OpenCode Zen is the gateway behind OpenCode CLI's curated model list
// (https://opencode.ai/zen). Paid models use mixed wire formats (Responses,
// Anthropic Messages, Google); the tier we expose here is all chat/
// completions, so this module stays as thin as TokenRouter.
//
// Operational notes:
//
//  - Requires an OpenCode Zen API key (sign in at https://opencode.ai/auth,
//    or reuse the key OpenCode CLI stores after `/connect`). Without a key the
//    models are not advertised and not routable — same gate as TokenRouter.
//  - Public ids never include "free" / "-free". Zen's upstream free-tier slugs
//    (when they differ) live only in `upstreamId`.
//  - Cloudflare sits in front of opencode.ai and rejects bare urllib-style
//    clients (error 1010). A browser-ish User-Agent is required.
//  - Promo models may use collected prompts to improve the model — treat them
//    as best-effort, not a private backend.
//  - Big Pickle can reason but OpenCode lists no variants for it — no effort UI.
//  - Effort levels mirror OpenCode's catalog (`variants`); empty = unsupported.
//  - Upstream is always opened with stream:true (headers land immediately).
//    Non-stream callers still get a full JSON body; we buffer the SSE for them.

import type { OpenAIMessage } from "./qwen";
import {
  LOW_MED_HIGH_EFFORT,
  NORTH_MINI_EFFORT,
  defaultEffort,
  type ReasoningEffort,
} from "./reasoningEffort";

export const OPENCODE_ZEN_BASE = (
  process.env.OPENCODE_ZEN_BASE || "https://opencode.ai/zen/v1"
).replace(/\/+$/, "");

const OPENCODE_ZEN_API_KEY = process.env.OPENCODE_ZEN_API_KEY || "";

/**
 * How long to wait for the upstream to START responding (headers / first byte).
 *
 * Promo capacity is flaky: a saturated free endpoint can hang indefinitely.
 * Fail with a named status rather than burning the 300s function ceiling.
 */
const OPENCODE_ZEN_TIMEOUT_MS = Number(process.env.OPENCODE_ZEN_TIMEOUT_MS || 45_000);

/** How long a live stream may go quiet between chunks before we cut it. */
const OPENCODE_ZEN_IDLE_MS = Number(process.env.OPENCODE_ZEN_IDLE_MS || 60_000);

/** Retries for transient Zen 502/503 (promo endpoints flap often). */
const OPENCODE_ZEN_RETRIES = Math.max(0, Number(process.env.OPENCODE_ZEN_RETRIES || 2));

/** UA that Cloudflare accepts — bare node fetch / urllib is blocked (1010). */
const OPENCODE_ZEN_UA =
  process.env.OPENCODE_ZEN_USER_AGENT ||
  "Mozilla/5.0 (compatible; Syde/1.0; +https://opencode.ai) OpenCode/1.18.16";

export class OpenCodeZenError extends Error {
  status: number;
  constructor(message: string, status = 502) {
    super(message);
    this.name = "OpenCodeZenError";
    this.status = status;
  }
}

export interface OpenCodeZenModel {
  /** Public id callers request — never contains "free". */
  id: string;
  /** Display name — never contains "Free". */
  name: string;
  /** Bare model id sent to Zen (may still end in -free). */
  upstreamId: string;
  /** Context window Zen documents for the model, when known. */
  contextLength?: number;
  thinking?: boolean;
  /**
   * Supported `reasoning_effort` values for this model. Empty/undefined means
   * the model does not expose multi-level effort (do not send the field).
   */
  reasoningEffort?: readonly ReasoningEffort[];
}

/**
 * Promo / stealth models served over `/chat/completions`. Paid Zen models use
 * other wire formats and are deliberately not listed.
 *
 * Public id + name are product names only. The free-tier Zen slug stays in
 * `upstreamId` when Zen requires it.
 */
export const OPENCODE_ZEN_MODELS: OpenCodeZenModel[] = [
  {
    id: "opencode/big-pickle",
    name: "Big Pickle",
    upstreamId: "big-pickle",
    contextLength: 200_000,
    // Reasons, but OpenCode variants is empty — no effort switch.
    thinking: true,
  },
  // DeepSeek V4 Flash used to be served here on Zen's free tier. OneCompiler
  // now carries it, and that pool does not need a Zen key, so the id moved to
  // lib/onecompiler.ts. It loses the effort ladder in the process — OneCompiler
  // exposes no reasoning_effort — which is the trade for it always being listed.
  {
    id: "opencode/mimo-v2.5",
    name: "MiMo v2.5",
    upstreamId: "mimo-v2.5-free",
    // variants empty
    thinking: true,
  },
  {
    id: "opencode/laguna-s-2.1",
    name: "Laguna S 2.1",
    upstreamId: "laguna-s-2.1-free",
    thinking: true,
    // variants: low, medium, high
    reasoningEffort: LOW_MED_HIGH_EFFORT,
  },
  {
    id: "opencode/ling-3.0-tiny",
    name: "Ling 3.0 Tiny",
    upstreamId: "ling-3.0-tiny-free",
    // variants empty
    thinking: true,
  },
  {
    id: "opencode/longcat-2.0",
    name: "LongCat 2.0",
    upstreamId: "longcat-2.0-free",
    thinking: true,
    // variants: low, medium, high
    reasoningEffort: LOW_MED_HIGH_EFFORT,
  },
  {
    id: "nvidia/nemotron-3-ultra",
    name: "Nemotron 3 Ultra",
    upstreamId: "nemotron-3-ultra-free",
    // variants empty
    thinking: true,
  },
  {
    id: "cohere/north-mini-code",
    name: "North Mini Code",
    upstreamId: "north-mini-code-free",
    thinking: true,
    // variants: none, high
    reasoningEffort: NORTH_MINI_EFFORT,
  },
];
/** Whether the provider has credentials. Nothing is advertised without them. */
export function openCodeZenConfigured(): boolean {
  return OPENCODE_ZEN_API_KEY.length > 0;
}

export function isOpenCodeZenModel(id: string): boolean {
  return openCodeZenConfigured() && OPENCODE_ZEN_MODELS.some((m) => m.id === id);
}

export function resolveOpenCodeZenModel(id: string): OpenCodeZenModel | null {
  return OPENCODE_ZEN_MODELS.find((m) => m.id === id) ?? null;
}

export interface OpenCodeZenCompletionOpts {
  /** Public model id (`opencode/big-pickle`). */
  model: string;
  messages: OpenAIMessage[];
  /**
   * Whether the *caller* wants a streamed response. Upstream is always opened
   * with stream:true; this flag only affects Accept and how the route buffers.
   */
  stream: boolean;
  temperature?: number;
  max_tokens?: number;
  /**
   * Zen reasoning_effort. When omitted, models that support effort default to
   * "none" (or the first listed level). enableThinking maps true→medium,
   * false→none when no explicit effort is set.
   */
  reasoningEffort?: string;
  enableThinking?: boolean;
}

/** Map caller knobs onto a Zen reasoning_effort value. */
export function resolveReasoningEffort(opts: {
  model: OpenCodeZenModel;
  reasoningEffort?: string;
  enableThinking?: boolean;
}): string | undefined {
  const levels = opts.model.reasoningEffort;
  if (!levels || levels.length === 0) return undefined;
  if (typeof opts.reasoningEffort === "string" && opts.reasoningEffort.trim()) {
    return opts.reasoningEffort.trim().toLowerCase();
  }
  if (opts.enableThinking === true) {
    return levels.includes("medium" as ReasoningEffort) ? "medium" : levels[levels.length - 1];
  }
  if (opts.enableThinking === false) {
    return levels.includes("none" as ReasoningEffort) ? "none" : levels[0];
  }
  return defaultEffort(levels);
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

export async function openCompletion(opts: OpenCodeZenCompletionOpts): Promise<Response> {
  if (!OPENCODE_ZEN_API_KEY) {
    throw new OpenCodeZenError("OpenCode Zen is not configured. Set OPENCODE_ZEN_API_KEY.", 402);
  }

  const entry = resolveOpenCodeZenModel(opts.model);
  if (!entry) {
    throw new OpenCodeZenError(`Model '${opts.model}' is not available on OpenCode Zen.`, 404);
  }

  const reasoningEffort = resolveReasoningEffort({
    model: entry,
    reasoningEffort: opts.reasoningEffort,
    enableThinking: opts.enableThinking,
  });

  // Always stream from Zen: headers land immediately and the free tier's
  // multi-second think phases no longer look like a hung non-stream POST.
  const body = JSON.stringify({
    model: entry.upstreamId,
    messages: opts.messages,
    stream: true,
    ...(opts.temperature !== undefined ? { temperature: opts.temperature } : {}),
    ...(opts.max_tokens !== undefined ? { max_tokens: opts.max_tokens } : {}),
    ...(reasoningEffort ? { reasoning_effort: reasoningEffort } : {}),
  });

  let lastErr: OpenCodeZenError | null = null;
  const attempts = 1 + OPENCODE_ZEN_RETRIES;

  for (let attempt = 0; attempt < attempts; attempt++) {
    if (attempt > 0) await sleep(250 * attempt);

    const ac = new AbortController();
    // TTFB only: once headers arrive we clear this and let idle-timeout on the
    // body reader handle a stream that goes quiet mid-reply.
    const timer = setTimeout(() => ac.abort(), OPENCODE_ZEN_TIMEOUT_MS);

    let res: Response;
    try {
      res = await fetch(`${OPENCODE_ZEN_BASE}/chat/completions`, {
        method: "POST",
        signal: ac.signal,
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${OPENCODE_ZEN_API_KEY}`,
          Accept: "text/event-stream",
          "User-Agent": OPENCODE_ZEN_UA,
        },
        body,
      });
    } catch (e: any) {
      clearTimeout(timer);
      if (e?.name === "AbortError") {
        lastErr = new OpenCodeZenError(
          `OpenCode Zen did not respond within ${Math.round(OPENCODE_ZEN_TIMEOUT_MS / 1000)}s. The free tier is likely saturated; try again or use another model.`,
          504
        );
        continue; // retry timeout too — capacity is the usual cause
      }
      lastErr = new OpenCodeZenError(`Could not reach ${OPENCODE_ZEN_BASE}: ${e.message}`, 502);
      continue;
    } finally {
      clearTimeout(timer);
    }

    if (!res.ok || !res.body) {
      const text = await res.text().catch(() => "");
      const status = res.status >= 400 ? res.status : 502;
      lastErr = new OpenCodeZenError(errorMessage(text) || `Upstream error (${res.status})`, status);
      // Retry only the flaky free-tier capacity errors, not 401/404/400.
      if (status === 429 || status === 502 || status === 503 || status === 504) continue;
      throw lastErr;
    }
    return res;
  }

  throw lastErr || new OpenCodeZenError("OpenCode Zen request failed.", 502);
}

/** Pull a human-readable message out of whichever error envelope came back. */
function errorMessage(body: string): string {
  if (!body) return "";
  try {
    const j = JSON.parse(body);
    return j?.error?.message || j?.message || body.slice(0, 300);
  } catch {
    return body.slice(0, 300);
  }
}

export interface OpenCodeZenDelta {
  kind: "text" | "reasoning";
  text: string;
}

/**
 * Yield reply tokens from an OpenAI-style SSE stream, including reasoning.
 *
 * Tolerant on purpose: unparseable frames are skipped rather than thrown, and
 * both `[DONE]` and a plain end-of-body terminate. Mid-stream error objects
 * after a 200 are the one case that interrupts, so the caller is not left with
 * a silently truncated answer.
 *
 * An idle timeout aborts a stream that went quiet (common when free capacity
 * dies mid-token) rather than hanging the function until maxDuration.
 */
export async function* openCodeZenDeltas(res: Response): AsyncGenerator<OpenCodeZenDelta> {
  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  const readWithIdle = (): Promise<ReadableStreamReadResult<Uint8Array>> =>
    new Promise((resolve, reject) => {
      const idle = setTimeout(() => {
        reader.cancel().catch(() => {});
        reject(
          new OpenCodeZenError(
            `OpenCode Zen stream went quiet for ${Math.round(OPENCODE_ZEN_IDLE_MS / 1000)}s. The free tier likely dropped the connection.`,
            504
          )
        );
      }, OPENCODE_ZEN_IDLE_MS);
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
        throw new OpenCodeZenError(j.error.message || "Upstream error mid-stream", 502);
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
export function openCodeZenText(json: any): { content: string; reasoning: string } {
  const c = json?.choices?.[0];
  const msg = c?.message ?? {};
  const content = typeof msg.content === "string" ? msg.content : typeof c?.text === "string" ? c.text : "";
  const reasoning =
    typeof msg.reasoning_content === "string"
      ? msg.reasoning_content
      : typeof msg.reasoning === "string"
        ? msg.reasoning
        : "";
  return { content, reasoning };
}

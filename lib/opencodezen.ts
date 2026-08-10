// OpenCode Zen — free / stealth models (Big Pickle and friends) via the
// OpenAI-compatible chat/completions endpoint.
//
// OpenCode Zen is the gateway behind OpenCode CLI's curated model list
// (https://opencode.ai/zen). Paid models use mixed wire formats (Responses,
// Anthropic Messages, Google); the free tier we expose here is all chat/
// completions, so this module stays as thin as TokenRouter.
//
// Operational notes:
//
//  - Requires an OpenCode Zen API key (sign in at https://opencode.ai/auth,
//    or reuse the key OpenCode CLI stores after `/connect`). Without a key the
//    models are not advertised and not routable — same gate as TokenRouter.
//  - Public ids are namespaced `opencode/<zen-id>` so the catalogue groups
//    under OpenCode; the request to Zen rewrites to the bare model id.
//  - Cloudflare sits in front of opencode.ai and rejects bare urllib-style
//    clients (error 1010). A browser-ish User-Agent is required.
//  - Free models may use collected prompts to improve the model during the
//    promo window — treat them as best-effort, not a private backend.
//  - Big Pickle streams `reasoning_content` before `content`. We surface both
//    so callers that honour reasoning_content see the think phase.

import type { OpenAIMessage } from "./qwen";

export const OPENCODE_ZEN_BASE = (
  process.env.OPENCODE_ZEN_BASE || "https://opencode.ai/zen/v1"
).replace(/\/+$/, "");

const OPENCODE_ZEN_API_KEY = process.env.OPENCODE_ZEN_API_KEY || "";

/**
 * How long to wait for the upstream to START responding.
 *
 * Free stealth models (especially Big Pickle) often spend tens of seconds in a
 * reasoning phase before the first content token. Bound TTFB so a saturated
 * free tier fails with a named status rather than burning the 300s ceiling.
 */
const OPENCODE_ZEN_TIMEOUT_MS = Number(process.env.OPENCODE_ZEN_TIMEOUT_MS || 90_000);

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
  /** Public id callers request, e.g. `opencode/big-pickle`. */
  id: string;
  name: string;
  /** Bare model id sent to Zen, e.g. `big-pickle`. */
  upstreamId: string;
  /** Context window Zen documents for the model, when known. */
  contextLength?: number;
  thinking?: boolean;
}

/**
 * Free-tier models served over `/chat/completions`. Paid Zen models use other
 * wire formats and are deliberately not listed — this registry is the free set
 * only, so an unset key never offers a model that would bill the account.
 */
export const OPENCODE_ZEN_MODELS: OpenCodeZenModel[] = [
  {
    id: "opencode/big-pickle",
    name: "Big Pickle",
    upstreamId: "big-pickle",
    contextLength: 200_000,
    thinking: true,
  },
  // Public id drops "-free" and the display name is the product name; Zen still
  // needs the free-tier upstream id.
  {
    id: "deepseek/deepseek-v4-flash",
    name: "DeepSeek V4 Flash",
    upstreamId: "deepseek-v4-flash-free",
    thinking: false,
  },
  {
    id: "opencode/mimo-v2.5-free",
    name: "MiMo v2.5 Free",
    upstreamId: "mimo-v2.5-free",
    thinking: false,
  },
  {
    id: "opencode/laguna-s-2.1-free",
    name: "Laguna S 2.1 Free",
    upstreamId: "laguna-s-2.1-free",
    thinking: false,
  },
  {
    id: "opencode/ling-3.0-tiny-free",
    name: "Ling 3.0 Tiny Free",
    upstreamId: "ling-3.0-tiny-free",
    thinking: false,
  },
  {
    id: "opencode/longcat-2.0-free",
    name: "LongCat 2.0 Free",
    upstreamId: "longcat-2.0-free",
    thinking: false,
  },
  {
    id: "nvidia/nemotron-3-ultra-free",
    name: "Nemotron 3 Ultra Free",
    upstreamId: "nemotron-3-ultra-free",
    thinking: false,
  },
  {
    id: "cohere/north-mini-code-free",
    name: "North Mini Code Free",
    upstreamId: "north-mini-code-free",
    thinking: false,
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
  stream: boolean;
  temperature?: number;
  max_tokens?: number;
}

export async function openCompletion(opts: OpenCodeZenCompletionOpts): Promise<Response> {
  if (!OPENCODE_ZEN_API_KEY) {
    throw new OpenCodeZenError("OpenCode Zen is not configured. Set OPENCODE_ZEN_API_KEY.", 402);
  }

  const entry = resolveOpenCodeZenModel(opts.model);
  if (!entry) {
    throw new OpenCodeZenError(`Model '${opts.model}' is not available on OpenCode Zen.`, 404);
  }

  // Bounds time-to-first-byte only. Once the stream is flowing the caller reads
  // at its own pace, so this cannot sever a long but healthy reply.
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), OPENCODE_ZEN_TIMEOUT_MS);

  let res: Response;
  try {
    res = await fetch(`${OPENCODE_ZEN_BASE}/chat/completions`, {
      method: "POST",
      signal: ac.signal,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${OPENCODE_ZEN_API_KEY}`,
        Accept: opts.stream ? "text/event-stream" : "application/json",
        "User-Agent": OPENCODE_ZEN_UA,
      },
      body: JSON.stringify({
        model: entry.upstreamId,
        messages: opts.messages,
        stream: opts.stream,
        ...(opts.temperature !== undefined ? { temperature: opts.temperature } : {}),
        ...(opts.max_tokens !== undefined ? { max_tokens: opts.max_tokens } : {}),
      }),
    });
  } catch (e: any) {
    if (e?.name === "AbortError") {
      throw new OpenCodeZenError(
        `OpenCode Zen did not respond within ${Math.round(OPENCODE_ZEN_TIMEOUT_MS / 1000)}s. The free tier is likely saturated; try again or use another model.`,
        504
      );
    }
    throw new OpenCodeZenError(`Could not reach ${OPENCODE_ZEN_BASE}: ${e.message}`, 502);
  } finally {
    clearTimeout(timer);
  }

  if (!res.ok || (opts.stream && !res.body)) {
    const text = await res.text().catch(() => "");
    // 429 is the expected steady state on a free promo under load — pass it
    // through so a caller that can back off is told the truth.
    const status = res.status >= 400 ? res.status : 502;
    throw new OpenCodeZenError(errorMessage(text) || `Upstream error (${res.status})`, status);
  }
  return res;
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
 */
export async function* openCodeZenDeltas(res: Response): AsyncGenerator<OpenCodeZenDelta> {
  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
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

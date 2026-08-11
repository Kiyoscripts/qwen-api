// TokenRouter — a third-party gateway fronting Kimi K3 on a free tier.
//
// Unlike Qwen and OneCompiler this upstream is already OpenAI-compatible, so
// there is no conversation flattening and no bespoke wire format: messages go
// out with their roles intact and come back as ordinary OpenAI SSE chunks. That
// makes this the thinnest provider in the codebase, and the parsing below is
// deliberately tolerant rather than clever.
//
// Operational notes, because they shaped the code:
//
//  - The free tier is promotional capacity with no published rate limits, no
//    documented quotas and no terms of service. Treat it as best-effort: it is
//    never a default, and every failure path below degrades instead of throwing
//    the caller's request away.
//  - Two hosts circulate under this name. api.tokenrouter.com is the one that
//    authenticates and serves the model; tokenrouter.me answers the same routes
//    but rejects the key with INVALID_API_KEY. The base URL stays configurable,
//    but the default is the host verified to work.
//  - Unconfigured means absent, not broken: with no key the model is not
//    advertised and not routable, so the site runs exactly as it did before.

import type { OpenAIMessage } from "./qwen";
import { KIMI_K3_EFFORT, type ReasoningEffort } from "./reasoningEffort";

export const TOKENROUTER_BASE = (process.env.TOKENROUTER_BASE || "https://api.tokenrouter.com/v1").replace(/\/+$/, "");

const TOKENROUTER_API_KEY = process.env.TOKENROUTER_API_KEY || "";

/**
 * How long to wait for the upstream to START responding.
 *
 * Measured: /models answers instantly with a valid key, while
 * /chat/completions returned zero bytes for over 120s on both the streaming and
 * buffered paths. Without a bound, one saturated free-tier request occupies the
 * route for its full 300s ceiling and the caller learns nothing until it dies.
 * Fail fast with a status that names the problem instead.
 */
const TOKENROUTER_TIMEOUT_MS = Number(process.env.TOKENROUTER_TIMEOUT_MS || 60_000);

export class TokenRouterError extends Error {
  status: number;
  constructor(message: string, status = 502) {
    super(message);
    this.name = "TokenRouterError";
    this.status = status;
  }
}

export interface TokenRouterModel {
  /** Public id callers request (no "-free" suffix). */
  id: string;
  name: string;
  /** Id sent upstream when it differs from the public id. */
  upstreamId?: string;
  /** Supported reasoning_effort values, if any. */
  reasoningEffort?: readonly ReasoningEffort[];
}

/**
 * The registry. Only ids listed here are routable, so an unknown model falls
 * through to the Qwen path rather than being blindly forwarded upstream.
 */
export const TOKENROUTER_MODELS: TokenRouterModel[] = [
  // Public id is kimi-k3; the free-tier gateway still wants the free slug.
  {
    id: "moonshotai/kimi-k3",
    name: "Kimi K3",
    upstreamId: "moonshotai/kimi-k3-free",
    // Kimi documents low / high / max.
    reasoningEffort: KIMI_K3_EFFORT,
  },
];

/** Whether the provider has credentials. Nothing is advertised without them. */
export function tokenRouterConfigured(): boolean {
  return TOKENROUTER_API_KEY.length > 0;
}

export function isTokenRouterModel(id: string): boolean {
  return tokenRouterConfigured() && TOKENROUTER_MODELS.some((m) => m.id === id);
}

export function resolveTokenRouterModel(id: string): TokenRouterModel | null {
  return TOKENROUTER_MODELS.find((m) => m.id === id) ?? null;
}

export interface TokenRouterCompletionOpts {
  model: string;
  messages: OpenAIMessage[];
  stream: boolean;
  temperature?: number;
  max_tokens?: number;
  reasoningEffort?: string;
}

export async function openCompletion(opts: TokenRouterCompletionOpts): Promise<Response> {
  if (!TOKENROUTER_API_KEY) {
    throw new TokenRouterError("TokenRouter is not configured. Set TOKENROUTER_API_KEY.", 402);
  }

  const entry = resolveTokenRouterModel(opts.model);
  const upstreamModel = entry?.upstreamId || opts.model;

  // Bounds time-to-first-byte only. Once the stream is flowing the caller reads
  // at its own pace, so this cannot sever a long but healthy reply.
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), TOKENROUTER_TIMEOUT_MS);

  let res: Response;
  try {
    res = await fetch(`${TOKENROUTER_BASE}/chat/completions`, {
      method: "POST",
      signal: ac.signal,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${TOKENROUTER_API_KEY}`,
        Accept: opts.stream ? "text/event-stream" : "application/json",
      },
      body: JSON.stringify({
        model: upstreamModel,
        messages: opts.messages,
        stream: opts.stream,
        ...(opts.temperature !== undefined ? { temperature: opts.temperature } : {}),
        ...(opts.max_tokens !== undefined ? { max_tokens: opts.max_tokens } : {}),
        ...(opts.reasoningEffort ? { reasoning_effort: opts.reasoningEffort } : {}),
      }),
    });
  } catch (e: any) {
    if (e?.name === "AbortError") {
      throw new TokenRouterError(
        `TokenRouter did not respond within ${Math.round(TOKENROUTER_TIMEOUT_MS / 1000)}s. The free tier is likely saturated; try again or use another model.`,
        504
      );
    }
    throw new TokenRouterError(`Could not reach ${TOKENROUTER_BASE}: ${e.message}`, 502);
  } finally {
    clearTimeout(timer);
  }

  if (!res.ok || (opts.stream && !res.body)) {
    const text = await res.text().catch(() => "");
    // 429 is the expected steady state on a free tier under load, so it is passed
    // through verbatim: a caller that can back off deserves to know it is rate
    // limited rather than being told the service is broken.
    const status = res.status >= 400 ? res.status : 502;
    throw new TokenRouterError(errorMessage(text) || `Upstream error (${res.status})`, status);
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

export interface TokenRouterDelta {
  kind: "text";
  text: string;
}

/**
 * Yield the reply from an OpenAI-style SSE stream.
 *
 * Tolerant on purpose: an unparseable frame is skipped rather than thrown,
 * because a single malformed keepalive or vendor-specific frame should not
 * destroy a reply that is otherwise streaming fine. Both `[DONE]` and a plain
 * end-of-body terminate, since not every gateway sends the sentinel.
 */
export async function* tokenRouterDeltas(res: Response): AsyncGenerator<TokenRouterDelta> {
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
      if (!line.startsWith("data:")) continue; // comments, blank lines, event: frames

      const payload = line.slice(5).trim();
      if (!payload || payload === "[DONE]") continue;

      let j: any;
      try {
        j = JSON.parse(payload);
      } catch {
        continue;
      }
      // An error can arrive mid-stream after a 200, which is the one case worth
      // interrupting for: continuing would silently truncate the answer.
      if (j?.error) {
        await reader.cancel().catch(() => {});
        throw new TokenRouterError(j.error.message || "Upstream error mid-stream", 502);
      }
      const text = j?.choices?.[0]?.delta?.content;
      if (typeof text === "string" && text) yield { kind: "text", text };
    }
  }
}

/** The whole reply from a non-streaming response. */
export function tokenRouterText(json: any): string {
  const c = json?.choices?.[0];
  const content = c?.message?.content ?? c?.text ?? "";
  return typeof content === "string" ? content : "";
}

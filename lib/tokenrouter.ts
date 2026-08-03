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
//  - Two hosts circulate under this name and behave differently, so the base URL
//    is configurable rather than hardcoded to whichever one was reachable first.
//  - Unconfigured means absent, not broken: with no key the model is not
//    advertised and not routable, so the site runs exactly as it did before.

import type { OpenAIMessage } from "./qwen";

export const TOKENROUTER_BASE = (process.env.TOKENROUTER_BASE || "https://tokenrouter.me/v1").replace(/\/+$/, "");

const TOKENROUTER_API_KEY = process.env.TOKENROUTER_API_KEY || "";

export class TokenRouterError extends Error {
  status: number;
  constructor(message: string, status = 502) {
    super(message);
    this.name = "TokenRouterError";
    this.status = status;
  }
}

export interface TokenRouterModel {
  id: string;
  name: string;
}

/**
 * The registry. Only ids listed here are routable, so an unknown model falls
 * through to the Qwen path rather than being blindly forwarded upstream.
 */
export const TOKENROUTER_MODELS: TokenRouterModel[] = [
  { id: "moonshotai/kimi-k3-free", name: "Kimi K3 (free)" },
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
}

export async function openCompletion(opts: TokenRouterCompletionOpts): Promise<Response> {
  if (!TOKENROUTER_API_KEY) {
    throw new TokenRouterError("TokenRouter is not configured. Set TOKENROUTER_API_KEY.", 402);
  }

  let res: Response;
  try {
    res = await fetch(`${TOKENROUTER_BASE}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${TOKENROUTER_API_KEY}`,
        Accept: opts.stream ? "text/event-stream" : "application/json",
      },
      body: JSON.stringify({
        model: opts.model,
        messages: opts.messages,
        stream: opts.stream,
        ...(opts.temperature !== undefined ? { temperature: opts.temperature } : {}),
        ...(opts.max_tokens !== undefined ? { max_tokens: opts.max_tokens } : {}),
      }),
    });
  } catch (e: any) {
    throw new TokenRouterError(`Could not reach ${TOKENROUTER_BASE}: ${e.message}`, 502);
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

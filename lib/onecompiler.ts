// onecompiler.com/chat client (server-side). Reverse-engineered from the web app.
//
// The simplest upstream of the three: one endpoint, a bearer token, and a body
// that keeps real roles — no session to create, no proof-of-work, no history
// flattening (see conversation.ts for why the Qwen path needs that).
//
//   POST /api/ai/stream   Authorization: Bearer <token>
//   { model: {maker, modelId}, module, usecase, conversation: [{role, content}],
//     currentMessage: string, metadata: {} }
//
// Only the models the site's Free tier can run are exposed; its "Premium" ones
// are absent from the registry, so asking for one is a 404 rather than an attempt
// to reach past the paywall.
//
// TWO UPSTREAM QUIRKS, both handled below and both easy to get wrong:
//
//  1. The response is RAW TEXT, not SSE. It is served as `text/event-stream`, but
//     there are no `data:` prefixes, no JSON envelope and no terminator — the body
//     simply is the answer. Parsing it as SSE yields nothing at all.
//  2. Failures arrive as HTTP 200 with a plain-text sentence as the whole body
//     (e.g. an unauthenticated request answers "Please login to use this
//     feature."). Status codes cannot be trusted to signal an error.

import type { OpenAIMessage } from "./qwen";
import { messageText } from "./qwen";
import { modelIcon } from "./modelIcons";

export const ONECOMPILER_BASE = process.env.ONECOMPILER_BASE || "https://onecompiler.com";

// Bearer token from a signed-in session. Optional owner-wide fallback, mirroring
// the Qwen pool's env token; without it this provider is unavailable (the endpoint refuses
// anonymous callers outright).
const ONECOMPILER_TOKEN = process.env.ONECOMPILER_TOKEN || "";

export class OneCompilerError extends Error {
  status: number;
  constructor(message: string, status = 502) {
    super(message);
    this.status = status;
  }
}

// --- model registry ---------------------------------------------------------
// Public id is "<maker>/<modelId>", split back apart when building the request,
// so what a caller asks for is exactly what runs. Captured from the site's model
// picker together with its per-model Free/Premium state.
//
// ONLY Free-tier models belong here. The site's Premium models — GPT 5.3 Codex,
// GPT 5.5, GPT 5.6 Sol, Claude Opus 4.8, Claude Sonnet 5, Claude Haiku 4.5 — are
// intentionally omitted.
export interface OneCompilerModel {
  id: string; // "<maker>/<modelId>"
  name: string;
}

export const ONECOMPILER_MODELS: OneCompilerModel[] = [
  { id: "openai/gpt-5.4-mini", name: "GPT 5.4 Mini" },
  { id: "openai/gpt-5.4-nano", name: "GPT 5.4 Nano" },
  { id: "openai/gpt-5.6-luna", name: "GPT 5.6 Luna" },
  { id: "google/gemma-3.12b", name: "Gemma 3 12B" },
  { id: "deepseek/deepseek-v4-pro", name: "DeepSeek V4 Pro" },
  { id: "moonshotai/kimi-k2.6", name: "Kimi K2.6" },
  { id: "moonshotai/kimi-k2.7-code", name: "Kimi K2.7 Code" },
  { id: "qwen/qwen3-coder-480b", name: "Qwen3 Coder 480B" },
  { id: "xai/grok-4.3", name: "Grok 4.3" },
  { id: "xai/grok-code-fast-1", name: "Grok Code Fast 1" },
];

/**
 * Exact-match only, deliberately.
 *
 * A prefix test would be wrong: these ids carry a maker prefix, so a loose
 * `startsWith` would also swallow bare ids belonging to other providers.
 * Matching the registry exactly means an unknown id falls through to the Qwen
 * path instead of being claimed here, and a Premium model — absent from the
 * registry — is never claimed at all.
 */
export function isOneCompilerModel(id: string): boolean {
  return ONECOMPILER_MODELS.some((m) => m.id === id);
}

export function resolveOneCompilerModel(id: string): OneCompilerModel | null {
  return ONECOMPILER_MODELS.find((m) => m.id === id) || null;
}

/** Brand mark for a model id. See lib/modelIcons.ts for the mapping. */
export function oneCompilerIcon(id: string): string {
  return modelIcon(id);
}

// --- request ----------------------------------------------------------------

const CHROME_VERSION = "140";
const USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 " +
  `(KHTML, like Gecko) Chrome/${CHROME_VERSION}.0.0.0 Safari/537.36`;

function headers(token: string): Record<string, string> {
  return {
    "Content-Type": "application/json",
    Accept: "*/*",
    "Accept-Language": "en-US,en;q=0.9",
    Authorization: `Bearer ${token}`,
    Origin: ONECOMPILER_BASE,
    Referer: `${ONECOMPILER_BASE}/chat`,
    "User-Agent": USER_AGENT,
    "sec-ch-ua": `"Chromium";v="${CHROME_VERSION}", "Not=A?Brand";v="${CHROME_VERSION}", "Google Chrome";v="${CHROME_VERSION}"`,
    "sec-ch-ua-mobile": "?0",
    "sec-ch-ua-platform": '"macOS"',
  };
}

/**
 * Split an OpenAI message array into the upstream's two fields.
 *
 * The last user turn becomes `currentMessage`; everything before it becomes
 * `conversation`. Only user/assistant roles were observed upstream, so system
 * prompts are prepended to the current message rather than sent as a role the
 * endpoint may quietly drop — an ignored system prompt is worse than a visible
 * one, because the caller's instructions would simply not apply.
 */
export function splitConversation(messages: OpenAIMessage[]): {
  conversation: Array<{ role: "user" | "assistant"; content: string }>;
  currentMessage: string;
} {
  const system: string[] = [];
  const turns: Array<{ role: "user" | "assistant"; content: string }> = [];

  for (const m of messages) {
    const content = messageText(m).trim();
    if (!content) continue;
    if (m.role === "system") system.push(content);
    else turns.push({ role: m.role === "assistant" ? "assistant" : "user", content });
  }

  // The final turn is what we are asking about; the rest is context.
  const last = turns.pop();
  let currentMessage = last?.content ?? "";
  if (system.length) currentMessage = `${system.join("\n\n")}\n\n${currentMessage}`.trim();

  return { conversation: turns, currentMessage };
}

export interface OneCompilerCompletionOpts {
  model: string; // "<maker>/<modelId>"
  messages: OpenAIMessage[];
  token?: string;
}

export async function openCompletion(opts: OneCompilerCompletionOpts): Promise<Response> {
  const token = opts.token || ONECOMPILER_TOKEN;
  if (!token) {
    throw new OneCompilerError(
      "No OneCompiler token configured. Set ONECOMPILER_TOKEN to a signed-in session's bearer token.",
      402
    );
  }

  const slash = opts.model.indexOf("/");
  const maker = opts.model.slice(0, slash);
  const modelId = opts.model.slice(slash + 1);
  const { conversation, currentMessage } = splitConversation(opts.messages);

  let res: Response;
  try {
    res = await fetch(`${ONECOMPILER_BASE}/api/ai/stream`, {
      method: "POST",
      headers: headers(token),
      body: JSON.stringify({
        model: { maker, modelId },
        module: "chat",
        usecase: "general",
        conversation,
        currentMessage,
        metadata: {},
      }),
    });
  } catch (e: any) {
    throw new OneCompilerError(`Could not reach ${ONECOMPILER_BASE}: ${e.message}`, 502);
  }

  if (!res.ok || !res.body) {
    const text = await res.text().catch(() => "");
    throw new OneCompilerError(text.slice(0, 300) || `Upstream error (${res.status})`, res.status >= 400 ? res.status : 502);
  }

  // A spent account answers HTTP 200 and only reveals itself in the body, so the
  // failure has to be found HERE — before the caller starts streaming — or token
  // failover can never kick in for the single most common failure (the daily
  // cap). Peek the first chunk, then hand back a stream that replays it.
  const reader = res.body.getReader();
  let firstChunk: Uint8Array | undefined;
  try {
    const { value, done } = await reader.read();
    if (!done) firstChunk = value;
  } catch (e: any) {
    throw new OneCompilerError(`Upstream stream failed: ${e.message}`, 502);
  }

  if (firstChunk) {
    const head = new TextDecoder().decode(firstChunk, { stream: true }).trim();
    const hit = sentinelFor(head);
    if (hit) {
      await reader.cancel().catch(() => {});
      throw new OneCompilerError(head, hit.status);
    }
  }

  const replayed = new ReadableStream<Uint8Array>({
    start(controller) {
      if (firstChunk) controller.enqueue(firstChunk);
    },
    async pull(controller) {
      const { value, done } = await reader.read();
      if (done) controller.close();
      else controller.enqueue(value);
    },
    cancel(reason) {
      return reader.cancel(reason);
    },
  });
  return new Response(replayed, { status: res.status, headers: res.headers });
}

// --- stream -----------------------------------------------------------------

/**
 * Plain-text error replies that arrive with HTTP 200 as the entire body.
 *
 * Matched only against the FIRST chunk, and only when it is short: the point is
 * to catch a body that is *nothing but* one of these sentences. A model that
 * happens to begin an answer with "Please login…" keeps streaming and so runs
 * past the length bound, which is what keeps real output from being swallowed.
 */
// Two of these are confirmed against real upstream bodies:
//   "Please login to use this feature."
//   "You have reached the daily limit for AI interactions. Please upgrade to a
//    paid plan to continue using this feature."
// The others are defensive. Getting one wrong is cheap in one direction and not
// the other: a missed sentinel merely returns the sentence as content, whereas a
// too-eager pattern would swallow a real answer — which is why the length bound
// and the first-chunk-only rule matter more than the patterns themselves.
//
// Lookaheads rather than a linear match: the wording puts "reached" and "limit"
// in either order ("reached the daily limit" / "daily limit reached").
//
// Note the daily-limit body opens with the quota sentence and only then mentions
// upgrading, so it must be tested against the 429 pattern before the /^please
// upgrade/ one — list order is load-bearing here.
const ERROR_SENTINELS: Array<{ re: RegExp; status: number }> = [
  { re: /^please\s+log\s?in\b/i, status: 401 },
  { re: /^(unauthori[sz]ed|forbidden)\b/i, status: 401 },
  { re: /^please\s+upgrade\b/i, status: 402 },
  { re: /^(you have|your|daily|monthly|rate)\b(?=.*\b(limit|quota)\b)(?=.*\b(reached|exceeded|hit)\b)/i, status: 429 },
];
const SENTINEL_MAX_LEN = 200;

/**
 * Match a body opening against the sentinels. Returns the matching entry, or
 * null when this looks like real model output.
 *
 * A function declaration so both callers can use it: openCompletion() peeks with
 * it at stream open (which is what makes token failover possible), and the delta
 * loop re-checks it for callers that bypass the pool. Both must agree, or the
 * same body would be an error on one path and an answer on the other.
 */
function sentinelFor(text: string): { re: RegExp; status: number } | null {
  const trimmed = text.trim();
  if (!trimmed || trimmed.length > SENTINEL_MAX_LEN) return null;
  return ERROR_SENTINELS.find((s) => s.re.test(trimmed)) || null;
}

export interface OneCompilerDelta {
  kind: "text";
  text: string;
}

/**
 * Yield the answer as it streams.
 *
 * The body is raw UTF-8 text, so this is a decode-and-forward loop rather than a
 * parser. `stream: true` on the decoder matters: chunk boundaries land anywhere,
 * including mid-codepoint, and decoding each chunk independently would corrupt
 * any multi-byte character that straddles one.
 */
export async function* oneCompilerDeltas(res: Response): AsyncGenerator<OneCompilerDelta> {
  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  let first = true;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    const text = decoder.decode(value, { stream: true });
    if (!text) continue;

    if (first) {
      first = false;
      const hit = sentinelFor(text);
      if (hit) {
        await reader.cancel().catch(() => {});
        throw new OneCompilerError(text.trim(), hit.status);
      }
    }
    yield { kind: "text", text };
  }

  // Flush any bytes held back mid-codepoint at the very end of the stream.
  const tail = decoder.decode();
  if (tail) yield { kind: "text", text: tail };
}

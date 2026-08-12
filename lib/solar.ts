// Solar Chat (Upstage) — Solar Pro 4 and Solar Open 2, via solar-chat.upstage.ai.
//
// Unlike every other provider here there is no REST chat endpoint to proxy:
// /api/health reports `rest_chat_enabled: false` and POST /api/agent/chat/stream
// answers 404. The site drives a WebSocket, so this module speaks that protocol.
//
// The wire protocol, read off the app bundle and confirmed against the live
// service:
//
//   1. GET /api/session       -> { token } + Set-Cookie solar_session (Max-Age 1800)
//   2. WS  /api/agent/chat/ws    subprotocol "solar-chat.v1", carrying that cookie.
//                                Without it the upgrade is 403 SESSION_INVALID.
//   3. server { type: "ready", protocol, connection_id, heartbeat_ms }
//   4. client { type: "start", request: { messages, reasoning_effort, model, … } }
//   5. server { type: "event", seq, event } — seq counts from 1 with no gaps
//   6. terminal: the `complete` event (carrying the assembled reply, usage and
//      sources) or an `error` event. `{ type: "cancel" }` stops a run early.
//
// Constraints the upstream enforces. Every one of these was established by
// probing it, and each fails the whole run rather than degrading:
//
//  - `content` must be a STRING. A multimodal content array is rejected at the
//    protocol level (close 1007 INVALID_MESSAGE) — see "Vision" below.
//  - Roles are user/assistant only. `system` is rejected outright, so system
//    prompts are folded into the first user turn (foldSystem below).
//  - The LAST message must be role=user, and no message may have empty content.
//  - reasoning_effort is validated against the ladder /api/health advertises;
//    an unknown level closes the socket rather than falling back to a default.
//
// MODES. The site's composer offers Instant / Auto / Think, which its bundle
// maps onto reasoning_effort none / adaptive / xhigh. Both spellings work here:
// `reasoning_effort` for the full ladder, or the `enable_thinking` boolean every
// other model in this proxy already understands (true → Think, false → Instant).
// Default is Instant, matching how the Zen models default to their cheapest
// level — a caller who wants deliberation asks for it.
//
// VISION: no, despite the model otherwise looking like a frontier multimodal
// one. Three independent layers refuse an image — the composer's own validator
// blocks any image/* file, POST /api/agent/files answers 400 "image files are
// not accepted", and a content array never survives the WebSocket schema. The
// models are advertised text-only here because that is what they are.
//
// Solar is a SEARCH agent: it runs its own web_search internally and writes
// "[1]"-style markers into the answer. Those markers are meaningless on their
// own, so the sources it cites are appended as a short list unless
// SOLAR_CITATIONS=off.

import type { OpenAIMessage } from "./qwen";
import { messageText } from "./qwen";
import type { ReasoningEffort } from "./reasoningEffort";
import { proxyDispatcher, withProxy, proxyLabel, ProxyPool } from "./egress";

export const SOLAR_BASE = (process.env.SOLAR_BASE || "https://solar-chat.upstage.ai").replace(/\/+$/, "");

/** Kill switch: the upstream is a public site, so there is no key to withhold. */
export const SOLAR_DISABLED = process.env.SOLAR_DISABLED === "1";

/**
 * Optional outbound proxies. One per line (or comma-separated), in either
 * `http://user:pass@host:port` or Webshare's `host:port:user:pass` form.
 *
 * Upstage refuses datacenter addresses: /api/session answers 403 from a cloud
 * host while returning 200 to bare curl from a residential one, so no amount of
 * header shaping helps. GIVE THIS MORE THAN ONE PROXY — a third of a sampled
 * Webshare pool was refused too, so a single address is a coin flip. The pool
 * rotates past a refusal and sticks to whatever works. Unset means direct.
 */
const SOLAR_POOL = new ProxyPool(process.env.SOLAR_PROXY);

/** How long to wait for the socket to open and hand over its `ready` frame. */
const SOLAR_TIMEOUT_MS = Number(process.env.SOLAR_TIMEOUT_MS || 45_000);

/**
 * How long a live run may go quiet before we cut it.
 *
 * Generous on purpose: a Think-mode answer searches the web mid-run, and the
 * gap between the last tool_result and the first answer token is dead air that
 * a shorter idle window would kill. The server's own heartbeat is 15s.
 */
const SOLAR_IDLE_MS = Number(process.env.SOLAR_IDLE_MS || 90_000);

/** Refresh the session well inside the cookie's 1800s Max-Age. */
const SOLAR_SESSION_TTL_MS = Number(process.env.SOLAR_SESSION_TTL_MS || 20 * 60_000);

/** Locale sent with the run. Answers follow the prompt's language regardless. */
const SOLAR_LOCALE = process.env.SOLAR_LOCALE || "en";

/** Append the sources behind the answer's [n] markers. */
const SOLAR_CITATIONS = process.env.SOLAR_CITATIONS !== "off";

/** The site is a normal browser app; a bare client UA is not what it expects. */
const SOLAR_UA =
  process.env.SOLAR_USER_AGENT ||
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36";

/** The subprotocol the server echoes in its `ready` frame; a mismatch is fatal. */
const SOLAR_PROTOCOL = "solar-chat.v1";

export class SolarError extends Error {
  status: number;
  constructor(message: string, status = 502) {
    super(message);
    this.name = "SolarError";
    this.status = status;
  }
}

// --- registry ---------------------------------------------------------------

/**
 * The site's three composer modes in its own vocabulary. Exported because the
 * playground and docs describe them by name, and they should not drift.
 */
export const SOLAR_INSTANT = "none";
export const SOLAR_AUTO = "adaptive";
export const SOLAR_THINK = "xhigh";

/**
 * Effort ladder, exactly as /api/health advertises it, plus the "adaptive" the
 * composer's Auto mode sends. Order matters: it is the UI order too.
 */
export const SOLAR_EFFORT: readonly ReasoningEffort[] = [
  "adaptive",
  "none",
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
] as const;

export interface SolarModel {
  /** Public id callers request. */
  id: string;
  name: string;
  /** Bare id sent upstream (`solar-pro4`). */
  upstreamId: string;
  contextLength?: number;
  thinking?: boolean;
  reasoningEffort?: readonly ReasoningEffort[];
}

export const SOLAR_MODELS: SolarModel[] = [
  {
    id: "upstage/solar-pro-4",
    name: "Solar Pro 4",
    upstreamId: "solar-pro4",
    contextLength: 524_288,
    thinking: true,
    reasoningEffort: SOLAR_EFFORT,
  },
  {
    id: "upstage/solar-open-2",
    name: "Solar Open 2",
    upstreamId: "solar-open2",
    contextLength: 524_288,
    thinking: true,
    reasoningEffort: SOLAR_EFFORT,
  },
];

/** Public, so this is availability rather than credentials. */
export function solarConfigured(): boolean {
  return !SOLAR_DISABLED;
}

export function isSolarModel(id: string): boolean {
  return solarConfigured() && SOLAR_MODELS.some((m) => m.id === id);
}

export function resolveSolarModel(id: string): SolarModel | null {
  return SOLAR_MODELS.find((m) => m.id === id) ?? null;
}

/** Map the caller's knobs onto a reasoning_effort the upstream will accept. */
export function resolveSolarEffort(opts: {
  reasoningEffort?: string;
  enableThinking?: boolean;
}): string {
  if (typeof opts.reasoningEffort === "string" && opts.reasoningEffort.trim()) {
    return opts.reasoningEffort.trim().toLowerCase();
  }
  if (opts.enableThinking === true) return SOLAR_THINK;
  return SOLAR_INSTANT;
}

// --- message normalisation --------------------------------------------------

export interface SolarMessage {
  role: "user" | "assistant";
  content: string;
}

/**
 * Turn an OpenAI conversation into one Solar will accept.
 *
 * The upstream takes only user/assistant with string content and insists the
 * last turn is a user one. System text is not dropped — it is folded into the
 * first user turn, which is the only place it can survive.
 *
 * Throws a SolarError (400) when the conversation cannot be represented at all,
 * so the caller answers with a reason rather than a socket close.
 */
export function toSolarMessages(messages: OpenAIMessage[]): SolarMessage[] {
  const system: string[] = [];
  const turns: SolarMessage[] = [];

  for (const m of messages) {
    const text = messageText(m).trim();
    if (!text) continue; // empty content is rejected upstream
    const role = m.role;
    if (role === "system" || role === "developer") {
      system.push(text);
      continue;
    }
    // Tool/function results are information for the model, not a role Solar
    // knows. With tools on they have already been flattened by tools.ts; this
    // covers a caller that sends them with tools off.
    turns.push({ role: role === "assistant" ? "assistant" : "user", content: text });
  }

  if (system.length) {
    const first = turns.findIndex((t) => t.role === "user");
    const preface = system.join("\n\n");
    if (first === -1) {
      turns.push({ role: "user", content: preface });
    } else {
      turns[first] = { role: "user", content: `${preface}\n\n${turns[first].content}` };
    }
  }

  if (!turns.length) throw new SolarError("No message content to send.", 400);
  if (turns[turns.length - 1].role !== "user") {
    throw new SolarError(
      "Solar requires the conversation to end with a user message; the last message was from the assistant.",
      400
    );
  }
  return turns;
}

// --- session ----------------------------------------------------------------

interface SolarSession {
  cookie: string;
  token: string;
  at: number;
  /** The proxy this cookie was issued to; the socket must use the same one. */
  proxy?: string;
}

let cached: SolarSession | null = null;

/**
 * A session cookie for the socket handshake, cached until it is nearly stale.
 *
 * `force` skips the cache, which is what a SESSION_INVALID retry needs: the
 * cached cookie is precisely the thing that just failed.
 */
export async function solarSession(force = false): Promise<SolarSession> {
  if (!force && cached && Date.now() - cached.at < SOLAR_SESSION_TTL_MS) return cached;

  // A 403 here is the address being refused, not the request being wrong, so
  // it is worth trying the next proxy rather than giving up. With no pool
  // configured this runs exactly once and behaves as it always did.
  let lastErr: SolarError | null = null;
  for (let attempt = 0; attempt < SOLAR_POOL.attempts(); attempt++) {
    const proxy = SOLAR_POOL.current();

    let res: Response;
    try {
      res = await fetch(
        `${SOLAR_BASE}/api/session`,
        withProxy(
          {
            headers: { "User-Agent": SOLAR_UA, Origin: SOLAR_BASE, Referer: `${SOLAR_BASE}/`, Accept: "application/json" },
            signal: AbortSignal.timeout(SOLAR_TIMEOUT_MS),
          },
          proxy
        )
      );
    } catch (e: any) {
      lastErr = new SolarError(`Could not reach ${SOLAR_BASE}: ${e?.message || e}`, 502);
      SOLAR_POOL.rotate();
      continue;
    }

    if (!res.ok) {
      lastErr = new SolarError(
        `Solar session request failed (${res.status})${SOLAR_POOL.size ? ` via ${proxyLabel(proxy)}` : ""}.`,
        502
      );
      SOLAR_POOL.rotate();
      continue;
    }

    const token = (await res.json().catch(() => null))?.token;
    const setCookie = res.headers.getSetCookie?.() ?? [];
    const raw = setCookie.length ? setCookie : [res.headers.get("set-cookie") || ""];
    const cookie = raw.filter(Boolean).map((c) => c.split(";")[0]).join("; ");
    if (!cookie) {
      lastErr = new SolarError("Solar did not issue a session cookie.", 502);
      SOLAR_POOL.rotate();
      continue;
    }

    // Remember which proxy this cookie belongs to: the socket has to leave by
    // the same address, and the pool may rotate before the run opens.
    cached = { cookie, token: typeof token === "string" ? token : "", at: Date.now(), proxy };
    return cached;
  }

  throw lastErr || new SolarError("Solar session request failed.", 502);
}

/** Drop the cached session — used when the upstream rejects it mid-handshake. */
export function forgetSolarSession() {
  cached = null;
}

// --- transport --------------------------------------------------------------

export interface SolarFrame {
  type: string;
  [key: string]: any;
}

export interface SolarRun {
  /** Protocol frames, in order, until the run ends. */
  frames: AsyncGenerator<SolarFrame>;
  /** Ask the upstream to stop, then close. Safe to call more than once. */
  cancel(): void;
}

export interface SolarCompletionOpts {
  /** Public model id (`upstage/solar-pro-4`). */
  model: string;
  messages: OpenAIMessage[];
  reasoningEffort?: string;
  enableThinking?: boolean;
}

/**
 * A queue that bridges the socket's callbacks to an async generator, so the
 * route can `for await` over frames and stop by breaking out of the loop.
 */
class FrameQueue {
  private items: SolarFrame[] = [];
  private waiting: Array<(r: IteratorResult<SolarFrame>) => void> = [];
  private failed: ((e: Error) => void) | null = null;
  private error: Error | null = null;
  private ended = false;

  push(frame: SolarFrame) {
    const next = this.waiting.shift();
    if (next) next({ value: frame, done: false });
    else this.items.push(frame);
  }

  end() {
    this.ended = true;
    for (const w of this.waiting.splice(0)) w({ value: undefined as any, done: true });
  }

  fail(e: Error) {
    if (this.error || this.ended) return;
    this.error = e;
    this.failed?.(e);
    // Wake any waiter; next() re-checks `error` before resolving.
    for (const w of this.waiting.splice(0)) w({ value: undefined as any, done: true });
  }

  onFail(cb: (e: Error) => void) {
    this.failed = cb;
  }

  next(idleMs: number): Promise<IteratorResult<SolarFrame>> {
    if (this.items.length) return Promise.resolve({ value: this.items.shift()!, done: false });
    if (this.error) return Promise.reject(this.error);
    if (this.ended) return Promise.resolve({ value: undefined as any, done: true });
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        const i = this.waiting.indexOf(settle);
        if (i !== -1) this.waiting.splice(i, 1);
        reject(new SolarError(`Solar went quiet for ${Math.round(idleMs / 1000)}s.`, 504));
      }, idleMs);
      const settle = (r: IteratorResult<SolarFrame>) => {
        clearTimeout(timer);
        if (this.error) reject(this.error);
        else resolve(r);
      };
      this.waiting.push(settle);
    });
  }
}

/**
 * Open a run and stream its frames.
 *
 * A SESSION_INVALID handshake is retried once with a fresh session: the cached
 * cookie expires after 30 minutes and a proxy is very likely to hold one that
 * has just gone stale.
 */
export async function openCompletion(opts: SolarCompletionOpts): Promise<SolarRun> {
  if (SOLAR_DISABLED) throw new SolarError("Solar is disabled on this deployment.", 503);

  const entry = resolveSolarModel(opts.model);
  if (!entry) throw new SolarError(`Model '${opts.model}' is not available on Solar.`, 404);

  const request = {
    messages: toSolarMessages(opts.messages),
    reasoning_effort: resolveSolarEffort(opts),
    last_input_tokens: null,
    model: entry.upstreamId,
    attachments: [] as unknown[],
    thread_id: null,
    message_id: null,
    turn_index: null,
    locale: SOLAR_LOCALE,
    prompt_set: null,
  };

  try {
    return await connect(request, false);
  } catch (e: any) {
    if (e instanceof SolarError && e.status === 403) {
      forgetSolarSession();
      return await connect(request, true);
    }
    throw e;
  }
}

async function connect(request: unknown, freshSession: boolean): Promise<SolarRun> {
  const session = await solarSession(freshSession);
  const url = `${SOLAR_BASE.replace(/^http/, "ws")}/api/agent/chat/ws`;

  // Node's WebSocket takes an options bag (undici's extension) that the DOM
  // typings do not describe — and the Cookie header is the whole handshake, so
  // the spec-shaped constructor cannot be used here.
  // The socket must leave by the same route the session cookie was issued to:
  // Upstage ties the two together, so a cookie fetched through the proxy and a
  // socket opened directly is a mismatched pair and gets refused.
  const ws: WebSocket = new (WebSocket as any)(url, {
    protocols: [SOLAR_PROTOCOL],
    headers: {
      "User-Agent": SOLAR_UA,
      Origin: SOLAR_BASE,
      Cookie: session.cookie,
      ...(session.token ? { "x-csrf-token": session.token } : {}),
    },
    ...(proxyDispatcher(session.proxy) ? { dispatcher: proxyDispatcher(session.proxy) } : {}),
  });

  const queue = new FrameQueue();
  let started = false;
  let closed = false;

  const close = (code = 1000, reason = "client") => {
    if (closed) return;
    closed = true;
    try {
      if (ws.readyState === 1) ws.send(JSON.stringify({ type: "cancel" }));
    } catch {
      /* already gone */
    }
    try {
      if (ws.readyState <= 1) ws.close(code, reason);
    } catch {
      /* already gone */
    }
  };

  const ready = new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      close(1000, "ready timeout");
      reject(new SolarError(`Solar did not respond within ${Math.round(SOLAR_TIMEOUT_MS / 1000)}s.`, 504));
    }, SOLAR_TIMEOUT_MS);

    const fail = (e: Error) => {
      clearTimeout(timer);
      queue.fail(e);
      reject(e);
    };

    ws.addEventListener("message", (ev: MessageEvent) => {
      let frame: SolarFrame;
      try {
        frame = JSON.parse(String(ev.data));
      } catch {
        close(1002, "invalid server message");
        fail(new SolarError("Solar sent an unparseable frame.", 502));
        return;
      }

      if (frame.type === "ready") {
        if (started) return;
        if (frame.protocol !== SOLAR_PROTOCOL) {
          close(1002, "invalid ready");
          fail(new SolarError(`Solar answered with protocol '${frame.protocol}'.`, 502));
          return;
        }
        started = true;
        clearTimeout(timer);
        try {
          ws.send(JSON.stringify({ type: "start", request }));
        } catch (e: any) {
          close(1011, "start send failed");
          fail(new SolarError(`Could not start the Solar run: ${e?.message || e}`, 502));
          return;
        }
        resolve();
        return;
      }
      queue.push(frame);
    });

    ws.addEventListener("error", () => {
      // The handshake failure this hides most often is the 403 the upstream
      // returns for a stale session cookie, which openCompletion retries.
      const e = started
        ? new SolarError("The Solar connection failed mid-run.", 502)
        : new SolarError("Solar rejected the connection (session may have expired).", 403);
      closed = true;
      fail(e);
    });

    ws.addEventListener("close", (ev: CloseEvent) => {
      closed = true;
      clearTimeout(timer);
      if (!started) {
        fail(new SolarError("Solar closed the connection before the run started.", 403));
        return;
      }
      // A clean 1000 after `complete` is the normal path; the generator has
      // already returned by then and end() is a no-op.
      if (ev.code === 1000) queue.end();
      else queue.fail(new SolarError(`Solar closed the run early (${ev.code} ${ev.reason || ""})`.trim(), 502));
    });
  });

  await ready;

  async function* frames(): AsyncGenerator<SolarFrame> {
    try {
      while (true) {
        const r = await queue.next(SOLAR_IDLE_MS);
        if (r.done) return;
        yield r.value;
      }
    } finally {
      close();
    }
  }

  return { frames: frames(), cancel: () => close() };
}

// --- parsing ----------------------------------------------------------------

export interface SolarDelta {
  kind: "text" | "reasoning";
  text: string;
}

export interface SolarSource {
  title?: string;
  url?: string;
}

export interface SolarUsage {
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
}

/** Out-of-band detail from a run, filled in as the frames go by. */
export interface SolarSummary {
  sources: SolarSource[];
  usage?: SolarUsage;
  /** The effort actually used — Auto resolves to a concrete level mid-run. */
  effort?: string;
  stopReason?: string;
}

export function emptySummary(): SolarSummary {
  return { sources: [] };
}

/**
 * Yield reply tokens from a run's frames, reasoning included.
 *
 * Pure with respect to the socket — it consumes any async iterable of frames,
 * which is what makes the protocol testable without a live upstream.
 *
 * Strict where the protocol is strict: `seq` must not skip, because a gap means
 * a lost frame and therefore a silently truncated answer. Everything the answer
 * does not need (progress, metrics, tool traffic) is skipped rather than
 * rejected, so an added event type does not break the run.
 */
export async function* solarDeltas(
  frames: AsyncIterable<SolarFrame>,
  summary: SolarSummary = emptySummary()
): AsyncGenerator<SolarDelta> {
  let seq = 0;

  for await (const frame of frames) {
    // Protocol-level failure, outside the event envelope.
    if (frame.type === "error") {
      throw new SolarError(frame.message || frame.error || "Solar rejected the request.", statusOf(frame.code));
    }
    if (frame.type !== "event") continue; // ready, ack, anything new

    if (typeof frame.seq === "number") {
      if (frame.seq !== seq + 1) {
        throw new SolarError(`Solar dropped a frame (expected ${seq + 1}, got ${frame.seq}).`, 502);
      }
      seq = frame.seq;
    }

    const e = frame.event;
    if (!e || typeof e !== "object") continue;

    switch (e.type) {
      case "thinking_delta":
        if (typeof e.content === "string" && e.content) yield { kind: "reasoning", text: e.content };
        break;

      case "delta":
        if (typeof e.content === "string" && e.content) yield { kind: "text", text: e.content };
        break;

      case "assessment":
        // Auto mode announcing the level it settled on.
        if (typeof e.effort === "string") summary.effort = e.effort;
        break;

      case "citations":
        if (Array.isArray(e.citations)) summary.sources = e.citations.map(toSource);
        break;

      case "error":
        throw new SolarError(e.error || e.message || "Solar failed mid-run.", numeric(e.status) ?? statusOf(e.code));

      case "complete": {
        const data = e.data ?? {};
        if (Array.isArray(data.sources) && data.sources.length) summary.sources = data.sources.map(toSource);
        if (typeof data.reasoning_effort === "string") summary.effort = data.reasoning_effort;
        if (typeof data.stop_reason === "string") summary.stopReason = data.stop_reason;
        summary.usage = toUsage(data.usage);
        const footer = SOLAR_CITATIONS ? sourcesFooter(summary.sources) : "";
        if (footer) yield { kind: "text", text: footer };
        return;
      }
    }
  }
}

function toSource(c: any): SolarSource {
  return { title: typeof c?.title === "string" ? c.title : undefined, url: typeof c?.url === "string" ? c.url : undefined };
}

function numeric(v: unknown): number | undefined {
  return typeof v === "number" && v >= 400 && v <= 599 ? v : undefined;
}

/** The upstream's error codes, mapped onto something a client can act on. */
function statusOf(code: unknown): number {
  switch (code) {
    case "INVALID_REQUEST":
    case "INVALID_MESSAGE":
      return 400;
    case "UNAUTHORIZED":
    case "SESSION_INVALID":
      return 403;
    case "RATE_LIMITED":
      return 429;
    default:
      return 502;
  }
}

function toUsage(u: any): SolarUsage | undefined {
  if (!u || typeof u !== "object") return undefined;
  const prompt = Number(u.input_tokens) || 0;
  const completion = Number(u.output_tokens) || 0;
  const total = Number(u.total_tokens) || prompt + completion;
  if (!prompt && !completion && !total) return undefined;
  return { prompt_tokens: prompt, completion_tokens: completion, total_tokens: total };
}

/**
 * The list behind the answer's "[n]" markers.
 *
 * Solar cites by number and renders the list in its own sidebar, so an answer
 * proxied out verbatim carries markers pointing at nothing. Numbering follows
 * the order the upstream cited in, which is what the markers refer to.
 */
export function sourcesFooter(sources: SolarSource[]): string {
  const usable = sources.filter((s) => s.url);
  if (!usable.length) return "";
  const lines = usable.map((s, i) => `${i + 1}. [${(s.title || s.url || "").replace(/[\[\]]/g, "")}](${s.url})`);
  return `\n\n---\n\n**Sources**\n\n${lines.join("\n")}\n`;
}

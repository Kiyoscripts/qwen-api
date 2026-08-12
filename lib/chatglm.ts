// chatglm.cn (智谱清言) — GLM-5.2 with its three thinking modes, vision, and
// both of its image models.
//
// This is the same GLM-5.2 that used to be served from NVIDIA NIM here, but the
// consumer site gives us what the NIM endpoint could not: the Fast/Standard/Deep
// thinking switch, image input, and image generation. It costs an anti-bot
// scheme instead of an API key.
//
// EVERY REQUEST IS SIGNED. Three headers, all required, on every call:
//
//   X-Timestamp  Date.now(), with digit 11 replaced by
//                (sum of all digits − that digit) % 10
//   X-Nonce      uuid4 with the dashes stripped
//   X-Sign       md5(`${timestamp}-${nonce}-${SALT}`)
//
// Verified byte-for-byte against a live request from the site itself, so a
// mismatch here means the scheme changed upstream, not that the maths is wrong.
//
// AUTH IS A GUEST TOKEN, NOT A KEY. POST /user-api/guest/access returns a JWT
// with is_guest:true, bound to a device id we generate ourselves and valid for
// 24h. No signup, no phone number, nothing of the user's is involved — the
// proxy mints its own identity and refreshes it before expiry.
//
// THE TRAP: `X-Exp-Groups`. Omit it and the server still answers 200 with a
// text/event-stream, still sends the `init` frame, and then silently kills the
// socket. It reads as a network fault rather than a rejected request, which is
// why it is sent on every call below and why this comment exists.
//
// DELTAS ARE NOT DELTAS. `text` and `think` arrive as cumulative snapshots —
// "1", "1.", "1. " — so the parser diffs against what it has already emitted
// rather than appending. Appending yields quadratic garbage.
//
// Being a consumer endpoint behind an anti-bot scheme, this will break when
// they rotate it. lib/nvidia.ts still carries meta/muse-glimmer-30b, and the
// same GLM-5.2 id can be pointed back at NIM by moving one registry entry.

import type { OpenAIMessage } from "./qwen";
import { createHash, randomUUID } from "node:crypto";
import type { ReasoningEffort } from "./reasoningEffort";
import { withProxy, ProxyPool } from "./egress";

export const CHATGLM_BASE = (process.env.CHATGLM_BASE || "https://chatglm.cn").replace(/\/+$/, "");

/** Kill switch: the upstream is a public site, so there is no key to withhold. */
export const CHATGLM_DISABLED = process.env.CHATGLM_DISABLED === "1";

/**
 * Withdraw just the image models, keeping the text one.
 *
 * They are gated differently upstream: chat answers fine from a datacenter IP,
 * but a draw from one comes back with no image AND no text — an empty run
 * rather than the "tool call printed as prose" failure seen from a residential
 * connection. Nothing in the response says why, so a host that cannot draw has
 * to be told rather than detected. Set this on such a deploy so the image
 * models stop being advertised instead of 502-ing every call.
 */
export const CHATGLM_IMAGES_DISABLED = process.env.CHATGLM_IMAGES_DISABLED === "1";

/**
 * Optional outbound proxy, e.g. http://user:pass@p.webshare.io:80.
 *
 * The alternative to CHATGLM_IMAGES_DISABLED: rather than withdrawing the image
 * models on a host that cannot draw, send the traffic somewhere that can. Every
 * call the provider makes — guest token, upload, stream — goes through it, so
 * the session and the run it belongs to share one address. Unset means direct.
 */
const CHATGLM_POOL = new ProxyPool(process.env.CHATGLM_PROXY);

/** Signing salt, lifted from the site bundle. Rotating upstream breaks signing. */
const SALT = process.env.CHATGLM_SALT || "8a1317a7468aa3ad86e997d08f3f31cb";

/** The main-chat assistant. Image generation rides the same one. */
const ASSISTANT_ID = process.env.CHATGLM_ASSISTANT_ID || "65940acff94777010aa6b796";

/**
 * Experiment groups. The value barely matters; its PRESENCE does — see the
 * header note above. This is the site's own default set, trimmed.
 */
const EXP_GROUPS =
  process.env.CHATGLM_EXP_GROUPS ||
  "na_android_config:exp:NA,na_4o_config:exp:4o_A,tts_config:exp:tts_config_a,na_glm4plus_config:exp:open,mainchat_server_app:exp:A";

const CHATGLM_TIMEOUT_MS = Number(process.env.CHATGLM_TIMEOUT_MS || 60_000);
/** Image generation legitimately runs ~20s, so the idle window is generous. */
const CHATGLM_IDLE_MS = Number(process.env.CHATGLM_IDLE_MS || 120_000);
const CHATGLM_RETRIES = Math.max(0, Number(process.env.CHATGLM_RETRIES || 1));

/** Extra attempts for a draw that came back without a picture — see generateImage. */
const CHATGLM_IMAGE_RETRIES = Math.max(0, Number(process.env.CHATGLM_IMAGE_RETRIES || 1));

const CHATGLM_UA =
  process.env.CHATGLM_USER_AGENT ||
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36";

export class ChatGLMError extends Error {
  status: number;
  constructor(message: string, status = 502) {
    super(message);
    this.name = "ChatGLMError";
    this.status = status;
  }
}

// --- signing ----------------------------------------------------------------

const hex32 = () => randomUUID().replace(/-/g, "");

/**
 * The site's timestamp: Date.now() with the second-to-last digit replaced by a
 * checksum over all of them. Exported for the test, which pins it against a
 * real captured value.
 */
export function chatglmStamp(now: number = Date.now()): string {
  const s = String(now);
  const n = s.length;
  const digits = s.split("").map(Number);
  const t = digits.reduce((a, b) => a + b, 0) - digits[n - 2];
  return s.slice(0, n - 2) + (((t % 10) + 10) % 10) + s.slice(n - 1);
}

export function chatglmSign(timestamp: string, nonce: string): string {
  return createHash("md5").update(`${timestamp}-${nonce}-${SALT}`).digest("hex");
}

/** Every header the upstream expects, signed. `token` is omitted when minting one. */
function signedHeaders(deviceId: string, token?: string): Record<string, string> {
  const timestamp = chatglmStamp();
  const nonce = hex32();
  return {
    "Content-Type": "application/json",
    "User-Agent": CHATGLM_UA,
    "App-Name": "chatglm",
    "X-Lang": "zh",
    "X-Device-Id": deviceId,
    "X-App-Platform": "pc",
    "X-App-Version": "0.0.1",
    "X-App-fr": "default",
    "X-Request-Id": hex32(),
    "X-Device-Model": "",
    "X-Device-Brand": "",
    "X-Exp-Groups": EXP_GROUPS,
    "X-Timestamp": timestamp,
    "X-Nonce": nonce,
    "X-Sign": chatglmSign(timestamp, nonce),
    Origin: CHATGLM_BASE,
    Referer: `${CHATGLM_BASE}/`,
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };
}

// --- guest session ----------------------------------------------------------

interface GuestSession {
  token: string;
  deviceId: string;
  /** Unix seconds from the JWT, so we refresh before the server rejects us. */
  expiresAt: number;
  /** The proxy this token was issued through; later calls reuse it. */
  proxy?: string;
}

let session: GuestSession | null = null;
let inflight: Promise<GuestSession> | null = null;

/** Read `exp` out of the JWT without verifying it — we only need the deadline. */
function jwtExpiry(token: string): number {
  try {
    const payload = JSON.parse(Buffer.from(token.split(".")[1], "base64url").toString("utf8"));
    return typeof payload?.exp === "number" ? payload.exp : 0;
  } catch {
    return 0;
  }
}

/**
 * A guest token, cached until it is nearly stale.
 *
 * Concurrent callers share one in-flight mint rather than each racing to make
 * their own — a burst of requests on a cold process would otherwise register a
 * device per request.
 */
export async function guestSession(force = false): Promise<GuestSession> {
  const now = Math.floor(Date.now() / 1000);
  if (!force && session && session.expiresAt - 300 > now) return session;
  if (!force && inflight) return inflight;

  inflight = (async () => {
    // A refusal here can be the address rather than the request, so a pool is
    // walked before giving up. Without one this runs once, as before.
    let lastErr: ChatGLMError | null = null;
    for (let attempt = 0; attempt < CHATGLM_POOL.attempts(); attempt++) {
      const proxy = CHATGLM_POOL.current();
      const deviceId = hex32();

      let res: Response;
      try {
        res = await fetch(
          `${CHATGLM_BASE}/chatglm/user-api/guest/access`,
          withProxy(
            {
              method: "POST",
              headers: signedHeaders(deviceId),
              body: "{}",
              signal: AbortSignal.timeout(CHATGLM_TIMEOUT_MS),
            },
            proxy
          )
        );
      } catch (e: any) {
        lastErr = new ChatGLMError(`Could not reach ${CHATGLM_BASE}: ${e?.message || e}`, 502);
        CHATGLM_POOL.rotate();
        continue;
      }

      const json = await res.json().catch(() => null);
      const token = json?.result?.access_token;
      if (!res.ok || typeof token !== "string" || !token) {
        lastErr = new ChatGLMError(
          `chatglm.cn refused a guest session (${res.status}${json?.message ? `: ${json.message}` : ""}).`,
          res.status === 400 ? 502 : res.status || 502
        );
        CHATGLM_POOL.rotate();
        continue;
      }

      session = { token, deviceId, expiresAt: jwtExpiry(token) || now + 3600, proxy };
      return session;
    }
    throw lastErr || new ChatGLMError("chatglm.cn refused a guest session.", 502);
  })();

  try {
    return await inflight;
  } finally {
    inflight = null;
  }
}

export function forgetGuestSession() {
  session = null;
}

// --- registry ---------------------------------------------------------------

/**
 * The composer's three modes, in the site's own vocabulary. `chat_mode` carries
 * them; Fast is the empty string, which is why it looks like "unset".
 */
export const CHATGLM_FAST = "";
export const CHATGLM_THINKING = "thinking";
export const CHATGLM_DEEP = "deep_thinking";

/** Effort ladder mapped onto those three, in the proxy's shared vocabulary. */
export const CHATGLM_EFFORT: readonly ReasoningEffort[] = ["none", "medium", "high"] as const;

const EFFORT_TO_MODE: Record<string, string> = {
  none: CHATGLM_FAST,
  medium: CHATGLM_THINKING,
  high: CHATGLM_DEEP,
};

export interface ChatGLMModel {
  id: string;
  name: string;
  kind: "text" | "image";
  /** cogview chat_model for image models; unused for text. */
  cogviewModel?: "standard" | "glm_image";
  contextLength?: number;
  thinking?: boolean;
  /** Accepts image input — true for the text model and for image editing. */
  vision?: boolean;
  reasoningEffort?: readonly ReasoningEffort[];
}

export const CHATGLM_MODELS: ChatGLMModel[] = [
  {
    // Same public id the NIM-backed entry used, so callers keep working; only
    // the backend moved.
    id: "z-ai/glm-5.2",
    name: "GLM-5.2",
    kind: "text",
    contextLength: 200_000,
    thinking: true,
    vision: true,
    reasoningEffort: CHATGLM_EFFORT,
  },
  {
    id: "z-ai/glm-image",
    name: "GLM Image",
    kind: "image",
    cogviewModel: "glm_image",
    // The site bills this one as cinematic quality with legible text rendering.
    //
    // Text-to-image ONLY. Handed a reference image it answers with prose
    // claiming it edited the picture, emits a tool_result, and returns no image
    // at all — a hallucinated success. Advertising vision here would surface
    // that as a silent failure, so it is declared false. Use glm-image-fast for
    // anything reference-based.
    vision: false,
  },
  {
    id: "z-ai/glm-image-fast",
    name: "GLM Image Fast",
    kind: "image",
    cogviewModel: "standard",
    // Reference images do work on this one: a red/blue checkerboard plus "make
    // it green" came back a genuinely green checkerboard (mean rgb 56,156,43
    // against the source's 128,0,128), so the input image is really being used.
    vision: true,
  },
];

export function chatglmConfigured(): boolean {
  return !CHATGLM_DISABLED;
}

/** The models this deployment can actually serve. */
export function chatglmModels(): ChatGLMModel[] {
  if (!chatglmConfigured()) return [];
  return CHATGLM_IMAGES_DISABLED ? CHATGLM_MODELS.filter((m) => m.kind !== "image") : CHATGLM_MODELS;
}

export function isChatGLMModel(id: string): boolean {
  return chatglmModels().some((m) => m.id === id);
}

export function resolveChatGLMModel(id: string): ChatGLMModel | null {
  return CHATGLM_MODELS.find((m) => m.id === id) ?? null;
}

export function chatglmImageModel(id: string): ChatGLMModel | null {
  const m = resolveChatGLMModel(id);
  return m && m.kind === "image" ? m : null;
}

/** Map the caller's knobs onto a chat_mode. Fast unless asked for more. */
export function resolveChatMode(opts: { reasoningEffort?: string; enableThinking?: boolean }): string {
  const level = opts.reasoningEffort?.trim().toLowerCase();
  if (level && level in EFFORT_TO_MODE) return EFFORT_TO_MODE[level];
  if (opts.enableThinking === true) return CHATGLM_THINKING;
  return CHATGLM_FAST;
}

// --- message conversion -----------------------------------------------------

export interface ChatGLMPart {
  type: string;
  text?: string;
  image?: Array<{ image_url: string; file_id?: string }>;
}

export interface ChatGLMMessage {
  role: "user" | "assistant";
  content: ChatGLMPart[];
}

/**
 * Flatten an OpenAI conversation into the site's shape.
 *
 * Roles are user/assistant only and system has no slot, so system text folds
 * into the first user turn — the same treatment lib/solar.ts gives it, and for
 * the same reason.
 */
export function toChatGLMMessages(
  messages: OpenAIMessage[],
  uploads: Map<string, { image_url: string; file_id?: string }> = new Map()
): ChatGLMMessage[] {
  const system: string[] = [];
  const turns: ChatGLMMessage[] = [];

  for (const m of messages) {
    const role = m.role;
    const parts: ChatGLMPart[] = [];
    let text = "";

    if (typeof m.content === "string") {
      text = m.content;
    } else if (Array.isArray(m.content)) {
      for (const p of m.content as any[]) {
        if (typeof p === "string") text += p;
        else if (p?.type === "text") text += p.text || "";
        else if (p?.type === "image_url") {
          const url = typeof p.image_url === "string" ? p.image_url : p.image_url?.url;
          const up = url ? uploads.get(url) : undefined;
          if (up) parts.push({ type: "image", image: [up] });
        }
      }
    }
    text = text.trim();

    if (role === "system" || role === "developer") {
      if (text) system.push(text);
      continue;
    }
    if (text) parts.unshift({ type: "text", text });
    if (!parts.length) continue;
    turns.push({ role: role === "assistant" ? "assistant" : "user", content: parts });
  }

  if (system.length) {
    const preface = system.join("\n\n");
    const first = turns.findIndex((t) => t.role === "user");
    if (first === -1) {
      turns.push({ role: "user", content: [{ type: "text", text: preface }] });
    } else {
      const c = turns[first].content;
      const t0 = c.find((p) => p.type === "text");
      if (t0) t0.text = `${preface}\n\n${t0.text || ""}`;
      else c.unshift({ type: "text", text: preface });
    }
  }

  if (!turns.length) throw new ChatGLMError("No message content to send.", 400);
  return turns;
}

// --- image upload (vision) --------------------------------------------------

/**
 * Push one image up and get back the handle a message can carry.
 *
 * Accepts a data: URL or an http(s) URL; the latter is fetched first, because
 * the upstream takes bytes rather than a link.
 */
export async function uploadImage(url: string): Promise<{ image_url: string; file_id?: string }> {
  const s = await guestSession();

  let bytes: Uint8Array;
  let mime = "image/png";
  let name = "image.png";

  const m = /^data:([^;,]+)(;base64)?,(.*)$/s.exec(url);
  if (m) {
    mime = m[1] || mime;
    bytes = m[2] ? new Uint8Array(Buffer.from(m[3], "base64")) : new TextEncoder().encode(decodeURIComponent(m[3]));
  } else {
    const res = await fetch(url, { signal: AbortSignal.timeout(CHATGLM_TIMEOUT_MS) }).catch((e) => {
      throw new ChatGLMError(`Could not fetch the image to upload: ${e?.message || e}`, 400);
    });
    if (!res.ok) throw new ChatGLMError(`Could not fetch the image to upload (${res.status}).`, 400);
    mime = res.headers.get("content-type")?.split(";")[0] || mime;
    bytes = new Uint8Array(await res.arrayBuffer());
  }
  const ext = (mime.split("/")[1] || "png").replace(/[^a-z0-9]/gi, "");
  name = `image.${ext}`;

  const fd = new FormData();
  fd.append("file", new Blob([bytes as BlobPart], { type: mime }), name);
  const headers = signedHeaders(s.deviceId, s.token);
  // FormData must set its own boundary.
  delete (headers as any)["Content-Type"];

  const res = await fetch(
    `${CHATGLM_BASE}/chatglm/backend-api/assistant/file_upload`,
    withProxy({ method: "POST", headers, body: fd, signal: AbortSignal.timeout(CHATGLM_TIMEOUT_MS) }, s.proxy)
  );
  const json = await res.json().catch(() => null);
  const file = json?.result;
  if (!res.ok || !file?.file_url) {
    throw new ChatGLMError(`Image upload failed (${res.status}${json?.message ? `: ${json.message}` : ""}).`, 502);
  }
  return { image_url: file.file_url, file_id: file.file_id };
}

// --- chat -------------------------------------------------------------------

export interface ChatGLMCompletionOpts {
  model: string;
  messages: ChatGLMMessage[];
  /** "" | "thinking" | "deep_thinking" */
  chatMode?: string;
  /** Let the model search the web mid-answer. */
  networking?: boolean;
  /** cogview settings, for the image models. */
  cogview?: Record<string, unknown>;
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * Open a run. Returns the raw SSE response; feed it to chatglmDeltas.
 *
 * A 401 is retried once against a freshly minted guest token, because a token
 * that expired between cache check and use is the likeliest failure here.
 */
export async function openCompletion(opts: ChatGLMCompletionOpts): Promise<Response> {
  if (CHATGLM_DISABLED) throw new ChatGLMError("chatglm.cn is disabled on this deployment.", 503);

  const body = JSON.stringify({
    assistant_id: ASSISTANT_ID,
    conversation_id: "",
    project_id: "",
    chat_type: "user_chat",
    meta_data: {
      cogview: { rm_label_watermark: true, ...(opts.cogview || {}) },
      is_test: false,
      input_question_type: "xxxx",
      channel: "",
      draft_id: "",
      chat_mode: opts.chatMode ?? CHATGLM_FAST,
      is_networking: opts.networking === true,
      quote_log_id: "",
      platform: "pc",
    },
    messages: opts.messages,
  });

  let lastErr: ChatGLMError | null = null;
  for (let attempt = 0; attempt <= CHATGLM_RETRIES; attempt++) {
    if (attempt > 0) await sleep(250 * attempt);
    const s = await guestSession(attempt > 0);

    let res: Response;
    try {
      res = await fetch(
        `${CHATGLM_BASE}/chatglm/backend-api/assistant/stream`,
        withProxy(
          {
            method: "POST",
            headers: { ...signedHeaders(s.deviceId, s.token), accept: "text/event-stream" },
            body,
            signal: AbortSignal.timeout(CHATGLM_TIMEOUT_MS),
          },
          s.proxy
        )
      );
    } catch (e: any) {
      lastErr = new ChatGLMError(
        e?.name === "TimeoutError" || e?.name === "AbortError"
          ? `chatglm.cn did not respond within ${Math.round(CHATGLM_TIMEOUT_MS / 1000)}s.`
          : `Could not reach ${CHATGLM_BASE}: ${e?.message || e}`,
        e?.name === "TimeoutError" ? 504 : 502
      );
      continue;
    }

    if (res.status === 401 || res.status === 403) {
      forgetGuestSession();
      lastErr = new ChatGLMError("chatglm.cn rejected the guest session.", 502);
      continue;
    }
    if (!res.ok || !res.body) {
      const text = await res.text().catch(() => "");
      throw new ChatGLMError(errorMessage(text) || `Upstream error (${res.status})`, res.status >= 400 ? res.status : 502);
    }
    return res;
  }
  throw lastErr || new ChatGLMError("chatglm.cn request failed.", 502);
}

function errorMessage(body: string): string {
  if (!body) return "";
  try {
    const j = JSON.parse(body);
    return j?.message || j?.error?.message || body.slice(0, 300);
  } catch {
    return body.slice(0, 300);
  }
}

export interface ChatGLMDelta {
  kind: "text" | "reasoning" | "image";
  text: string;
}

/** Everything a run produced besides the token stream. */
export interface ChatGLMSummary {
  images: string[];
  /** The prompt the model actually drew from, when it rewrote one. */
  imagePrompt?: string;
}

export function emptyChatGLMSummary(): ChatGLMSummary {
  return { images: [] };
}

/**
 * Yield reply tokens from the SSE stream.
 *
 * The upstream sends cumulative snapshots, so each frame is diffed against what
 * has already been emitted and only the new tail is yielded. A frame that goes
 * backwards (a retry upstream) resets the baseline rather than emitting a
 * negative slice.
 */
export async function* chatglmDeltas(
  res: Response,
  summary: ChatGLMSummary = emptyChatGLMSummary()
): AsyncGenerator<ChatGLMDelta> {
  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let sentText = "";
  let sentThink = "";

  const readWithIdle = (): Promise<ReadableStreamReadResult<Uint8Array>> =>
    new Promise((resolve, reject) => {
      const idle = setTimeout(() => {
        reader.cancel().catch(() => {});
        reject(new ChatGLMError(`chatglm.cn went quiet for ${Math.round(CHATGLM_IDLE_MS / 1000)}s.`, 504));
      }, CHATGLM_IDLE_MS);
      reader.read().then(
        (r) => {
          clearTimeout(idle);
          resolve(r);
        },
        (e) => {
          clearTimeout(idle);
          reject(e);
        }
      );
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

      if (j?.status === "error" || (j?.last_error && Object.keys(j.last_error).length)) {
        const msg = j?.last_error?.detail || j?.last_error?.message || "chatglm.cn reported an error.";
        await reader.cancel().catch(() => {});
        throw new ChatGLMError(String(msg), 502);
      }

      for (const part of j?.parts || []) {
        for (const c of part?.content || []) {
          if (c?.type === "text" && typeof c.text === "string") {
            if (!c.text.startsWith(sentText)) sentText = "";
            const tail = c.text.slice(sentText.length);
            if (tail) {
              sentText = c.text;
              yield { kind: "text", text: tail };
            }
          } else if (c?.type === "think" && typeof c.think === "string") {
            if (!c.think.startsWith(sentThink)) sentThink = "";
            const tail = c.think.slice(sentThink.length);
            if (tail) {
              sentThink = c.think;
              yield { kind: "reasoning", text: tail };
            }
          } else if (c?.type === "image" && Array.isArray(c.image)) {
            if (typeof c.code === "string" && c.code) summary.imagePrompt = c.code;
            for (const im of c.image) {
              const u = im?.image_url;
              if (typeof u === "string" && u && !summary.images.includes(u)) {
                summary.images.push(u);
                yield { kind: "image", text: u };
              }
            }
          }
        }
      }
    }
  }
}

/**
 * Generate an image and return its URLs.
 *
 * `rm_label_watermark` strips the site's own corner label so the proxy's
 * watermark (lib/watermark.ts) is the only one on the result — two stacked
 * watermarks would be worse than either alone.
 */
export async function generateImage(opts: {
  model: string;
  messages: ChatGLMMessage[];
  aspectRatio?: string;
}): Promise<{ images: string[]; prompt?: string; text: string }> {
  const entry = chatglmImageModel(opts.model);
  if (!entry) throw new ChatGLMError(`Model '${opts.model}' is not a chatglm.cn image model.`, 404);

  // Roughly one run in four comes back with the tool call printed as text —
  // `{"action":"generate_image","prompt":…}` — instead of an actual picture.
  // It is transient and an immediate retry succeeds, so a draw is attempted
  // twice before the caller sees a failure.
  let text = "";
  for (let attempt = 0; attempt <= CHATGLM_IMAGE_RETRIES; attempt++) {
    const res = await openCompletion({
      model: opts.model,
      messages: opts.messages,
      chatMode: CHATGLM_FAST,
      cogview: {
        rm_label_watermark: true,
        chat_model: entry.cogviewModel,
        style: "none",
        dpi: "hd",
        aspect_ratio: opts.aspectRatio || "1:1",
        scene: "none",
        skill: {},
      },
    });

    const summary = emptyChatGLMSummary();
    text = "";
    try {
      for await (const d of chatglmDeltas(res, summary)) {
        if (d.kind === "text") text += d.text;
      }
    } finally {
      await res.body?.cancel().catch(() => {});
    }
    if (summary.images.length) return { images: summary.images, prompt: summary.imagePrompt, text };
  }

  // Two distinct failures, and the difference is the whole diagnosis. Text
  // present means the model printed its tool call instead of drawing — bad
  // luck, and the retry above already had a go. Nothing at all means the run
  // came back empty, which is what a host that is not allowed to draw sees; a
  // deploy hitting that wants CHATGLM_IMAGES_DISABLED rather than more retries.
  throw new ChatGLMError(
    text.trim()
      ? `No image was produced: ${text.trim().slice(0, 200)}`
      : "No image was produced: the upstream returned an empty run, which usually means this host is not permitted to generate images. Set CHATGLM_IMAGES_DISABLED=1 to stop advertising them here.",
    502
  );
}

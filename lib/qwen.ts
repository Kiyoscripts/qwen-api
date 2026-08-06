// Core chat.qwen.ai client (server-side). Supports text/vision chat, image
// generation (t2i) and video generation (t2v), across all Qwen models, using a
// per-request token from the pool (see tokens.ts).
//
// Reverse-engineered facts:
//  - The "Version" header is required or completions fail with Internal error.
//  - qwen3.8-max requires feature_config.thinking_enabled = true.
//  - Completions accept exactly ONE message; we collapse history into one.
//  - Images are uploaded to OSS and referenced in message.files.
//  - Image gen (chat_type t2i, stream): the image URL arrives as delta.content
//    in phase "image_gen".
//  - Video gen (chat_type t2v, stream:false): returns extra.wanx.task_id; poll
//    GET /api/v2/tasks/status/{task_id} until the video URL is ready.

import { randomUUID } from "node:crypto";
import { uploadImage, fetchImageBytes, type QwenFileEntry } from "./upload";
import { collapseConversation, type CollapseTurn } from "./conversation";

export const QWEN_BASE = "https://chat.qwen.ai";

const QWEN_CLIENT_VERSION = process.env.QWEN_CLIENT_VERSION || "0.2.76";
const SHOW_REASONING = !/^(0|false|no)$/i.test(process.env.QWEN_SHOW_REASONING || "");
const QWEN_FORGET_MEMORIES = !/^(0|false|no)$/i.test(process.env.QWEN_FORGET_MEMORIES || "");

export function showReasoning(): boolean {
  return SHOW_REASONING;
}

export class QwenError extends Error {
  status: number;
  /**
   * Set when the failure is the account's fault rather than the request's, but
   * the wording doesn't look like a quota message (see `isTokenFailover`). The
   * pool then moves to another account instead of failing the request.
   */
  retryable: boolean;
  constructor(message: string, status = 502, retryable = false) {
    super(message);
    this.status = status;
    this.retryable = retryable;
  }
}

// --- types -----------------------------------------------------------------

// "i2v" is image-to-video. It is NOT listed in any model's advertised
// `chat_type` array from /api/models — the web client sends it regardless, the
// same way "image_edit" is the image-to-image counterpart of "t2i".
export type ChatType = "t2t" | "t2i" | "t2v" | "i2v" | "image_edit";
export interface OpenAIContentPart {
  type: string;
  text?: string;
  image_url?: string | { url: string };
}
export interface OpenAIMessage {
  role: string;
  content: string | OpenAIContentPart[] | null;
}
export interface ModelInfo {
  id: string;
  name: string;
  chatTypes: string[];
  thinking: boolean;
  /** Accepts images. */
  vision: boolean;
  /** Accepts documents — PDFs and other ordinary files. */
  document: boolean;
  /** Accepts video. */
  video: boolean;
  /**
   * Accepts audio. The one capability that actually separates the flagships:
   * qwen3.8-max takes audio, qwen3.8-max-preview does not.
   */
  audio: boolean;
  /** Context window in tokens, when upstream declares one. */
  contextLength?: number;
}

// --- headers ---------------------------------------------------------------

export function qwenHeaders(token: string, extra: Record<string, string> = {}): Record<string, string> {
  return {
    "Content-Type": "application/json",
    Accept: "application/json",
    Authorization: `Bearer ${token}`,
    Origin: QWEN_BASE,
    Referer: `${QWEN_BASE}/`,
    "User-Agent":
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 " +
      "(KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
    "X-Request-Id": randomUUID(),
    Version: QWEN_CLIENT_VERSION,
    source: "web",
    Timezone: new Date().toString().replace(/\s*\(.+\)$/, ""),
    ...extra,
  };
}

// --- model registry (cached) ----------------------------------------------

let modelCache: { models: ModelInfo[]; at: number } | null = null;
const MODEL_TTL = 5 * 60_000;

export async function getModels(token: string): Promise<ModelInfo[]> {
  if (modelCache && Date.now() - modelCache.at < MODEL_TTL) return modelCache.models;
  const res = await fetch(`${QWEN_BASE}/api/models`, { headers: qwenHeaders(token) });
  const j: any = await res.json().catch(() => ({}));
  const models: ModelInfo[] = (j?.data || []).map((m: any) => {
    const meta = m.info?.meta || {};
    const caps = meta.capabilities || {};
    return {
      id: m.id,
      name: m.name || m.id,
      chatTypes: Array.isArray(meta.chat_type) ? meta.chat_type : ["t2t"],
      thinking: Boolean(caps.thinking),
      // Input modalities come straight from meta.capabilities rather than being
      // inferred from traffic: upstream states them per model, and they differ
      // between otherwise-identical models.
      vision: Boolean(caps.vision),
      document: Boolean(caps.document),
      video: Boolean(caps.video),
      audio: Boolean(caps.audio),
      contextLength: typeof meta.max_context_length === "number" ? meta.max_context_length : undefined,
    };
  });
  if (models.length) modelCache = { models, at: Date.now() };
  return models;
}

export async function resolveModel(token: string, id: string): Promise<ModelInfo | null> {
  const models = await getModels(token);
  return models.find((m) => m.id === id) || null;
}

// --- message helpers -------------------------------------------------------

export function messageText(m: OpenAIMessage): string {
  if (typeof m.content === "string") return m.content;
  if (Array.isArray(m.content))
    return m.content.map((p) => (typeof p === "string" ? p : p.text || "")).join("");
  return String(m.content ?? "");
}

export function imageUrlsIn(m: OpenAIMessage | undefined): string[] {
  if (!m || !Array.isArray(m.content)) return [];
  const urls: string[] = [];
  for (const part of m.content) {
    if (part && part.type === "image_url") {
      const u = typeof part.image_url === "string" ? part.image_url : part.image_url?.url;
      if (u) urls.push(u);
    }
  }
  return urls;
}

function normalizeRole(role: string): "system" | "user" | "assistant" {
  return role === "assistant" ? "assistant" : role === "system" ? "system" : "user";
}

// Collapse a conversation into a single Qwen user message of the given chat type.
export function buildMessage(
  messages: OpenAIMessage[],
  opts: {
    model: string;
    chatType: ChatType;
    files?: QwenFileEntry[];
    thinking: boolean;
    size?: string;
    // Image-model version for t2i / image_edit, e.g. "qwen-image-3.0-pro".
    imageModelId?: string;
  }
) {
  const now = Math.floor(Date.now() / 1000);
  // Upstream takes exactly one message — it answers "Invalid input too many
  // messages" to a role array — so the conversation is flattened into it.
  const turns: CollapseTurn[] = [];
  for (const m of messages) {
    const text = messageText(m);
    if (!text) continue;
    const role = normalizeRole(m.role);
    turns.push({ role: role === "system" ? "system" : role === "assistant" ? "assistant" : "user", text });
  }
  const content = collapseConversation(turns);

  return {
    id: null,
    fid: randomUUID(),
    parentId: null,
    childrenIds: [],
    role: "user",
    content,
    user_action: "chat",
    files: opts.files || [],
    timestamp: now,
    models: [opts.model],
    model: "",
    chat_type: opts.chatType,
    feature_config: { thinking_enabled: opts.thinking, output_schema: "phase", research_mode: "normal" },
    // Image generation/editing carries size + image-model version in extra.meta,
    // exactly like the web client. Text/video keep extra empty.
    extra:
      opts.chatType === "t2i" || opts.chatType === "image_edit"
        ? {
            meta: {
              subChatType: opts.chatType,
              ...(opts.size ? { size: opts.size } : {}),
              ...(opts.imageModelId ? { model: opts.imageModelId } : {}),
            },
          }
        : {},
    sub_chat_type: opts.chatType,
    parent_id: null,
    ...(opts.size ? { size: opts.size } : {}),
  };
}

// --- API calls (all take a token) ------------------------------------------

// Markers Qwen's anti-bot layer puts in a body when it actually challenges.
const CHALLENGE_MARKERS = /access verification|verify that you are|captcha|please complete the operation|punish|rgv587|baxia/i;

/**
 * Say what upstream actually refused, rather than lumping every rejection
 * together.
 *
 * This used to report ANY 401 or 403 as "anti-bot challenge / rate limit",
 * which is three different faults wearing one label: an expired token, a
 * revoked account and a genuine bot challenge each need a different response,
 * and the operator could not tell which was happening. All of them still roll
 * the request onto another account — `isTokenFailure` matches every message
 * produced here — but now the logs name the cause.
 *
 * Returns null when the response is not a refusal we recognise.
 */
export function classifyRefusal(
  status: number,
  body: string,
  headers?: { get(name: string): string | null }
): QwenError | null {
  if (CHALLENGE_MARKERS.test(body)) {
    return new QwenError("Qwen served an anti-bot challenge to this account.", 503, true);
  }
  if (status === 401) {
    return new QwenError("Qwen token is expired or no longer valid on this account.", 401, true);
  }
  if (status === 403) {
    return new QwenError("Qwen refused this account (forbidden — banned or restricted).", 403, true);
  }
  if (status === 429) {
    const retryAfter = headers?.get("retry-after");
    return new QwenError(
      `Qwen rate limited this account (429${retryAfter ? `, retry-after ${retryAfter}s` : ""}).`,
      429,
      true
    );
  }
  return null;
}

export async function createChat(token: string, model: string, chatType: ChatType): Promise<string> {
  const res = await fetch(`${QWEN_BASE}/api/v2/chats/new`, {
    method: "POST",
    headers: qwenHeaders(token),
    body: JSON.stringify({ title: "New Chat", models: [model], chat_mode: "normal", chat_type: chatType, timestamp: Date.now() }),
  });
  const text = await res.text();
  {
    const refusal = classifyRefusal(res.status, text, res.headers);
    if (refusal) throw refusal;
  }
  let json: any;
  try {
    json = JSON.parse(text);
  } catch {
    throw new QwenError(`Unexpected /chats/new response (${res.status})`);
  }
  const id = json?.data?.id || json?.id;
  if (!id) throw new QwenError(`Could not create chat: ${text.slice(0, 200)}`);
  return id;
}

export async function deleteChat(token: string, chatId: string | undefined): Promise<void> {
  if (!chatId) return;
  try {
    await fetch(`${QWEN_BASE}/api/v2/chats/${encodeURIComponent(chatId)}`, { method: "DELETE", headers: qwenHeaders(token) });
  } catch {
    /* best effort */
  }
}

export async function forgetAllMemories(token: string): Promise<void> {
  if (!QWEN_FORGET_MEMORIES) return;
  try {
    await fetch(`${QWEN_BASE}/api/v2/memories/delete`, { method: "POST", headers: qwenHeaders(token), body: JSON.stringify({ forget_all: true }) });
  } catch {
    /* best effort */
  }
}

export async function uploadImages(token: string, imageUrls: string[]): Promise<QwenFileEntry[]> {
  const headers = (extra?: Record<string, string>) => qwenHeaders(token, extra);
  const files: QwenFileEntry[] = [];
  for (const u of imageUrls) {
    const { bytes, mime } = await fetchImageBytes(u);
    files.push(await uploadImage(headers, QWEN_BASE, bytes, mime));
  }
  return files;
}

// Open a completion. Returns the raw Response (SSE when stream=true, JSON when not).
export async function openCompletion(
  token: string,
  chatId: string,
  opts: { model: string; messages: unknown[]; stream: boolean; size?: string }
): Promise<Response> {
  const now = Math.floor(Date.now() / 1000);
  const payload: Record<string, unknown> = {
    stream: opts.stream,
    version: "2.1",
    incremental_output: opts.stream,
    chat_id: chatId,
    chat_mode: "normal",
    model: opts.model,
    parent_id: null,
    messages: opts.messages,
    timestamp: now,
    ...(opts.size ? { size: opts.size } : {}),
  };
  const res = await fetch(`${QWEN_BASE}/api/v2/chat/completions?chat_id=${encodeURIComponent(chatId)}`, {
    method: "POST",
    headers: qwenHeaders(token, { Accept: opts.stream ? "text/event-stream" : "application/json" }),
    body: JSON.stringify(payload),
  });
  if (opts.stream) {
    const ct = res.headers.get("content-type") || "";
    if (!res.ok || !res.body || !ct.includes("event-stream")) {
      const text = await res.text().catch(() => "");
      const refusal = classifyRefusal(res.status, text, res.headers);
      if (refusal) throw refusal;
      let detail = text.slice(0, 200);
      try {
        const j = JSON.parse(text);
        detail = j?.data?.details || j?.error?.details || j?.data?.code || detail;
      } catch {}
      throw new QwenError(`Qwen completion failed (${res.status}): ${detail}`);
    }
  }
  return res;
}

export interface QwenDelta {
  phase: string;
  text: string;
}

/**
 * Set by qwenDeltas so the caller can tell a finished reply from a severed one.
 *
 * Qwen does NOT terminate its SSE with `[DONE]` — verified against the live
 * endpoint, that sentinel never appears. A finished reply is signalled by
 * `delta.status === "finished"` on the closing frame; a severed one just stops.
 * Watching for `[DONE]` therefore marked every single reply as truncated.
 */
export interface StreamStatus {
  complete: boolean;
  /** Real token counts, which Qwen reports on the closing frames. */
  usage?: { prompt_tokens: number; completion_tokens: number; total_tokens: number };
}

// Async generator over SSE deltas. Yields {phase, text}. Throws on stream errors.
// Pass `status` to learn whether the stream actually finished.
export async function* qwenDeltas(res: Response, status?: StreamStatus): AsyncGenerator<QwenDelta> {
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
      const data = line.slice(5).trim();
      // Kept as a fallback in case the upstream ever adds it, but Qwen does not
      // send this; `delta.status === "finished"` below is the real terminator.
      if (data === "[DONE]") {
        if (status) status.complete = true;
        return;
      }
      let evt: any;
      try {
        evt = JSON.parse(data);
      } catch {
        continue;
      }
      if (evt?.error) throw new QwenError(`Qwen stream error: ${evt.error.details || evt.error.code || "unknown"}`);
      if (status && evt?.usage) {
        const u = evt.usage;
        status.usage = {
          prompt_tokens: Number(u.input_tokens) || 0,
          completion_tokens: Number(u.output_tokens) || 0,
          total_tokens: Number(u.total_tokens) || 0,
        };
      }
      const delta = evt?.choices?.[0]?.delta;
      if (!delta) continue;
      // The completion signal. Checked before the empty-content skip below,
      // because the closing frame carries status but no text.
      if (delta.status === "finished" && status) status.complete = true;
      const piece: unknown = delta.content;
      if (typeof piece !== "string" || piece.length === 0) continue;
      yield { phase: typeof delta.phase === "string" ? delta.phase : "answer", text: piece };
    }
  }
}

// --- video: task id + polling ----------------------------------------------

export function extractWanxTaskId(json: any): string | null {
  return json?.data?.messages?.[0]?.extra?.wanx?.task_id || json?.data?.messages?.[0]?.extra?.aipodcast?.task_id || null;
}

export interface TaskState {
  // "not_found" = this account doesn't own the task (tasks are per-account), so a
  // caller scanning the pool should try the next account.
  status: "processing" | "completed" | "failed" | "not_found";
  url?: string;
}

// Single, non-blocking check of a WanX task. Lets callers poll for as long as
// they like without holding a serverless function open.
export async function checkTask(token: string, taskId: string): Promise<TaskState> {
  let json: any;
  try {
    // Qwen moved task status from v2 -> v1. The v1 body is flat:
    // { chat_type, task_status: "running"|"success"|"failed", content: <url when done> }.
    const res = await fetch(`${QWEN_BASE}/api/v1/tasks/status/${encodeURIComponent(taskId)}`, {
      headers: qwenHeaders(token),
    });
    json = await res.json();
  } catch {
    return { status: "processing" };
  }
  const url = taskMediaUrl(json);
  if (url) return { status: "completed", url };
  // Wrong account: { success:false, data:{ code:"not found" } }.
  if (json?.success === false && /not\s*found/i.test(`${json?.data?.code || ""} ${json?.data?.details || ""}`)) {
    return { status: "not_found" };
  }
  const status = taskStatus(json);
  if (status === "failed" || status === "failure") return { status: "failed" };
  return { status: "processing" };
}

// Read the status string / media URL from either the flat v1 shape (top-level
// task_status + content) or the older data-wrapped shape.
function taskStatus(json: any): string {
  return (json?.task_status || json?.data?.task_status || json?.data?.status || "").toString().toLowerCase();
}
function taskMediaUrl(json: any): string | null {
  if (typeof json?.content === "string" && /\.(?:mp4|mov|webm)/i.test(json.content)) return json.content;
  const m = JSON.stringify(json).match(/https?:\/\/[^"\\]+\.(?:mp4|mov|webm)[^"\\]*/);
  return m ? m[0] : null;
}

// Poll a WanX (video) task until it produces a media URL. Returns the URL.
export async function pollTask(token: string, taskId: string, timeoutMs = 240_000): Promise<string> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    await new Promise((r) => setTimeout(r, 5000));
    let json: any;
    try {
      const res = await fetch(`${QWEN_BASE}/api/v1/tasks/status/${encodeURIComponent(taskId)}`, { headers: qwenHeaders(token) });
      json = await res.json();
    } catch {
      continue;
    }
    {
      const refusal = classifyRefusal(200, JSON.stringify(json));
      if (refusal) throw refusal;
    }
    const url = taskMediaUrl(json);
    if (url) return url;
    if (taskStatus(json) === "failed" || taskStatus(json) === "failure") throw new QwenError("Video generation failed upstream.");
    // otherwise keep polling (pending / running / succeeded-without-url-yet)
  }
  throw new QwenError("Video generation timed out.", 504);
}

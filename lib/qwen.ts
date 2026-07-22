// Core chat.qwen.ai client (server-side). Supports text/vision chat, image
// generation (t2i) and video generation (t2v), across all Qwen models, using a
// per-request token from the pool (see tokens.ts).
//
// Reverse-engineered facts:
//  - The "Version" header is required or completions fail with Internal error.
//  - qwen3.8-max-preview requires feature_config.thinking_enabled = true.
//  - Completions accept exactly ONE message; we collapse history into one.
//  - Images are uploaded to OSS and referenced in message.files.
//  - Image gen (chat_type t2i, stream): the image URL arrives as delta.content
//    in phase "image_gen".
//  - Video gen (chat_type t2v, stream:false): returns extra.wanx.task_id; poll
//    GET /api/v2/tasks/status/{task_id} until the video URL is ready.

import { randomUUID } from "node:crypto";
import { uploadImage, fetchImageBytes, type QwenFileEntry } from "./upload";

export const QWEN_BASE = "https://chat.qwen.ai";

const QWEN_CLIENT_VERSION = process.env.QWEN_CLIENT_VERSION || "0.2.74";
const SHOW_REASONING = !/^(0|false|no)$/i.test(process.env.QWEN_SHOW_REASONING || "");
const QWEN_FORGET_MEMORIES = !/^(0|false|no)$/i.test(process.env.QWEN_FORGET_MEMORIES || "");

export function showReasoning(): boolean {
  return SHOW_REASONING;
}

export class QwenError extends Error {
  status: number;
  constructor(message: string, status = 502) {
    super(message);
    this.status = status;
  }
}

// --- types -----------------------------------------------------------------

export type ChatType = "t2t" | "t2i" | "t2v";
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
  vision: boolean;
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
      vision: Boolean(caps.vision),
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
  opts: { model: string; chatType: ChatType; files?: QwenFileEntry[]; thinking: boolean; size?: string }
) {
  const now = Math.floor(Date.now() / 1000);
  const systemParts: string[] = [];
  const turns: { role: string; text: string }[] = [];
  for (const m of messages) {
    const text = messageText(m);
    if (!text) continue;
    const role = normalizeRole(m.role);
    if (role === "system") systemParts.push(text);
    else turns.push({ role, text });
  }

  let content: string;
  if (systemParts.length === 0 && turns.length <= 1) {
    content = turns[0]?.text ?? "";
  } else {
    const lines: string[] = [];
    if (systemParts.length) lines.push(systemParts.join("\n\n"), "");
    for (const t of turns) lines.push(`${t.role === "assistant" ? "Assistant" : "User"}: ${t.text}`);
    if (opts.chatType === "t2t") lines.push("Assistant:");
    content = lines.join("\n");
  }

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
    extra: {},
    sub_chat_type: opts.chatType,
    parent_id: null,
    ...(opts.size ? { size: opts.size } : {}),
  };
}

// --- API calls (all take a token) ------------------------------------------

function looksLikeChallenge(status: number, body: string): boolean {
  if (status === 401 || status === 403) return true;
  return /access verification|verify that you are|captcha|please complete the operation|punish|rgv587/i.test(body);
}

export async function createChat(token: string, model: string, chatType: ChatType): Promise<string> {
  const res = await fetch(`${QWEN_BASE}/api/v2/chats/new`, {
    method: "POST",
    headers: qwenHeaders(token),
    body: JSON.stringify({ title: "New Chat", models: [model], chat_mode: "normal", chat_type: chatType, timestamp: Date.now() }),
  });
  const text = await res.text();
  if (looksLikeChallenge(res.status, text)) throw new QwenError("Qwen anti-bot challenge / rate limit on this account.", 503);
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
      if (looksLikeChallenge(res.status, text)) throw new QwenError("Qwen anti-bot challenge / rate limit on this account.", 503);
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

// Async generator over SSE deltas. Yields {phase, text}. Throws on stream errors.
export async function* qwenDeltas(res: Response): AsyncGenerator<QwenDelta> {
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
      if (data === "[DONE]") return;
      let evt: any;
      try {
        evt = JSON.parse(data);
      } catch {
        continue;
      }
      if (evt?.error) throw new QwenError(`Qwen stream error: ${evt.error.details || evt.error.code || "unknown"}`);
      const delta = evt?.choices?.[0]?.delta;
      if (!delta) continue;
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
  status: "processing" | "completed" | "failed";
  url?: string;
}

// Single, non-blocking check of a WanX task. Lets callers poll for as long as
// they like without holding a serverless function open.
export async function checkTask(token: string, taskId: string): Promise<TaskState> {
  let json: any;
  try {
    const res = await fetch(`${QWEN_BASE}/api/v2/tasks/status/${encodeURIComponent(taskId)}`, {
      headers: qwenHeaders(token),
    });
    json = await res.json();
  } catch {
    return { status: "processing" };
  }
  const blob = JSON.stringify(json);
  const m = blob.match(/https?:\/\/[^"\\]+\.(?:mp4|mov|webm)[^"\\]*/);
  if (m) return { status: "completed", url: m[0] };
  const status = (json?.data?.task_status || json?.data?.status || "").toString().toLowerCase();
  if (status === "failed" || status === "failure") return { status: "failed" };
  return { status: "processing" };
}

// Poll a WanX (video) task until it produces a media URL. Returns the URL.
export async function pollTask(token: string, taskId: string, timeoutMs = 240_000): Promise<string> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    await new Promise((r) => setTimeout(r, 5000));
    let json: any;
    try {
      const res = await fetch(`${QWEN_BASE}/api/v2/tasks/status/${encodeURIComponent(taskId)}`, { headers: qwenHeaders(token) });
      json = await res.json();
    } catch {
      continue;
    }
    const blob = JSON.stringify(json);
    if (looksLikeChallenge(200, blob)) throw new QwenError("Qwen anti-bot challenge while polling video task.", 503);
    const status = (json?.data?.task_status || json?.data?.status || "").toString().toLowerCase();
    const m = blob.match(/https?:\/\/[^"\\]+\.(?:mp4|mov|webm)[^"\\]*/);
    if (m) return m[0];
    if (status === "failed" || status === "failure") throw new QwenError("Video generation failed upstream.");
    // otherwise keep polling (pending / running / succeeded-without-url-yet)
  }
  throw new QwenError("Video generation timed out.", 504);
}

// Core chat.qwen.ai client (server-side). Ported from the verified proxy.
//
// Key facts discovered by reverse-engineering chat.qwen.ai:
//  - The completions endpoint requires a "Version" header (the frontend app
//    version) or it returns a generic Internal error.
//  - qwen3.8-max-preview requires feature_config.thinking_enabled = true, else it
//    rejects the request with "invalid_input".
//  - The endpoint keeps history server-side and accepts exactly ONE message per
//    call, so we collapse the whole conversation into a single message.
//  - Images are uploaded to Alibaba OSS and referenced in the message `files`.

import { randomUUID } from "node:crypto";
import { uploadImage, fetchImageBytes, type QwenFileEntry } from "./upload";

export const QWEN_BASE = "https://chat.qwen.ai";
export const ALLOWED_MODEL = "qwen3.8-max-preview";

const QWEN_TOKEN = process.env.QWEN_TOKEN || "";
const QWEN_CLIENT_VERSION = process.env.QWEN_CLIENT_VERSION || "0.2.74";
// Whether to expose the model's reasoning as `reasoning_content` in responses.
// Defaults to true (thinking is shown). Set QWEN_SHOW_REASONING=false to hide it.
const SHOW_REASONING = !/^(0|false|no)$/i.test(process.env.QWEN_SHOW_REASONING || "");
const QWEN_FORGET_MEMORIES = !/^(0|false|no)$/i.test(process.env.QWEN_FORGET_MEMORIES || "");

export function showReasoning(): boolean {
  return SHOW_REASONING;
}

export type ChatRole = "system" | "user" | "assistant";
export interface OpenAIContentPart {
  type: string;
  text?: string;
  image_url?: string | { url: string };
}
export interface OpenAIMessage {
  role: string;
  content: string | OpenAIContentPart[] | null;
}

export function qwenHeaders(extra: Record<string, string> = {}): Record<string, string> {
  return {
    "Content-Type": "application/json",
    Accept: "application/json",
    Authorization: `Bearer ${QWEN_TOKEN}`,
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

export function hasToken(): boolean {
  return Boolean(QWEN_TOKEN);
}

// --- helpers ---------------------------------------------------------------

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

function normalizeRole(role: string): ChatRole {
  return role === "assistant" ? "assistant" : role === "system" ? "system" : "user";
}

// Collapse the whole OpenAI conversation into a single Qwen user message.
export function buildQwenMessages(messages: OpenAIMessage[], files: QwenFileEntry[] = []) {
  const now = Math.floor(Date.now() / 1000);

  const systemParts: string[] = [];
  const turns: { role: ChatRole; text: string }[] = [];
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
    lines.push("Assistant:");
    content = lines.join("\n");
  }

  return [
    {
      id: null,
      fid: randomUUID(),
      parentId: null,
      childrenIds: [],
      role: "user",
      content,
      user_action: "chat",
      files,
      timestamp: now,
      models: [ALLOWED_MODEL],
      model: "",
      chat_type: "t2t",
      feature_config: { thinking_enabled: true, output_schema: "phase", research_mode: "normal" },
      extra: {},
      sub_chat_type: "t2t",
      parent_id: null,
    },
  ];
}

// --- API calls -------------------------------------------------------------

function looksLikeChallenge(status: number, body: string): boolean {
  if (status === 401 || status === 403) return true;
  return /access verification|verify that you are|captcha|please complete the operation/i.test(body);
}

export class QwenError extends Error {
  status: number;
  constructor(message: string, status = 502) {
    super(message);
    this.status = status;
  }
}

export async function createChat(): Promise<string> {
  const res = await fetch(`${QWEN_BASE}/api/v2/chats/new`, {
    method: "POST",
    headers: qwenHeaders(),
    body: JSON.stringify({
      title: "New Chat",
      models: [ALLOWED_MODEL],
      chat_mode: "normal",
      chat_type: "t2t",
      timestamp: Date.now(),
    }),
  });
  const text = await res.text();
  if (looksLikeChallenge(res.status, text)) throw new QwenError("Qwen anti-bot challenge; refresh QWEN_TOKEN.", 503);
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

export async function deleteChat(chatId: string | undefined): Promise<void> {
  if (!chatId) return;
  try {
    await fetch(`${QWEN_BASE}/api/v2/chats/${encodeURIComponent(chatId)}`, {
      method: "DELETE",
      headers: qwenHeaders(),
    });
  } catch {
    /* best effort */
  }
}

export async function forgetAllMemories(): Promise<void> {
  if (!QWEN_FORGET_MEMORIES) return;
  try {
    await fetch(`${QWEN_BASE}/api/v2/memories/delete`, {
      method: "POST",
      headers: qwenHeaders(),
      body: JSON.stringify({ forget_all: true }),
    });
  } catch {
    /* best effort */
  }
}

// Upload any images attached to the latest user turn.
export async function uploadImages(imageUrls: string[]): Promise<QwenFileEntry[]> {
  const files: QwenFileEntry[] = [];
  for (const u of imageUrls) {
    const { bytes, mime } = await fetchImageBytes(u);
    files.push(await uploadImage(qwenHeaders, QWEN_BASE, bytes, mime));
  }
  return files;
}

export async function openQwenStream(chatId: string, qwenMessages: unknown[]): Promise<Response> {
  const now = Math.floor(Date.now() / 1000);
  const payload = {
    stream: true,
    version: "2.1",
    incremental_output: true,
    chat_id: chatId,
    chat_mode: "normal",
    model: ALLOWED_MODEL,
    parent_id: null,
    messages: qwenMessages,
    timestamp: now,
  };
  const res = await fetch(`${QWEN_BASE}/api/v2/chat/completions?chat_id=${encodeURIComponent(chatId)}`, {
    method: "POST",
    headers: qwenHeaders({ Accept: "text/event-stream" }),
    body: JSON.stringify(payload),
  });
  const ct = res.headers.get("content-type") || "";
  if (!res.ok || !res.body || !ct.includes("event-stream")) {
    const text = await res.text().catch(() => "");
    if (looksLikeChallenge(res.status, text)) throw new QwenError("Qwen anti-bot challenge; refresh QWEN_TOKEN.", 503);
    let detail = text.slice(0, 200);
    try {
      const j = JSON.parse(text);
      detail = j?.data?.details || j?.error?.details || j?.data?.code || detail;
    } catch {
      /* keep raw */
    }
    throw new QwenError(`Qwen completion failed (${res.status}): ${detail}`);
  }
  return res;
}

export interface QwenDelta {
  phase: "think" | "answer";
  text: string;
}

// Async generator yielding {phase, text} deltas. "think" = reasoning,
// "answer" = final answer. Throws on stream errors.
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
      yield { phase: delta.phase === "think" ? "think" : "answer", text: piece };
    }
  }
}

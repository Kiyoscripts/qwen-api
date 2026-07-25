// Core chat.deepseek.com client (server-side). Reverse-engineered from the web
// app (client version 2.2.0). Supports text chat, DeepThink reasoning, and vision,
// across DeepSeek's Instant / Expert / Vision models, using a single hardcoded
// account token (DeepSeek has no per-account usage limit, so unlike Qwen there is
// no token pool).
//
// Per-request flow (kept STATELESS like the Qwen proxy — the OpenAI client resends
// full history each call, which we collapse into one prompt):
//   1. POST /api/v0/chat_session/create            -> chat_session_id
//   2. POST /api/v0/chat/create_pow_challenge       -> a proof-of-work challenge
//   3. solve PoW (see deepseek-pow.ts) -> x-ds-pow-response header
//   4. POST /api/v0/chat/completion  (+ pow header) -> SSE stream
//   5. POST /api/v0/chat_session/delete             -> clean up
//
// The completion stream is DeepSeek's JSON-patch format (NOT the old
// choices[].delta shape): a snapshot object, then {p,o,v} patches, with bare {v}
// continuations appending to the last path. Fragments are typed THINK (reasoning)
// or RESPONSE (answer).

import { solvePowHeader, type PowChallenge } from "./deepseek-pow";
import { fetchImageBytes } from "./upload";
import type { OpenAIMessage } from "./qwen";

export const DEEPSEEK_BASE = "https://chat.deepseek.com";
const DEEPSEEK_CLIENT_VERSION = process.env.DEEPSEEK_CLIENT_VERSION || "2.2.0";
// Minutes west of UTC, as the web client sends it. 0 (UTC) is fine but uniform
// across every account; override per deployment if that matters.
const DEEPSEEK_TZ_OFFSET = process.env.DEEPSEEK_TZ_OFFSET || "0";

export class DeepSeekError extends Error {
  status: number;
  constructor(message: string, status = 502) {
    super(message);
    this.status = status;
  }
}

// --- model registry ---------------------------------------------------------
// API-facing model ids -> upstream `model_type`. Vision is its own model (the web
// app's "Image understanding (Beta)" mode); DeepThink works on all of them.
export interface DeepSeekModel {
  id: string;
  name: string;
  modelType: string | null; // upstream model_type ("" | "expert" | "vision"), null = Instant default
  thinking: boolean;
  vision: boolean;
}

export const DEEPSEEK_MODELS: DeepSeekModel[] = [
  { id: "deepseek-v4-flash", name: "DeepSeek V4 Flash", modelType: null, thinking: true, vision: false },
  { id: "deepseek-v4-pro", name: "DeepSeek V4 Pro", modelType: "expert", thinking: true, vision: false },
  { id: "deepseek-v4-vision", name: "DeepSeek V4 Vision", modelType: "vision", thinking: true, vision: true },
];

export function isDeepSeekModel(id: string): boolean {
  return id.startsWith("deepseek");
}

export function resolveDeepSeekModel(id: string): DeepSeekModel | null {
  return DEEPSEEK_MODELS.find((m) => m.id === id) || null;
}

// --- headers ----------------------------------------------------------------
// Every request runs with a caller-supplied token. In the "bring your own token"
// model each API key links its owner's own chat.deepseek.com token, so a user's
// traffic runs on their own account (and only their account bears any ban risk).
// `DEEPSEEK_TOKEN` in the env is only an optional owner-wide fallback.

// Kept as one constant so the User-Agent and the client hints can't drift apart:
// a request claiming Chrome while omitting sec-ch-ua (or naming a different
// version in it) is inconsistent in a way no real browser is.
const CHROME_VERSION = "140";
const USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 " +
  `(KHTML, like Gecko) Chrome/${CHROME_VERSION}.0.0.0 Safari/537.36`;

function headers(token: string, extra: Record<string, string> = {}): Record<string, string> {
  return {
    "Content-Type": "application/json",
    Accept: "*/*",
    "Accept-Language": "en-US,en;q=0.9",
    Authorization: `Bearer ${token}`,
    Origin: DEEPSEEK_BASE,
    Referer: `${DEEPSEEK_BASE}/`,
    "User-Agent": USER_AGENT,
    "sec-ch-ua": `"Chromium";v="${CHROME_VERSION}", "Not=A?Brand";v="24", "Google Chrome";v="${CHROME_VERSION}"`,
    "sec-ch-ua-mobile": "?0",
    "sec-ch-ua-platform": '"macOS"',
    "Sec-Fetch-Dest": "empty",
    "Sec-Fetch-Mode": "cors",
    "Sec-Fetch-Site": "same-origin",
    Pragma: "no-cache",
    "Cache-Control": "no-cache",
    "x-client-platform": "web",
    "x-client-version": DEEPSEEK_CLIENT_VERSION,
    "x-client-bundle-id": "com.deepseek.chat",
    "x-client-locale": "en_US",
    "x-client-timezone-offset": DEEPSEEK_TZ_OFFSET,
    ...extra,
  };
}

function looksLikeChallenge(status: number, body: string): boolean {
  if (status === 401 || status === 403) return true;
  // Deliberately specific: the create_pow_challenge success body literally
  // contains the word "challenge", so we only match true anti-bot / WAF markers.
  return /aws-?waf|captcha|rgv587|slide[_-]?captcha|blocked by|access denied/i.test(body);
}

// Unwrap DeepSeek's {code, data:{biz_code, biz_data}} envelope, throwing on error.
function unwrap(json: any, ctx: string): any {
  if (!json || typeof json !== "object") throw new DeepSeekError(`${ctx}: unexpected response`);
  if (json.code && json.code !== 0) throw new DeepSeekError(`${ctx}: ${json.msg || json.code}`);
  const biz = json?.data;
  if (biz && biz.biz_code && biz.biz_code !== 0) throw new DeepSeekError(`${ctx}: ${biz.biz_msg || biz.biz_code}`);
  return biz?.biz_data;
}

// --- session ----------------------------------------------------------------

// A dead / expired / banned token comes back as this — surface it clearly so the
// caller can tell the user to re-link, and so the pool can retire it.
function isBadToken(json: any): boolean {
  return json?.code === 40003 || /invalid token|authorization failed|expired/i.test(json?.msg || "");
}

export async function createSession(token: string): Promise<string> {
  const res = await fetch(`${DEEPSEEK_BASE}/api/v0/chat_session/create`, {
    method: "POST",
    headers: headers(token),
    body: JSON.stringify({}),
  });
  const text = await res.text();
  if (looksLikeChallenge(res.status, text))
    throw new DeepSeekError("DeepSeek rejected the request (anti-bot / WAF challenge).", 503);
  let json: any;
  try {
    json = JSON.parse(text);
  } catch {
    throw new DeepSeekError(`Unexpected /chat_session/create response (${res.status})`);
  }
  if (isBadToken(json))
    throw new DeepSeekError("Your DeepSeek token was rejected (expired or banned). Re-link it at /link.", 401);
  const id = unwrap(json, "createSession")?.chat_session?.id;
  if (!id) throw new DeepSeekError(`Could not create DeepSeek session: ${text.slice(0, 200)}`);
  return id;
}

// Best effort, but NOT silent: we create a session per request, so if deletion
// stops working the account accumulates thousands of abandoned sessions — which
// is both untidy and exactly the sort of thing that gets an account flagged.
// A failure here can't fail the user's request, so it is logged instead.
//
// Two request shapes are in circulation for this endpoint, so if the POST form
// is rejected we try the REST form before giving up. Whichever succeeds is
// remembered for the life of the process, so this costs one extra call at most.
type DeleteShape = "post" | "rest";
let preferredDeleteShape: DeleteShape | null = null;

async function attemptDelete(token: string, id: string, shape: DeleteShape): Promise<{ ok: boolean; detail: string }> {
  const res =
    shape === "post"
      ? await fetch(`${DEEPSEEK_BASE}/api/v0/chat_session/delete`, {
          method: "POST",
          headers: headers(token),
          body: JSON.stringify({ chat_session_id: id }),
        })
      : await fetch(`${DEEPSEEK_BASE}/api/v0/chat_session/${encodeURIComponent(id)}`, {
          method: "DELETE",
          headers: headers(token),
        });
  const text = await res.text().catch(() => "");
  let json: any = null;
  try {
    json = JSON.parse(text);
  } catch {
    /* non-JSON body */
  }
  const ok = res.ok && (!json || !json.code || json.code === 0);
  return { ok, detail: `${res.status} ${json?.msg || text.slice(0, 120) || ""}`.trim() };
}

export async function deleteSession(token: string, chatSessionId: string | undefined): Promise<void> {
  if (!chatSessionId) return;
  const order: DeleteShape[] = preferredDeleteShape === "rest" ? ["rest", "post"] : ["post", "rest"];
  const failures: string[] = [];
  for (const shape of order) {
    try {
      const { ok, detail } = await attemptDelete(token, chatSessionId, shape);
      if (ok) {
        preferredDeleteShape = shape;
        return;
      }
      failures.push(`${shape}: ${detail}`);
    } catch (e: any) {
      failures.push(`${shape}: threw ${e?.message || e}`);
    }
  }
  console.warn(`[deepseek] session ${chatSessionId} NOT deleted — ${failures.join(" | ")}`);
}

// Cheap liveness check for a token (used when a user links one). Hits the PoW
// challenge endpoint, which authenticates without creating a session.
export async function validateDeepSeekToken(token: string): Promise<boolean> {
  try {
    const res = await fetch(`${DEEPSEEK_BASE}/api/v0/chat/create_pow_challenge`, {
      method: "POST",
      headers: headers(token),
      body: JSON.stringify({ target_path: "/api/v0/chat/completion" }),
    });
    const json: any = await res.json().catch(() => ({}));
    if (isBadToken(json)) return false;
    return Boolean(json?.data?.biz_data?.challenge?.challenge);
  } catch {
    return false;
  }
}

// --- proof of work ----------------------------------------------------------

async function powHeaderFor(token: string, targetPath: string): Promise<string> {
  const res = await fetch(`${DEEPSEEK_BASE}/api/v0/chat/create_pow_challenge`, {
    method: "POST",
    headers: headers(token),
    body: JSON.stringify({ target_path: targetPath }),
  });
  const text = await res.text();
  if (looksLikeChallenge(res.status, text))
    throw new DeepSeekError("DeepSeek rejected the PoW challenge request (anti-bot / WAF).", 503);
  let json: any;
  try {
    json = JSON.parse(text);
  } catch {
    throw new DeepSeekError(`Unexpected create_pow_challenge response (${res.status})`);
  }
  if (isBadToken(json))
    throw new DeepSeekError("Your DeepSeek token was rejected (expired or banned). Re-link it at /link.", 401);
  const challenge: PowChallenge | undefined = unwrap(json, "powChallenge")?.challenge;
  if (!challenge?.challenge) throw new DeepSeekError("No PoW challenge returned by DeepSeek");
  return solvePowHeader(challenge);
}

// --- vision: upload images, get ref_file_ids --------------------------------
// Confirmed against the live "Vision" mode: images go through /api/v0/file/upload_file
// (PoW-gated), the file is then parsed server-side (status PENDING -> PARSING ->
// SUCCESS), and the resulting `file-...` id is passed as ref_file_ids on a
// model_type:"vision" completion. The file MUST reach SUCCESS first — referencing
// it earlier (or a degenerate image that parses to CONTENT_EMPTY) fails with
// "invalid ref file id". Readiness is polled via GET /api/v0/file/fetch_files.

// Poll a freshly-uploaded file until it is parsed and usable (status SUCCESS).
async function waitForFile(token: string, fileId: string, timeoutMs = 30_000): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const res = await fetch(
      `${DEEPSEEK_BASE}/api/v0/file/fetch_files?file_ids=${encodeURIComponent(fileId)}`,
      { headers: headers(token) }
    );
    const json: any = await res.json().catch(() => ({}));
    const status: string | undefined = json?.data?.biz_data?.files?.[0]?.status;
    if (status === "SUCCESS") return;
    // PENDING / PARSING -> keep waiting; anything else terminal (CONTENT_EMPTY,
    // FAILED, audit failure) means the image can't be used.
    if (status && status !== "PENDING" && status !== "PARSING") {
      throw new DeepSeekError(`DeepSeek could not process the image (status ${status}).`, 400);
    }
    await new Promise((r) => setTimeout(r, 600));
  }
  throw new DeepSeekError("DeepSeek image processing timed out.", 504);
}

export async function uploadImages(token: string, imageUrls: string[]): Promise<string[]> {
  const ids: string[] = [];
  for (const url of imageUrls) {
    const { bytes, mime } = await fetchImageBytes(url);
    const pow = await powHeaderFor(token, "/api/v0/file/upload_file");
    const ext = (mime.split("/")[1] || "png").replace("jpeg", "jpg");
    const form = new FormData();
    form.append("file", new Blob([new Uint8Array(bytes)], { type: mime }), `image.${ext}`);
    const h = headers(token, { "x-ds-pow-response": pow });
    delete (h as any)["Content-Type"]; // let fetch set the multipart boundary
    const res = await fetch(`${DEEPSEEK_BASE}/api/v0/file/upload_file`, { method: "POST", headers: h, body: form });
    const json: any = await res.json().catch(() => ({}));
    const id = json?.data?.biz_data?.id;
    if (!id) throw new DeepSeekError(`DeepSeek image upload failed: ${JSON.stringify(json).slice(0, 200)}`);
    await waitForFile(token, String(id)); // block until the file is parsed and usable
    ids.push(String(id));
  }
  return ids;
}

// --- prompt collapsing (stateless) ------------------------------------------
// DeepSeek keeps conversation state server-side, but we run stateless like the
// Qwen proxy: the client resends full history, and we fold it into one prompt.

function messageText(m: OpenAIMessage): string {
  if (typeof m.content === "string") return m.content;
  if (Array.isArray(m.content)) return m.content.map((p) => (typeof p === "string" ? p : p.text || "")).join("");
  return String(m.content ?? "");
}

export function collapseMessages(messages: OpenAIMessage[]): string {
  const systemParts: string[] = [];
  const turns: { role: string; text: string }[] = [];
  for (const m of messages) {
    const text = messageText(m);
    if (!text) continue;
    const role = m.role === "assistant" ? "assistant" : m.role === "system" ? "system" : "user";
    if (role === "system") systemParts.push(text);
    else turns.push({ role, text });
  }
  if (systemParts.length === 0 && turns.length <= 1) return turns[0]?.text ?? "";
  const lines: string[] = [];
  if (systemParts.length) lines.push(systemParts.join("\n\n"), "");
  for (const t of turns) lines.push(`${t.role === "assistant" ? "Assistant" : "User"}: ${t.text}`);
  lines.push("Assistant:");
  return lines.join("\n");
}

// --- completion -------------------------------------------------------------

export interface CompletionOpts {
  sessionId: string;
  modelType: string | null;
  prompt: string;
  refFileIds?: string[];
  thinking: boolean;
  search?: boolean;
}

export async function openCompletion(token: string, opts: CompletionOpts): Promise<Response> {
  const pow = await powHeaderFor(token, "/api/v0/chat/completion");
  const body = {
    chat_session_id: opts.sessionId,
    parent_message_id: null, // stateless: always a fresh first turn
    model_type: opts.modelType,
    prompt: opts.prompt,
    ref_file_ids: opts.refFileIds || [],
    thinking_enabled: opts.thinking,
    search_enabled: Boolean(opts.search),
    action: null,
    preempt: false,
  };
  const res = await fetch(`${DEEPSEEK_BASE}/api/v0/chat/completion`, {
    method: "POST",
    headers: headers(token, { "x-ds-pow-response": pow, Accept: "text/event-stream" }),
    body: JSON.stringify(body),
  });
  const ct = res.headers.get("content-type") || "";
  if (!res.ok || !res.body || !ct.includes("event-stream")) {
    const text = await res.text().catch(() => "");
    if (looksLikeChallenge(res.status, text))
      throw new DeepSeekError("DeepSeek anti-bot / auth challenge on completion.", 503);
    let detail = text.slice(0, 200);
    let json: any = null;
    try {
      json = JSON.parse(text);
      detail = json?.msg || json?.data?.biz_msg || detail;
    } catch {}
    if (isBadToken(json))
      throw new DeepSeekError("Your DeepSeek token was rejected (expired or banned). Re-link it at /link.", 401);
    throw new DeepSeekError(`DeepSeek completion failed (${res.status}): ${detail}`);
  }
  return res;
}

export interface DeepSeekDelta {
  kind: "thinking" | "answer";
  text: string;
}

// Parse the JSON-patch SSE stream, yielding thinking/answer text deltas.
export async function* deepseekDeltas(res: Response): AsyncGenerator<DeepSeekDelta> {
  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  // Fragment types by index, and the "current" fragment for bare {v} continuations.
  const fragTypes: string[] = [];
  let curType: "thinking" | "answer" = "thinking";

  const routeOf = (type: string): "thinking" | "answer" => (type === "THINK" ? "thinking" : "answer");

  function* apply(msg: any): Generator<DeepSeekDelta> {
    const p: unknown = msg.p;
    const v: unknown = msg.v;

    // Initial snapshot: {"v":{"response":{...,"fragments":[...]}}}
    if (p === undefined && v && typeof v === "object" && (v as any).response) {
      const frags = (v as any).response.fragments;
      if (Array.isArray(frags)) {
        for (const f of frags) {
          fragTypes.push(f.type);
          curType = routeOf(f.type);
          if (typeof f.content === "string" && f.content) yield { kind: curType, text: f.content };
        }
      }
      return;
    }

    if (typeof p === "string") {
      // New fragment(s) appended: {"p":"response/fragments","o":"APPEND","v":[{type,content}]}
      if (p === "response/fragments") {
        const arr = Array.isArray(v) ? v : [v];
        for (const f of arr as any[]) {
          fragTypes.push(f.type);
          curType = routeOf(f.type);
          if (typeof f.content === "string" && f.content) yield { kind: curType, text: f.content };
        }
        return;
      }
      // Content append to a specific fragment: response/fragments/<i>/content
      const cm = p.match(/^response\/fragments\/(-?\d+)\/content$/);
      if (cm) {
        const i = cm[1] === "-1" ? fragTypes.length - 1 : parseInt(cm[1], 10);
        curType = routeOf(fragTypes[i] ?? (curType === "thinking" ? "THINK" : "RESPONSE"));
        if (typeof v === "string" && v) yield { kind: curType, text: v };
        return;
      }
      // Anything else (elapsed_secs, status, token usage, BATCH) — not content.
      return;
    }

    // Bare continuation: {"v":"..."} appends to the current fragment content.
    if (p === undefined && (typeof v === "string" || typeof v === "number")) {
      const text = String(v);
      if (text) yield { kind: curType, text };
    }
  }

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
      let msg: any;
      try {
        msg = JSON.parse(data);
      } catch {
        continue;
      }
      if (msg?.error) throw new DeepSeekError(`DeepSeek stream error: ${msg.error?.message || "unknown"}`);
      yield* apply(msg);
    }
  }
}

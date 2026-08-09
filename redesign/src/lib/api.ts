/* ============================================================================
   PLACEHOLDER BACKEND.

   Nothing here talks to a server. Every function returns the same shape the
   real API already returns, so wiring this up later is a swap of the two
   functions at the bottom of this file and nothing else.

   The shapes are copied from the live endpoints, not invented:
     GET  /v1/models              -> { object: "list", data: Model[] }
     POST /v1/chat/completions    -> OpenAI SSE, choices[0].delta.content

   To go live:
     1. set LIVE = true
     2. set BASE to the deployment origin
     3. supply a key (the real site also accepts a session cookie from its own UI)
   ========================================================================== */

export const LIVE = false;
export const BASE = "https://syde.up.railway.app";

export interface ModelInput {
  text: boolean;
  image: boolean;
  document: boolean;
  video: boolean;
  audio: boolean;
}

export interface Model {
  id: string;
  display_name: string;
  owned_by: string;
  capabilities: {
    vision: boolean;
    thinking: boolean;
    chat_types: string[];
    input: ModelInput;
    context_length?: number;
  };
}

const io = (
  image = false,
  document = false,
  video = false,
  audio = false
): ModelInput => ({ text: true, image, document, video, audio });

/* The real catalogue: every id the live endpoint serves. Capability flags are
   the measured ones, including the detail that separates the two flagships,
   where qwen3.8-max takes audio and qwen3.8-max-preview does not. */
const M = (
  id: string,
  display_name: string,
  owned_by: string,
  thinking: boolean,
  input: ModelInput,
  context_length?: number,
  chat_types: string[] = ["t2t"]
): Model => ({
  id,
  display_name,
  owned_by,
  capabilities: { vision: input.image, thinking, chat_types, input, context_length },
});

const MODELS: Model[] = [
  // Qwen, live from the account pool.
  M("qwen3.8-max", "Qwen3.8 Max", "qwen", true, io(true, true, true, true), 1_000_000),
  M("qwen3.8-max-preview", "Qwen3.8 Max Preview", "qwen", true, io(true, true, true), 1_000_000),
  M("qwen3.7-plus", "Qwen3.7 Plus", "qwen", true, io(true, true, true, true), 1_000_000),
  M("qwen3.7-max", "Qwen3.7 Max", "qwen", true, io(false, true), 262_144),
  M("qwen3.6-plus", "Qwen3.6 Plus", "qwen", true, io(true, true, true, true), 262_144),
  M("qwen3.6-max-preview", "Qwen3.6 Max Preview", "qwen", true, io(false, true), 262_144),
  M("qwen3.6-27b", "Qwen3.6 27B", "qwen", true, io(true, true, true), 262_144),
  M("qwen3.6-35b-a3b", "Qwen3.6 35B A3B", "qwen", true, io(true, true, true, true), 262_144),
  M("qwen3.5-plus", "Qwen3.5 Plus", "qwen", true, io(true, true, true, true), 131_072),
  M("qwen3.5-flash", "Qwen3.5 Flash", "qwen", true, io(true, true, true, true), 131_072),
  M("qwen3.5-397b-a17b", "Qwen3.5 397B A17B", "qwen", true, io(true, true, true, true), 262_144),
  M("qwen3.5-omni-plus", "Qwen3.5 Omni Plus", "qwen", false, io(true, true, true, true), 131_072),
  M("qwen3.5-omni-flash", "Qwen3.5 Omni Flash", "qwen", false, io(true, true, true, true), 131_072),
  M("qwen3-max-2026-01-23", "Qwen3 Max", "qwen", true, io(true, true, true, true), 262_144),
  M("qwen-plus-2025-07-28", "Qwen Plus", "qwen", true, io(true, true, true, true), 131_072),
  M("qwen3-coder-plus", "Qwen3 Coder Plus", "qwen", false, io(true, true, true, true), 1_000_000),
  M("qwen3-vl-plus", "Qwen3 VL Plus", "qwen", true, io(true, true, true), 262_144),
  M("qwen3-omni-flash-2025-12-01", "Qwen3 Omni Flash", "qwen", true, io(true, true, true, true), 131_072),

  // Media generation.
  M("qwen-image-3.0", "Qwen Image 3.0", "qwen", false, io(true), undefined, ["t2i", "image_edit"]),
  M("qwen-image-2.0", "Qwen Image 2.0", "qwen", false, io(true), undefined, ["t2i", "image_edit"]),
  M("qwen-wan", "Qwen Wan", "qwen", false, io(), undefined, ["t2v"]),

  // Free tier, text only.
  M("moonshotai/kimi-k3-free", "Kimi K3", "moonshotai", true, io(), 262_144),
  M("moonshotai/kimi-k2.7-code", "Kimi K2.7 Code", "moonshotai", false, io(), 131_072),
  M("moonshotai/kimi-k2.6", "Kimi K2.6", "moonshotai", false, io(), 131_072),
  M("openai/gpt-5.6-luna", "GPT 5.6 Luna", "openai", true, io(), 131_072),
  M("openai/gpt-5.4-mini", "GPT 5.4 Mini", "openai", false, io(), 131_072),
  M("openai/gpt-5.4-nano", "GPT 5.4 Nano", "openai", false, io(), 131_072),
  M("deepseek/deepseek-v4-pro", "DeepSeek V4 Pro", "deepseek", true, io(), 163_840),
  M("xai/grok-4.3", "Grok 4.3", "xai", true, io(), 131_072),
  M("xai/grok-code-fast-1", "Grok Code Fast 1", "xai", false, io(), 262_144),
  M("google/gemma-3.12b", "Gemma 3 12B", "google", false, io(), 131_072),
  M("qwen/qwen3-coder-480b", "Qwen3 Coder 480B", "qwen", false, io(), 262_144),
];

export async function listModels(): Promise<Model[]> {
  if (LIVE) {
    const r = await fetch(`${BASE}/v1/models`, { headers: authHeaders() });
    if (!r.ok) throw new Error(`models failed (${r.status})`);
    return (await r.json()).data as Model[];
  }
  await wait(260); // stand in for the round trip, so loading states are real
  return MODELS;
}

/* Canned answers, chosen so the preview shows the model doing something a
   developer would actually ask of it rather than reciting marketing copy. */
const REPLIES: { match: RegExp; text: string }[] = [
  {
    match: /stream|sse|event/i,
    text: "Set `stream: true` and read the SSE frames. Each chunk is a\n`chat.completion.chunk` with the text in `choices[0].delta.content`,\nand the stream closes with `data: [DONE]`.",
  },
  {
    match: /tool|function/i,
    text: "Send `tools` with OpenAI function schemas. Calls come back in\n`choices[0].message.tool_calls`, and `tool_choice` accepts \"auto\",\n\"none\", or a named function to force one.",
  },
  {
    match: /audio|video|image|file|upload/i,
    text: "Check `capabilities.input` on any model. qwen3.8-max accepts image,\nfile, video and audio. The preview accepts everything except audio,\nwhich is the only difference between them.",
  },
  {
    match: /price|cost|free|limit/i,
    text: "One key covers every model on the endpoint. Rate limits are per key\nand reported on `x-ratelimit-*` response headers.",
  },
];

const FALLBACK =
  "One endpoint, one key, every model. Point any OpenAI client at\n/v1 and change the model id. Anthropic clients use /v1/messages\nwith no /v1 on the base URL, since the SDK appends it.";

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface ChatOptions {
  model: string;
  messages: ChatMessage[];
  system?: string;
  temperature?: number;
  maxTokens?: number;
  thinking?: boolean;
}

/** A reply arrives on two channels. Reasoning is separate from the answer so a
    caller can show it, fold it, or drop it without touching the text. */
export interface Delta {
  channel: "reasoning" | "answer";
  text: string;
}

const REASONING =
  "The question is about the endpoint rather than the model, so the answer\nshould name the exact route and the field to read. Keeping it short.";

/**
 * The full request. This is what the playground and chat both call.
 *
 * Async generator rather than a callback, because that is the shape the real
 * SSE reader already has: going live means replacing the body of this function,
 * not the components that consume it.
 */
export async function* streamChat(
  opts: ChatOptions,
  signal?: AbortSignal
): AsyncGenerator<Delta> {
  const last = [...opts.messages].reverse().find((m) => m.role === "user");
  const prompt = last?.content ?? "";

  if (LIVE) {
    const r = await fetch(`${BASE}/v1/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...authHeaders() },
      body: JSON.stringify({
        model: opts.model,
        messages: opts.system
          ? [{ role: "system", content: opts.system }, ...opts.messages]
          : opts.messages,
        stream: true,
        ...(opts.temperature !== undefined ? { temperature: opts.temperature } : {}),
        ...(opts.maxTokens ? { max_tokens: opts.maxTokens } : {}),
        ...(opts.thinking === false ? { enable_thinking: false } : {}),
      }),
      signal,
    });
    if (!r.ok) throw new Error(`request failed (${r.status})`);
    const reader = r.body!.getReader();
    const decoder = new TextDecoder();
    let buf = "";
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      let i: number;
      while ((i = buf.indexOf("\n")) !== -1) {
        const line = buf.slice(0, i).trim();
        buf = buf.slice(i + 1);
        if (!line.startsWith("data:")) continue;
        const payload = line.slice(5).trim();
        if (!payload || payload === "[DONE]") continue;
        try {
          const d = JSON.parse(payload)?.choices?.[0]?.delta;
          if (typeof d?.reasoning_content === "string" && d.reasoning_content)
            yield { channel: "reasoning", text: d.reasoning_content };
          if (typeof d?.content === "string" && d.content)
            yield { channel: "answer", text: d.content };
        } catch { /* skip a malformed frame rather than ending the reply */ }
      }
    }
    return;
  }

  const emit = async function* (text: string, channel: Delta["channel"]) {
    for (const part of text.match(/\S+\s*/g) ?? []) {
      if (signal?.aborted) return;
      await wait(22 + Math.random() * 40);
      yield { channel, text: part };
    }
  };

  if (opts.thinking !== false) yield* emit(REASONING, "reasoning");
  const answer = REPLIES.find((r) => r.match.test(prompt))?.text ?? FALLBACK;
  yield* emit(answer, "answer");
}

/**
 * Stream a reply one token at a time.
 *
 * Async generator rather than a callback, because that is the shape the real
 * SSE reader already has: swapping in the live call means replacing the body
 * of this function, not the components that consume it.
 */
export async function* streamCompletion(
  prompt: string,
  signal?: AbortSignal
): AsyncGenerator<string> {
  const stream = streamChat(
    { model: "qwen3.8-max", messages: [{ role: "user", content: prompt }], thinking: false },
    signal
  );
  for await (const d of stream) if (d.channel === "answer") yield d.text;
}

function authHeaders(): Record<string, string> {
  const key = localStorage.getItem("syde_api_key");
  return key ? { Authorization: `Bearer ${key}` } : {};
}

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

/* Throughput samples for the latency figure. Deliberately uneven: a smooth
   curve would be a drawing, and these are presented as sample data. */
export const LATENCY_SAMPLE = [
  312, 288, 341, 297, 268, 305, 279, 264, 331, 292,
  256, 274, 318, 261, 249, 283, 271, 302, 258, 247,
];

/* ============================================================================
   Account, keys and pool admin.

   Same placeholder rules as above: the shapes match the live endpoints, so
   going live is swapping the bodies, not the pages.

     POST /api/auth/discord/verify   { code }      -> { discord, relay }
     GET  /api/auth/discord/dm-status?relay=       -> { status }
     POST /api/auth/discord/redm     { relay }
     POST /api/auth/discord/login    { key }       -> session cookie
     GET  /api/auth/me                             -> Me | null
     POST /api/auth/logout
     GET  /api/account/keys                        -> { keys: Key[] }
     POST /api/account/keys          { name }      -> { key, id }
     POST /api/account/keys/revoke   { id }
     GET  /api/account/usage                       -> { days: UsageDay[] }
     GET  /api/admin/tokens                        -> { tokens: PoolToken[] }
   ========================================================================== */

export interface Me {
  id: string;
  username: string;
  avatar: string | null;
  role: "owner" | "admin" | "member";
}

export interface Key {
  id: string;
  name: string;
  key_prefix: string;
  revoked: boolean;
  created_at: string;
  last_used_at: string | null;
  requests: number;
}

export interface UsageDay { day: string; requests: number; }

export interface PoolToken {
  id: string;
  label: string;
  active: boolean;
  error_count: number;
  last_used_at: string | null;
  expires_at: string;
}

const SESSION = "syde_session";

/** The signed-in user, or null. Session lives in this browser while mocked. */
export async function me(): Promise<Me | null> {
  if (LIVE) {
    const r = await fetch(`${BASE}/api/auth/me`, { credentials: "include" });
    if (!r.ok) return null;
    return (await r.json()).user ?? null;
  }
  await wait(150);
  const raw = localStorage.getItem(SESSION);
  return raw ? (JSON.parse(raw) as Me) : null;
}

/** Step one of the Discord link: the bot hands out a one-time code. */
export async function verifyCode(code: string): Promise<{ me: Me; relay: string }> {
  if (LIVE) {
    const r = await fetch(`${BASE}/api/auth/discord/verify`, {
      method: "POST", credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code }),
    });
    if (!r.ok) throw new Error((await r.json()).error ?? "That code did not work.");
    const j = await r.json();
    return { me: j.discord, relay: j.relay };
  }
  await wait(700);
  // QW- followed by six characters from an alphabet with no 0/O/1/I, so a code
  // read off a screen cannot be mistyped into a different valid code.
  if (!/^QW-[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{6}$/.test(code.trim().toUpperCase()))
    throw new Error("That is not a link code. Run /link in Discord to get one.");
  const user: Me = { id: "512", username: "weirdmm", avatar: null, role: "owner" };
  localStorage.setItem(SESSION, JSON.stringify(user));
  return { me: user, relay: "relay-mock" };
}

/** Whether the bot managed to DM the login key. */
export async function dmStatus(relay: string): Promise<"sending" | "sent" | "dms_closed" | "failed"> {
  if (LIVE) {
    const r = await fetch(`${BASE}/api/auth/discord/dm-status?relay=${encodeURIComponent(relay)}`);
    return (await r.json()).status;
  }
  await wait(1200);
  return "sent";
}

export async function loginWithKey(key: string): Promise<Me> {
  if (LIVE) {
    const r = await fetch(`${BASE}/api/auth/discord/login`, {
      method: "POST", credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ key }),
    });
    if (!r.ok) throw new Error("That login key was not accepted.");
    return (await r.json()).user;
  }
  await wait(600);
  if (!/^(syde|qwen)_sk_/.test(key.trim())) throw new Error("A login key starts with syde_sk_.");
  const user: Me = { id: "512", username: "weirdmm", avatar: null, role: "owner" };
  localStorage.setItem(SESSION, JSON.stringify(user));
  return user;
}

export async function logout(): Promise<void> {
  if (LIVE) { await fetch(`${BASE}/api/auth/logout`, { method: "POST", credentials: "include" }); return; }
  localStorage.removeItem(SESSION);
}

const KEYS = "syde_keys";
const readKeys = (): Key[] => JSON.parse(localStorage.getItem(KEYS) ?? "[]");
const writeKeys = (k: Key[]) => localStorage.setItem(KEYS, JSON.stringify(k));

export async function listKeys(): Promise<Key[]> {
  if (LIVE) {
    const r = await fetch(`${BASE}/api/account/keys`, { credentials: "include" });
    return (await r.json()).keys ?? [];
  }
  await wait(220);
  return readKeys();
}

/** The full key is returned exactly once, which is why the page shows it once. */
export async function createKey(name: string): Promise<{ key: string; record: Key }> {
  if (LIVE) {
    const r = await fetch(`${BASE}/api/account/keys`, {
      method: "POST", credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name }),
    });
    if (!r.ok) throw new Error("Could not create key.");
    const j = await r.json();
    return { key: j.key, record: j.record };
  }
  await wait(520);
  const hex = [...crypto.getRandomValues(new Uint8Array(24))]
    .map((b) => b.toString(16).padStart(2, "0")).join("");
  const key = `syde_sk_${hex}`;
  const record: Key = {
    id: crypto.randomUUID(),
    name: name || "Untitled key",
    key_prefix: key.slice(0, 16) + "…",
    revoked: false,
    created_at: new Date().toISOString(),
    last_used_at: null,
    requests: 0,
  };
  writeKeys([record, ...readKeys()]);
  return { key, record };
}

export async function revokeKey(id: string): Promise<void> {
  if (LIVE) {
    await fetch(`${BASE}/api/account/keys/revoke`, {
      method: "POST", credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id }),
    });
    return;
  }
  await wait(240);
  writeKeys(readKeys().map((k) => (k.id === id ? { ...k, revoked: true } : k)));
}

export async function usage(): Promise<UsageDay[]> {
  if (LIVE) {
    const r = await fetch(`${BASE}/api/account/usage`, { credentials: "include" });
    return (await r.json()).days ?? [];
  }
  await wait(300);
  const out: UsageDay[] = [];
  for (let i = 13; i >= 0; i--) {
    const d = new Date(Date.now() - i * 86400_000);
    out.push({ day: d.toISOString().slice(0, 10), requests: Math.round(40 + Math.random() * 210) });
  }
  return out;
}

export async function poolTokens(): Promise<PoolToken[]> {
  if (LIVE) {
    const r = await fetch(`${BASE}/api/admin/tokens`, { credentials: "include" });
    return (await r.json()).tokens ?? [];
  }
  await wait(280);
  return Array.from({ length: 8 }).map((_, i) => ({
    id: `tok-${i}`,
    label: `account-${String(i + 1).padStart(3, "0")}`,
    active: i !== 5,
    error_count: i === 5 ? 12 : i % 3,
    last_used_at: new Date(Date.now() - i * 3600_000).toISOString(),
    expires_at: new Date(Date.now() + (16 - i) * 86400_000).toISOString(),
  }));
}

export interface Voice { speaker: string; name: string; kind: "audio" | "omni"; }

/**
 * Speech voices, from GET /v1/audio/voices.
 *
 * A separate list from the model catalogue on purpose: speech picks a voice,
 * not a chat model, so offering text models there would be offering something
 * the endpoint cannot use.
 */
export async function listVoices(): Promise<Voice[]> {
  if (LIVE) {
    const r = await fetch(`${BASE}/v1/audio/voices`, { headers: authHeaders() });
    if (!r.ok) throw new Error(`voices failed (${r.status})`);
    return (await r.json()).data as Voice[];
  }
  await wait(200);
  return [
    { speaker: "cherry", name: "Cherry", kind: "audio" },
    { speaker: "ethan", name: "Ethan", kind: "audio" },
    { speaker: "nofish", name: "Nofish", kind: "audio" },
    { speaker: "jennifer", name: "Jennifer", kind: "audio" },
    { speaker: "ryan", name: "Ryan", kind: "audio" },
    { speaker: "katerina", name: "Katerina", kind: "audio" },
    { speaker: "elias", name: "Elias", kind: "omni" },
    { speaker: "dylan", name: "Dylan", kind: "omni" },
    { speaker: "sunny", name: "Sunny", kind: "omni" },
    { speaker: "peter", name: "Peter", kind: "omni" },
  ];
}

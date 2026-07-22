// Supabase-backed API key management (server-side only, uses the service role).

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { createHash, randomBytes } from "node:crypto";

let _client: SupabaseClient | null = null;

export function admin(): SupabaseClient {
  if (_client) return _client;
  const url = process.env.SUPABASE_URL;
  const serviceRole = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceRole) {
    throw new Error("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set");
  }
  _client = createClient(url, serviceRole, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return _client;
}

export function hashKey(key: string): string {
  return createHash("sha256").update(key).digest("hex");
}

function supabaseConfigured(): boolean {
  return Boolean(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY);
}

export interface ApiKeyRecord {
  id: string;
  name: string | null;
  key_hash: string;
  key_prefix: string;
  revoked: boolean;
}

// Pull the API key from an Authorization: Bearer <key> header (or x-api-key).
export function extractApiKey(headers: Headers): string | null {
  const auth = headers.get("authorization");
  if (auth && /^Bearer\s+/i.test(auth)) return auth.replace(/^Bearer\s+/i, "").trim();
  const x = headers.get("x-api-key");
  return x ? x.trim() : null;
}

// Validate a key against Supabase. Returns the record or null. Bumps usage.
export async function validateApiKey(key: string): Promise<ApiKeyRecord | null> {
  // Local-dev bypass: if DEV_MASTER_KEY is set (never set it in production) and
  // matches, accept without Supabase. Lets you test the proxy with no DB set up.
  const devKey = process.env.DEV_MASTER_KEY;
  if (devKey && key === devKey) {
    return { id: "dev", name: "dev", key_hash: "", key_prefix: "dev", revoked: false };
  }
  if (!supabaseConfigured()) return null;
  const key_hash = hashKey(key);
  const { data, error } = await admin()
    .from("api_keys")
    .select("id, name, key_hash, key_prefix, revoked")
    .eq("key_hash", key_hash)
    .maybeSingle();
  if (error || !data || data.revoked) return null;
  // Best-effort usage bump (don't block the request on it).
  admin().rpc("touch_api_key", { p_key_hash: key_hash }).then(() => {}, () => {});
  return data as ApiKeyRecord;
}

// Generate a new key, store its hash, return the raw key ONCE.
export async function createApiKey(name: string | null, ip?: string | null): Promise<{ id: string; key: string; key_prefix: string }> {
  const key = "qwen_sk_" + randomBytes(24).toString("hex");
  const key_hash = hashKey(key);
  const key_prefix = key.slice(0, 16) + "…";
  const { data, error } = await admin()
    .from("api_keys")
    .insert({ name, key_hash, key_prefix, created_ip: ip || null })
    .select("id")
    .single();
  if (error) throw new Error(error.message);
  return { id: data.id, key, key_prefix };
}

// --- IP blacklist ----------------------------------------------------------

export async function isIpBlacklisted(ip: string): Promise<boolean> {
  if (!ip || ip === "unknown") return false;
  const { data } = await admin().from("blacklisted_ips").select("ip").eq("ip", ip).maybeSingle();
  return Boolean(data);
}

export async function blacklistIp(ip: string, reason: string, keysDeleted = 0) {
  await admin().from("blacklisted_ips").upsert({ ip, reason, keys_deleted: keysDeleted }, { onConflict: "ip" });
}

// Delete every key created by an IP. Returns how many were removed.
export async function deleteKeysByIp(ip: string): Promise<number> {
  const { error, count } = await admin().from("api_keys").delete({ count: "exact" }).eq("created_ip", ip);
  if (error) throw new Error(error.message);
  return count || 0;
}

// Total keys ever created by an IP.
export async function countKeysByIp(ip: string): Promise<number> {
  const { count, error } = await admin()
    .from("api_keys")
    .select("id", { count: "exact", head: true })
    .eq("created_ip", ip);
  if (error) return 0;
  return count || 0;
}

export async function listBlacklist() {
  const { data, error } = await admin()
    .from("blacklisted_ips")
    .select("ip, reason, keys_deleted, created_at")
    .order("created_at", { ascending: false });
  if (error) throw new Error(error.message);
  return data || [];
}

export async function unblacklistIp(ip: string) {
  const { error } = await admin().from("blacklisted_ips").delete().eq("ip", ip);
  if (error) throw new Error(error.message);
}

// How many keys were created by this IP in the last `windowMs`.
export async function countRecentKeysByIp(ip: string, windowMs: number): Promise<number> {
  const since = new Date(Date.now() - windowMs).toISOString();
  const { count, error } = await admin()
    .from("api_keys")
    .select("id", { count: "exact", head: true })
    .eq("created_ip", ip)
    .gte("created_at", since);
  if (error) return 0;
  return count || 0;
}

// Global keys created in the last `windowMs` (backstop against IP rotation).
export async function countRecentKeysGlobal(windowMs: number): Promise<number> {
  const since = new Date(Date.now() - windowMs).toISOString();
  const { count, error } = await admin()
    .from("api_keys")
    .select("id", { count: "exact", head: true })
    .gte("created_at", since);
  if (error) return 0;
  return count || 0;
}

export async function deleteApiKey(id: string) {
  const { error } = await admin().from("api_keys").delete().eq("id", id);
  if (error) throw new Error(error.message);
}

// Bulk-delete unused keys whose name matches a prefix (e.g. spam "batch-…" keys).
export async function purgeKeysByPrefix(prefix: string): Promise<number> {
  const { error, count } = await admin()
    .from("api_keys")
    .delete({ count: "exact" })
    .like("name", `${prefix}%`)
    .eq("request_count", 0);
  if (error) throw new Error(error.message);
  return count || 0;
}

// Delete ALL API keys. Returns how many were removed. Uses a count instead of
// returning every deleted row (there can be tens of thousands).
export async function deleteAllApiKeys(): Promise<number> {
  const { error, count } = await admin()
    .from("api_keys")
    .delete({ count: "exact" })
    .not("id", "is", null);
  if (error) throw new Error(error.message);
  return count || 0;
}

export async function listApiKeys() {
  const { data, error } = await admin()
    .from("api_keys")
    .select("id, name, key_prefix, created_at, last_used_at, revoked, request_count")
    .order("created_at", { ascending: false });
  if (error) throw new Error(error.message);
  return data;
}

export async function logUsage(apiKeyId: string, model: string, hadImage: boolean, streamed: boolean, status: number) {
  if (!supabaseConfigured()) return; // no DB in local-dev / bypass mode
  admin()
    .from("usage_logs")
    .insert({ api_key_id: apiKeyId, model, had_image: hadImage, streamed, status })
    .then(() => {}, () => {});
}

// --- Qwen token pool (admin-managed) ---------------------------------------

export async function addQwenToken(label: string | null, token: string) {
  const { data, error } = await admin()
    .from("qwen_tokens")
    .insert({ label, token })
    .select("id, label, active, created_at")
    .single();
  if (error) throw new Error(error.message);
  return data;
}

// Bulk-insert many tokens at once (one per entry). Returns how many were added.
export async function addQwenTokens(rows: { label: string | null; token: string }[]): Promise<number> {
  if (rows.length === 0) return 0;
  const { data, error } = await admin().from("qwen_tokens").insert(rows).select("id");
  if (error) throw new Error(error.message);
  return data?.length || 0;
}

// List tokens for the admin dashboard — the raw token is masked, never returned whole.
export async function listQwenTokens() {
  const { data, error } = await admin()
    .from("qwen_tokens")
    .select("id, label, token, active, created_at, last_used_at, error_count")
    .order("created_at", { ascending: false });
  if (error) throw new Error(error.message);
  return (data || []).map((t) => ({
    id: t.id,
    label: t.label,
    active: t.active,
    created_at: t.created_at,
    last_used_at: t.last_used_at,
    error_count: t.error_count,
    masked: (t.token || "").slice(0, 6) + "…" + (t.token || "").slice(-4),
  }));
}

export async function setQwenTokenActive(id: string, active: boolean) {
  const { error } = await admin().from("qwen_tokens").update({ active }).eq("id", id);
  if (error) throw new Error(error.message);
}

export async function deleteQwenToken(id: string) {
  const { error } = await admin().from("qwen_tokens").delete().eq("id", id);
  if (error) throw new Error(error.message);
}

// --- DeepSeek "bring your own token" links ----------------------------------
// Each API key links its owner's own chat.deepseek.com token, stored in
// `deepseek_user_tokens` (RLS on, service-role only). Tokens are secrets: they are
// used server-side and never returned to any client.

export async function setDeepSeekToken(apiKeyId: string, token: string): Promise<void> {
  const { error } = await admin()
    .from("deepseek_user_tokens")
    .upsert({ api_key_id: apiKeyId, token, linked_at: new Date().toISOString(), last_error: null }, { onConflict: "api_key_id" });
  if (error) throw new Error(error.message);
}

export async function getDeepSeekToken(apiKeyId: string): Promise<string | null> {
  if (!supabaseConfigured()) return null;
  const { data } = await admin().from("deepseek_user_tokens").select("token").eq("api_key_id", apiKeyId).maybeSingle();
  return data?.token || null;
}

export async function isDeepSeekLinked(apiKeyId: string): Promise<boolean> {
  if (!supabaseConfigured()) return false;
  const { data } = await admin().from("deepseek_user_tokens").select("api_key_id").eq("api_key_id", apiKeyId).maybeSingle();
  return Boolean(data);
}

export async function deleteDeepSeekToken(apiKeyId: string): Promise<void> {
  const { error } = await admin().from("deepseek_user_tokens").delete().eq("api_key_id", apiKeyId);
  if (error) throw new Error(error.message);
}

// Mark a linked token as failing (e.g. expired/banned) so the user sees why.
export function noteDeepSeekTokenError(apiKeyId: string, message: string) {
  if (!supabaseConfigured()) return;
  admin().from("deepseek_user_tokens").update({ last_error: message.slice(0, 200) }).eq("api_key_id", apiKeyId).then(() => {}, () => {});
}

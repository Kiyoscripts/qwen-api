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
export async function createApiKey(name: string | null): Promise<{ id: string; key: string; key_prefix: string }> {
  const key = "qwen_sk_" + randomBytes(24).toString("hex");
  const key_hash = hashKey(key);
  const key_prefix = key.slice(0, 16) + "…";
  const { data, error } = await admin()
    .from("api_keys")
    .insert({ name, key_hash, key_prefix })
    .select("id")
    .single();
  if (error) throw new Error(error.message);
  return { id: data.id, key, key_prefix };
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

// Supabase-backed API key management (server-side only, uses the service role).

import { postgresAdmin, transaction } from "./postgres";
import { createHash, randomBytes } from "node:crypto";

export const admin = postgresAdmin;

export function hashKey(key: string): string {
  return createHash("sha256").update(key).digest("hex");
}

function databaseConfigured(): boolean {
  return Boolean(process.env.DATABASE_URL);
}

export interface ApiKeyRecord {
  id: string;
  name: string | null;
  key_hash: string;
  key_prefix: string;
  revoked: boolean;
  expires_at?: string | null;
  request_limit?: number | null;
  request_count?: number;
  allowed_models?: string[] | null;
  allowed_ips?: string[] | null;
}

// Pull the API key from an Authorization: Bearer <key> header (or x-api-key).
export function extractApiKey(headers: Headers): string | null {
  const auth = headers.get("authorization");
  if (auth && /^Bearer\s+/i.test(auth)) return auth.replace(/^Bearer\s+/i, "").trim();
  const x = headers.get("x-api-key");
  return x ? x.trim() : null;
}

// Validate a key against PostgreSQL. Returns the record or null. Bumps usage.
export async function validateApiKey(key: string): Promise<ApiKeyRecord | null> {
  // Local-dev bypass: if DEV_MASTER_KEY is set (never set it in production) and
  // matches, accept without PostgreSQL. Lets you test the proxy with no DB set up.
  const devKey = process.env.DEV_MASTER_KEY;
  if (devKey && key === devKey) {
    return { id: "dev", name: "dev", key_hash: "", key_prefix: "dev", revoked: false };
  }
  if (!databaseConfigured()) return null;
  const key_hash = hashKey(key);
  const { data, error } = await admin().rpc("consume_api_key", { p_key_hash: key_hash });
  if (error || !data?.length) return null;
  return data[0] as ApiKeyRecord;
}

// Generate a new key, store its hash, return the raw key ONCE. Pass userId to
// attach it to an account (keys without a user auto-expire — see cleanup below).
export async function createApiKey(
  name: string | null,
  ip?: string | null,
  userId?: string | null
): Promise<{ id: string; key: string; key_prefix: string }> {
  const key = "syde_sk_" + randomBytes(24).toString("hex");
  const key_hash = hashKey(key);
  const key_prefix = key.slice(0, 16) + "…";
  // Only reference user_id when we actually have a user, so anonymous key creation
  // keeps working even before the account-system migration adds the column.
  const row: Record<string, unknown> = { name, key_hash, key_prefix, created_ip: ip || null };
  if (userId) row.user_id = userId;
  const { data, error } = await admin().from("api_keys").insert(row).select("id").single();
  if (error) throw new Error(error.message);
  return { id: data.id, key, key_prefix };
}

export async function createRestrictedApiKey(input: { name: string | null; userId: string; requestLimit: number | null; expiresAt: string | null; allowedModels: string[] | null; allowedIps: string[] | null }) {
  const key = "syde_sk_" + randomBytes(24).toString("hex");
  const keyHash = hashKey(key);
  const keyPrefix = key.slice(0, 16) + "...";
  const id = await transaction(async (client) => {
    const result = await client.query(
      `insert into api_keys(name,key_hash,key_prefix,user_id,request_limit,expires_at,allowed_models,allowed_ips) values($1,$2,$3,$4,$5,$6,$7,$8) returning id`,
      [input.name,keyHash,keyPrefix,input.userId,input.requestLimit,input.expiresAt,input.allowedModels,input.allowedIps],
    );
    return result.rows[0].id as string;
  });
  return { id, key, key_prefix: keyPrefix };
}

export async function rotateApiKey(userId: string, oldId: string, overlapMinutes: number) {
  const key = "syde_sk_" + randomBytes(24).toString("hex");
  const keyHash = hashKey(key), keyPrefix = key.slice(0, 16) + "...";
  return transaction(async (client) => {
    const current = await client.query(`select * from api_keys where id=$1 and user_id=$2 and not revoked for update`, [oldId,userId]);
    if (!current.rows[0]) throw new Error("Key not found or revoked.");
    if (current.rows[0].rotated_to) throw new Error("This key has already been rotated.");
    const row=current.rows[0];
    const created=await client.query(`insert into api_keys(name,key_hash,key_prefix,user_id,request_limit,expires_at,allowed_models,allowed_ips) values($1,$2,$3,$4,$5,$6,$7,$8) returning id`,[row.name,keyHash,keyPrefix,userId,row.request_limit,row.expires_at,row.allowed_models,row.allowed_ips]);
    const revokeAt=new Date(Date.now()+overlapMinutes*60_000);
    await client.query(`update api_keys set revoke_at=$2,rotated_to=$3,revoked=case when $2<=now() then true else revoked end where id=$1`,[oldId,revokeAt,created.rows[0].id]);
    return { id:created.rows[0].id,key,key_prefix:keyPrefix,old_key_revoke_at:revokeAt.toISOString() };
  });
}

// --- account-scoped key management -----------------------------------------

export interface UserKey {
  id: string;
  name: string | null;
  key_prefix: string;
  created_at: string;
  last_used_at: string | null;
  request_count: number;
  revoked: boolean;
  expires_at?: string | null;
  request_limit?: number | null;
  allowed_models?: string[] | null;
  allowed_ips?: string[] | null;
}

export async function listUserKeys(userId: string): Promise<UserKey[]> {
  const { data } = await admin()
    .from("api_keys")
    .select("id, name, key_prefix, created_at, last_used_at, request_count, revoked, expires_at, request_limit, allowed_models, allowed_ips")
    .eq("user_id", userId)
    .order("created_at", { ascending: false });
  return (data as UserKey[]) || [];
}

// Attach an existing anonymous key to a user ("convert key to account"). Only
// works on a key that exists, isn't revoked, and isn't already owned.
export async function claimKey(userId: string, rawKey: string): Promise<{ ok: boolean; error?: string; prefix?: string }> {
  const key_hash = hashKey(rawKey.trim());
  const { data } = await admin().from("api_keys").select("id, user_id, revoked, key_prefix").eq("key_hash", key_hash).maybeSingle();
  if (!data) return { ok: false, error: "That key doesn't exist." };
  if (data.revoked) return { ok: false, error: "That key has been revoked." };
  if (data.user_id && data.user_id !== userId) return { ok: false, error: "That key is already linked to another account." };
  if (data.user_id === userId) return { ok: true, prefix: data.key_prefix };
  const { error } = await admin().from("api_keys").update({ user_id: userId }).eq("id", data.id);
  if (error) return { ok: false, error: "Could not link the key." };
  return { ok: true, prefix: data.key_prefix };
}

export async function revokeUserKey(userId: string, keyId: string): Promise<boolean> {
  const { error } = await admin().from("api_keys").update({ revoked: true }).eq("id", keyId).eq("user_id", userId);
  return !error;
}

// Delete anonymous (unlinked) keys older than 3 days. Returns how many went.
export async function cleanupUnlinkedKeys(): Promise<number> {
  const cutoff = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString();
  const { data } = await admin()
    .from("api_keys")
    .delete()
    .is("user_id", null)
    .lt("created_at", cutoff)
    .select("id");
  return (data || []).length;
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

/**
 * The most-requested models, by count, for the landing page.
 *
 * Tallied client-side over a bounded row scan — the same shape the stats route
 * uses for its 24h active-key count — rather than a GROUP BY, which the JS
 * client can't express without a stored procedure. The cap keeps it O(one query)
 * even as usage grows; at real volume it becomes a sample of the busiest models,
 * which is exactly what a "most used" list wants. Empty when no DB is configured.
 */
export async function getTopModels(limit = 3): Promise<{ model: string; requests: number }[]> {
  if (!databaseConfigured()) return [];
  const { data } = await admin().from("usage_logs").select("model").limit(50000);
  if (!data) return [];
  const counts = new Map<string, number>();
  for (const r of data as { model: string | null }[]) {
    if (!r.model) continue;
    counts.set(r.model, (counts.get(r.model) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([model, requests]) => ({ model, requests }))
    .sort((a, b) => b.requests - a.requests)
    .slice(0, limit);
}

export async function logUsage(apiKeyId: string, model: string, hadImage: boolean, streamed: boolean, status: number, details: { requestId?: string; latencyMs?: number; providerAttempts?: number; failureCategory?: string; provider?: string } = {}) {
  if (!databaseConfigured()) return;
  const { error } = await admin()
    .from("usage_logs")
    .insert({ api_key_id: apiKeyId, model, had_image: hadImage, streamed, status, request_id: details.requestId || null, latency_ms: details.latencyMs ?? null, provider_attempts: details.providerAttempts || 1, failure_category: details.failureCategory || (status >= 500 ? "provider_error" : status >= 400 ? "client_error" : null), provider: details.provider || "qwen" });
  if (error) throw new Error(error.message);
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
    .select("id, label, token, active, created_at, last_used_at, error_count, last_health_at, last_success_at, last_failure_at, last_error, latency_ms, expires_at, consecutive_failures, parked_until, last_failure_code, consecutive_routing_failures")
    .order("created_at", { ascending: false });
  if (error) throw new Error(error.message);
  return (data || []).map((t: any) => ({
    id: t.id,
    label: t.label,
    active: t.active,
    created_at: t.created_at,
    last_used_at: t.last_used_at,
    error_count: t.error_count,
    last_health_at: t.last_health_at, last_success_at: t.last_success_at, last_failure_at: t.last_failure_at,
    last_error: t.last_error, latency_ms: t.latency_ms, expires_at: t.expires_at, consecutive_failures: t.consecutive_failures,
    parked_until: t.parked_until, last_failure_code: t.last_failure_code, consecutive_routing_failures: t.consecutive_routing_failures,
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

// --- OneCompiler token pool (admin-managed) ---------------------------------
// Mirrors the Qwen pool above but kept strictly separate: different credential
// type, different exhaustion behaviour, managed on its own. Nothing here should
// ever read or write qwen_tokens.

export async function addOneCompilerToken(label: string | null, token: string) {
  const { data, error } = await admin()
    .from("onecompiler_tokens")
    .insert({ label, token })
    .select("id, label, active, created_at")
    .single();
  if (error) throw new Error(error.message);
  return data;
}

// Bulk-insert many tokens at once (one per entry). Returns how many were added.
export async function addOneCompilerTokens(rows: { label: string | null; token: string }[]): Promise<number> {
  if (rows.length === 0) return 0;
  const { data, error } = await admin().from("onecompiler_tokens").insert(rows).select("id");
  if (error) throw new Error(error.message);
  return data?.length || 0;
}

// List tokens for the admin dashboard — the raw token is masked, never returned whole.
export async function listOneCompilerTokens() {
  const { data, error } = await admin()
    .from("onecompiler_tokens")
    .select("id, label, token, active, created_at, last_used_at, error_count, last_health_at, last_success_at, last_failure_at, last_error, latency_ms, expires_at, consecutive_failures, parked_until, last_failure_code, consecutive_routing_failures")
    .order("created_at", { ascending: false });
  if (error) throw new Error(error.message);
  return (data || []).map((t: any) => ({
    id: t.id,
    label: t.label,
    active: t.active,
    created_at: t.created_at,
    last_used_at: t.last_used_at,
    error_count: t.error_count,
    last_health_at: t.last_health_at, last_success_at: t.last_success_at, last_failure_at: t.last_failure_at,
    last_error: t.last_error, latency_ms: t.latency_ms, expires_at: t.expires_at, consecutive_failures: t.consecutive_failures,
    parked_until: t.parked_until, last_failure_code: t.last_failure_code, consecutive_routing_failures: t.consecutive_routing_failures,
    masked: (t.token || "").slice(0, 6) + "…" + (t.token || "").slice(-4),
  }));
}

export async function setOneCompilerTokenActive(id: string, active: boolean) {
  const { error } = await admin().from("onecompiler_tokens").update({ active }).eq("id", id);
  if (error) throw new Error(error.message);
}

export async function deleteOneCompilerToken(id: string) {
  const { error } = await admin().from("onecompiler_tokens").delete().eq("id", id);
  if (error) throw new Error(error.message);
}

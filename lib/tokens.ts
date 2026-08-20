// Qwen token pool with rotation. Picks a token per request, spreading load across
// all active accounts so no single one gets rate-limited or flagged. Falls back to
// the QWEN_TOKEN env var (which is always included in the pool if set).

import { admin } from "./supabase";
import type { QwenRefusalCode } from "./qwen";
import { logger, publicError } from "./logger";
import { sql } from "./postgres";

interface PoolEntry {
  id: string | null;
  token: string;
  parked_until?: string | null;
}

let cache: { entries: PoolEntry[]; at: number } | null = null;
const TTL_MS = 30_000;

// Accounts that just failed (challenge / rate-limit / etc.) stay out of the
// rotation for a while so we stop hammering the same bad session and give
// healthy accounts the traffic. Keys are entry.id or a short env-token tag.
const parkUntil = new Map<string, number>();

const PARK_MS: Record<QwenRefusalCode, number> = {
  // Anti-bot is often sticky on a session (and sometimes on the egress IP).
  // Park long enough that the next requests prefer other accounts.
  challenge: 30 * 60_000,
  // Dead credentials — keep them out until an admin refreshes the cookie.
  expired: 24 * 60 * 60_000,
  forbidden: 24 * 60 * 60_000,
  // Short throttle window; retry-after is usually much less than this.
  rate_limit: 60_000,
};
const PARK_MS_GENERIC = 60_000;

function parkKey(entry: PoolEntry): string {
  return entry.id ?? `env:${entry.token.slice(0, 16)}`;
}

function isParked(entry: PoolEntry, now = Date.now()): boolean {
  return (parkUntil.get(parkKey(entry)) || 0) > now;
}

/** How long to keep this account out of rotation for a given failure. */
export function parkMsForFailure(e: { code?: QwenRefusalCode; message?: string } | null | undefined): number {
  if (e?.code && PARK_MS[e.code] != null) return PARK_MS[e.code];
  if (isTokenFailure(e?.message || "")) return PARK_MS_GENERIC;
  return 0;
}

function park(entry: PoolEntry, ms: number, code = "account") {
  if (ms <= 0) return;
  const key = parkKey(entry);
  const until = Date.now() + ms;
  const prev = parkUntil.get(key) || 0;
  if (until > prev) parkUntil.set(key, until);
  if (entry.id) void sql(`update qwen_tokens set parked_until=greatest(coalesce(parked_until, to_timestamp(0)), $2), last_failure_code=$3, consecutive_routing_failures=consecutive_routing_failures+1 where id=$1`, [entry.id, new Date(until), code]).catch(() => {});
}

/** Test helper / admin introspection. */
export function _parkStateForTests() {
  return parkUntil;
}

export async function tokenPoolStatus() {
  const rows = await sql<{ total: string; available: string; parked: string }>(`select count(*) filter (where active)::text total, count(*) filter (where active and (parked_until is null or parked_until <= now()))::text available, count(*) filter (where active and parked_until > now())::text parked from qwen_tokens`);
  const db = rows[0] || { total: "0", available: "0", parked: "0" };
  const env = process.env.QWEN_TOKEN;
  const envExpired = env ? isTokenExpired(env) : false;
  return { total: Number(db.total) + (env ? 1 : 0), available: Number(db.available) + (env && !envExpired ? 1 : 0), parked: Number(db.parked), expired: envExpired ? 1 : 0 };
}

async function loadPool(): Promise<PoolEntry[]> {
  if (cache && Date.now() - cache.at < TTL_MS) return cache.entries;

  const entries: PoolEntry[] = [];
  const envToken = process.env.QWEN_TOKEN;
  if (envToken) entries.push({ id: null, token: envToken });

  try {
    const { data } = await admin().from("qwen_tokens").select("id, token").eq("active", true);
    for (const row of data || []) {
      if (row.token) entries.push({ id: row.id, token: row.token });
    }
  } catch {
    /* DB unavailable -> just use env token */
  }

  cache = { entries, at: Date.now() };
  return entries;
}

export function invalidateTokenCache() {
  cache = null;
}

// Resolve a specific pooled account's token by its id ("env" / null = the env
// token). Used to pin a follow-up request (video polling) to the exact account
// that started the task. Returns null if that account is no longer in the pool.
export async function tokenById(id: string | null): Promise<string | null> {
  if (id === "env" || id === null) return process.env.QWEN_TOKEN || null;
  const pool = await loadPool();
  return pool.find((e) => e.id === id)?.token ?? null;
}

// All pooled account tokens (with ids), for the rare case we must scan every
// account to find which one owns a task.
export async function poolTokens(): Promise<PoolEntry[]> {
  return loadPool();
}

function markUsed(entry: PoolEntry) {
  if (!entry.id) return;
  void sql(`update qwen_tokens set last_used_at=now(), parked_until=null, last_failure_code=null, consecutive_routing_failures=0 where id=$1`, [entry.id]).catch(() => {});
}

async function claimDatabaseToken(excluded: string[]): Promise<PoolEntry | null> {
  const ids = excluded.filter((id) => id !== "env");
  const rows = await sql<{ id: string; token: string }>("select * from claim_qwen_token($1::uuid[])", [ids]);
  return rows[0] ? { id: rows[0].id, token: rows[0].token } : null;
}

// Pick a token at random from the active pool, preferring accounts that are
// not currently parked for a recent failure.
export async function pickToken(): Promise<PoolEntry> {
  const pool = await loadPool();
  if (pool.length === 0) throw new Error("No Qwen tokens configured (add one in the admin dashboard or set QWEN_TOKEN).");
  const now = Date.now();
  const free = pool.filter((e) => !isParked(e, now));
  const candidates = free.length ? free : pool;
  const entry = candidates[Math.floor(Math.random() * candidates.length)];
  markUsed(entry);
  return entry;
}

/**
 * When a Qwen session token stops being valid, read from the JWT itself.
 *
 * Qwen tokens are JWTs carrying {id, last_password_change, exp}. Returns null
 * for anything that is not a readable JWT, which means "cannot tell" rather
 * than "expired" — an unreadable token still gets its chance upstream.
 */
export function tokenExpiry(token: string): number | null {
  const parts = (token || "").split(".");
  if (parts.length !== 3) return null;
  try {
    const payload = JSON.parse(Buffer.from(parts[1], "base64url").toString());
    return typeof payload?.exp === "number" ? payload.exp * 1000 : null;
  } catch {
    return null;
  }
}

/** True only when the token demonstrably expired. Unknown is not expired. */
export function isTokenExpired(token: string, now = Date.now()): boolean {
  const exp = tokenExpiry(token);
  return exp !== null && exp <= now;
}

/**
 * Whether an error is the anti-bot challenge.
 *
 * Worth knowing what this does NOT mean. Measured against the live endpoint: a
 * tampered signature, a back-dated exp and the literal string "not-a-token" all
 * come back as HTTP 200 carrying FAIL_SYS_USER_VALIDATE / RGV587. Qwen answers
 * any credential it will not honour with the anti-bot page, so this body is
 * evidence that ONE account was refused — not that the deployment is blocked.
 *
 * Which is why it stays an account-level failure and rolls onto the next
 * account. Reading it as a deployment-wide block turned a few bad sessions into
 * an apparent ban, and would let one dead account stall the entire pool.
 */
export function isChallenge(e: any): boolean {
  return e?.code === "challenge" || /anti-bot challenge/i.test(e?.message || "");
}

// Errors that mean "this account is no good right now" — try a different one.
// (daily quota, rate limiting, expired/invalid token, anti-bot challenge)
export function isTokenFailure(message: string): boolean {
  return /upper limit|upper limit for today|today's usage|usage limit|out of (?:quota|credits)|quota|limit reached|rate ?limit|too many requests|429|unauthorized|session has expired|no longer valid|challenge|Internal error|high demand|overloaded|temporarily unavailable|service unavailable/i.test(
    message || ""
  );
}

// Best-effort error counter so the admin dashboard shows misbehaving accounts.
function noteFailure(entry: PoolEntry) {
  if (!entry.id) return;
  (async () => {
    const { data } = await admin().from("qwen_tokens").select("error_count").eq("id", entry.id!).maybeSingle();
    await admin()
      .from("qwen_tokens")
      .update({ error_count: (data?.error_count ?? 0) + 1 })
      .eq("id", entry.id!);
  })().catch(() => {});
}

/**
 * Drop a dead/banned account out of the active pool so it stops being selected
 * until an admin pastes a fresh cookie. Challenges are NOT deactivated here —
 * those can be egress-IP sticky and would empty the whole pool.
 */
function deactivateAccount(entry: PoolEntry, reason: string) {
  if (!entry.id) return;
  (async () => {
    await admin().from("qwen_tokens").update({ active: false }).eq("id", entry.id!);
    invalidateTokenCache();
    logger.warn("qwen_pool.account_deactivated", { token_entry_id: entry.id, reason });
  })().catch(() => {});
}

function handleAccountFailure(entry: PoolEntry, e: any) {
  const ms = parkMsForFailure(e);
  park(entry, ms, e?.code || "account");
  noteFailure(entry);
  if (e?.code === "expired" || e?.code === "forbidden") {
    deactivateAccount(entry, e?.message || e?.code);
  }
  logger.warn("qwen_pool.failover", {
    token_entry_id: entry.id ?? "env",
    refusal_code: e?.code || "account",
    parked_ms: ms,
    ...publicError(e),
  });
}

/**
 * Run `attempt` against pooled tokens, moving to a different account when one is
 * exhausted / rate-limited / invalid. This is the whole point of the pool: a
 * single burnt-out account must not fail the request.
 */
export async function withTokenFailover<T>(attempt: (token: string) => Promise<T>, maxAttempts = 24): Promise<{ token: string; entryId: string | null; result: T }> {
  const attempted: string[] = [];
  let lastError: unknown = new Error("No Qwen tokens available.");
  for (let index = 0; index < maxAttempts; index++) {
    let entry: PoolEntry | null = null;
    try { entry = await claimDatabaseToken(attempted); } catch (error) { logger.error("qwen_pool.claim_failed", publicError(error)); }
    if (!entry && !attempted.includes("env") && process.env.QWEN_TOKEN) entry = { id: null, token: process.env.QWEN_TOKEN };
    if (!entry) break;
    attempted.push(entry.id ?? "env");
    if (isTokenExpired(entry.token)) { lastError = new Error("Qwen token is expired or no longer valid on this account."); deactivateAccount(entry, "token expired (exp in the past)"); continue; }
    try { const result = await attempt(entry.token); markUsed(entry); return { token: entry.token, entryId: entry.id ?? "env", result }; }
    catch (error: any) { lastError = error; if (!error?.retryable && !isTokenFailure(error?.message || "")) throw error; handleAccountFailure(entry, error); }
  }
  logger.error("qwen_pool.exhausted", { attempts: attempted.length, ...publicError(lastError) });
  throw lastError;
}

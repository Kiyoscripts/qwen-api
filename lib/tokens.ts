// Qwen token pool with rotation. Picks a token per request, spreading load across
// all active accounts so no single one gets rate-limited or flagged. Falls back to
// the QWEN_TOKEN env var (which is always included in the pool if set).

import { admin } from "./supabase";
import type { QwenRefusalCode } from "./qwen";

interface PoolEntry {
  id: string | null; // null = the env token
  token: string;
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

function park(entry: PoolEntry, ms: number) {
  if (ms <= 0) return;
  const key = parkKey(entry);
  const until = Date.now() + ms;
  // Keep the longer of any existing park window (don't shorten a 24h ban with a 60s one).
  const prev = parkUntil.get(key) || 0;
  if (until > prev) parkUntil.set(key, until);
}

/** Test helper / admin introspection. */
export function _parkStateForTests() {
  return parkUntil;
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
  admin().from("qwen_tokens").update({ last_used_at: new Date().toISOString() }).eq("id", entry.id).then(() => {}, () => {});
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
 * When the anti-bot challenge is in force, and for how long after.
 *
 * A challenge is not an account failure. Measured: createChat succeeds on the
 * same token and egress IP that then gets FAIL_SYS_USER_VALIDATE / RGV587 on
 * completions, and swapping accounts does not clear it — the WAF keys on the
 * caller, not the credential.
 *
 * That matters because the failover loop treated it like a spent account and
 * walked the pool, so ONE challenge fired up to maxAttempts full requests into
 * a WAF that was already saying "slow down" — and a bigger pool made it worse,
 * not better. Upstream asks for a retry later, so wait: park the pool globally
 * and fail fast until the window passes.
 */
let challengedUntil = 0;
const CHALLENGE_COOLDOWN_MS = Number(process.env.QWEN_CHALLENGE_COOLDOWN_MS || 90_000);

/** True when a challenge was seen recently enough that retrying is pointless. */
export function challengeActive(now = Date.now()): boolean {
  return now < challengedUntil;
}

/** Seconds until the pool is worth using again. */
export function challengeCooldownRemaining(now = Date.now()): number {
  return Math.max(0, Math.ceil((challengedUntil - now) / 1000));
}

export function noteChallenge(now = Date.now()) {
  challengedUntil = now + CHALLENGE_COOLDOWN_MS;
}

/** Test seam. */
export function resetChallengeCooldown() {
  challengedUntil = 0;
}

/** Whether an error is the anti-bot challenge rather than a bad account. */
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
    console.warn(`[pool] deactivated account ${entry.id}: ${reason}`);
  })().catch(() => {});
}

function handleAccountFailure(entry: PoolEntry, e: any) {
  const ms = parkMsForFailure(e);
  park(entry, ms);
  noteFailure(entry);
  if (e?.code === "expired" || e?.code === "forbidden") {
    deactivateAccount(entry, e?.message || e?.code);
  }
  if (ms > 0) {
    console.warn(
      `[pool] account ${entry.id ?? "env"} failed over (${e?.code || "account"}): ${e?.message || e}` +
        ` — parked ${Math.round(ms / 1000)}s`
    );
  } else {
    console.warn(`[pool] account ${entry.id ?? "env"} failed over: ${e?.message || e}`);
  }
}

/**
 * Run `attempt` against pooled tokens, moving to a different account when one is
 * exhausted / rate-limited / invalid. This is the whole point of the pool: a
 * single burnt-out account must not fail the request.
 */
export async function withTokenFailover<T>(
  attempt: (token: string) => Promise<T>,
  // An exhausted account rejects immediately without generating anything, so
  // trying many is cheap. Cap high enough that a pool of challenged accounts
  // still gets a fair scan of the healthy ones.
  maxAttempts = 24
): Promise<{ token: string; entryId: string | null; result: T }> {
  const pool = await loadPool();
  if (pool.length === 0) throw new Error("No Qwen tokens configured (add one in the admin dashboard or set QWEN_TOKEN).");

  const now = Date.now();

  // Still inside a challenge window: every account would meet the same wall, so
  // say so now instead of spending the pool to rediscover it.
  if (challengeActive(now)) {
    const err: any = new Error(
      `Qwen is serving an anti-bot challenge to this deployment. Waiting ${challengeCooldownRemaining(now)}s before retrying — this is not an account problem, so switching accounts will not help.`
    );
    err.status = 503;
    throw err;
  }

  const free = pool.filter((e) => !isParked(e, now));
  // Prefer unparked accounts; if everything is parked, try the full pool anyway
  // rather than hard-fail before any network call.
  const preferred = free.length ? free : pool;
  const shuffled = [...preferred].sort(() => Math.random() - 0.5).slice(0, Math.min(maxAttempts, preferred.length));
  let lastError: unknown = new Error("No Qwen tokens available.");

  for (const entry of shuffled) {
    try {
      const result = await attempt(entry.token);
      markUsed(entry);
      // entryId lets callers pin a follow-up request to this exact account.
      return { token: entry.token, entryId: entry.id ?? "env", result };
    } catch (e: any) {
      lastError = e;
      // `retryable` covers account failures whose wording isn't quota-shaped —
      // e.g. an account that streams a completion but generates no text.
      if (!e?.retryable && !isTokenFailure(e?.message || "")) throw e; // a real error, not a bad account

      // A challenge is about the caller, not the credential. Stop immediately:
      // walking the pool would issue another full request per account into a WAF
      // that is already punishing, which is what deepens and extends the block.
      if (isChallenge(e)) {
        noteChallenge();
        console.warn(`[pool] anti-bot challenge — pausing all accounts for ${challengeCooldownRemaining()}s`);
        throw e;
      }

      handleAccountFailure(entry, e);
    }
  }
  // Every candidate refused. That is the state worth shouting about: it means
  // the pool is exhausted, blocked, or upstream is down for everyone — not one
  // unlucky account.
  console.error(
    `[pool] all ${shuffled.length} attempted accounts failed (pool size ${pool.length}, free ${free.length}). Last: ${
      (lastError as any)?.message || lastError
    }`
  );
  throw lastError;
}

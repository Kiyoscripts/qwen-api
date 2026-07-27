// Qwen token pool with rotation. Picks a token per request, spreading load across
// all active accounts so no single one gets rate-limited or flagged. Falls back to
// the QWEN_TOKEN env var (which is always included in the pool if set).

import { admin } from "./supabase";

interface PoolEntry {
  id: string | null; // null = the env token
  token: string;
}

let cache: { entries: PoolEntry[]; at: number } | null = null;
const TTL_MS = 30_000;

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

// Pick a token at random from the active pool.
export async function pickToken(): Promise<PoolEntry> {
  const pool = await loadPool();
  if (pool.length === 0) throw new Error("No Qwen tokens configured (add one in the admin dashboard or set QWEN_TOKEN).");
  const entry = pool[Math.floor(Math.random() * pool.length)];
  markUsed(entry);
  return entry;
}

// Errors that mean "this account is no good right now" — try a different one.
// (daily quota, rate limiting, expired/invalid token, anti-bot challenge)
export function isTokenFailure(message: string): boolean {
  return /upper limit|upper limit for today|today's usage|usage limit|out of (?:quota|credits)|quota|limit reached|rate ?limit|too many requests|429|unauthorized|session has expired|no longer valid|challenge|Internal error/i.test(
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
 * Run `attempt` against pooled tokens, moving to a different account when one is
 * exhausted / rate-limited / invalid. This is the whole point of the pool: a
 * single burnt-out account must not fail the request.
 */
export async function withTokenFailover<T>(
  attempt: (token: string) => Promise<T>,
  // An exhausted account rejects immediately without generating anything, so
  // trying several is cheap. Worth a higher ceiling when many are used up.
  maxAttempts = 8
): Promise<{ token: string; entryId: string | null; result: T }> {
  const pool = await loadPool();
  if (pool.length === 0) throw new Error("No Qwen tokens configured (add one in the admin dashboard or set QWEN_TOKEN).");

  // Shuffle so load spreads evenly, then take a few distinct candidates.
  const shuffled = [...pool].sort(() => Math.random() - 0.5).slice(0, Math.min(maxAttempts, pool.length));
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
      // Without this the pool rotates in silence, so a day where every account
      // starts failing looks identical in the logs to a day where none do.
      console.warn(`[pool] account ${entry.id ?? "env"} failed over: ${e?.message || e}`);
      noteFailure(entry);
    }
  }
  // Every candidate refused. That is the state worth shouting about: it means
  // the pool is exhausted, blocked, or upstream is down for everyone — not one
  // unlucky account.
  console.error(
    `[pool] all ${shuffled.length} attempted accounts failed (pool size ${pool.length}). Last: ${
      (lastError as any)?.message || lastError
    }`
  );
  throw lastError;
}

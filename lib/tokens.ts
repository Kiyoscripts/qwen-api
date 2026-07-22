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
): Promise<{ token: string; result: T }> {
  const pool = await loadPool();
  if (pool.length === 0) throw new Error("No Qwen tokens configured (add one in the admin dashboard or set QWEN_TOKEN).");

  // Shuffle so load spreads evenly, then take a few distinct candidates.
  const shuffled = [...pool].sort(() => Math.random() - 0.5).slice(0, Math.min(maxAttempts, pool.length));
  let lastError: unknown = new Error("No Qwen tokens available.");

  for (const entry of shuffled) {
    try {
      const result = await attempt(entry.token);
      markUsed(entry);
      return { token: entry.token, result };
    } catch (e: any) {
      lastError = e;
      if (!isTokenFailure(e?.message || "")) throw e; // a real error, not a bad account
      noteFailure(entry);
    }
  }
  throw lastError;
}

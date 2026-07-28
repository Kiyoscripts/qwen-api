// OneCompiler token pool with rotation.
//
// A SEPARATE pool from lib/tokens.ts, on purpose. The two look alike but differ
// in the ways that matter:
//
//   * Different credential. Qwen pools a chat.qwen.ai session token; this pools a
//     signed-in OneCompiler bearer JWT. Mixing them in one table would let a
//     request pick a credential the upstream cannot possibly accept.
//   * Different exhaustion. A Qwen account gets rate-limited and recovers within
//     the hour; a OneCompiler Free account hits a hard DAILY cap and is then
//     useless until it resets. So a failed account here is worth skipping for
//     much longer, and "every account failed" is a routine end-of-day state
//     rather than an emergency.
//   * Different lifecycle. Each pool is managed on its own admin screen and each
//     has its own env fallback.
//
// Keeping them apart costs a little duplication and buys the guarantee that
// neither pool can ever serve the other's traffic.

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
  const envToken = process.env.ONECOMPILER_TOKEN;
  if (envToken) entries.push({ id: null, token: envToken });

  try {
    const { data } = await admin().from("onecompiler_tokens").select("id, token").eq("active", true);
    for (const row of data || []) {
      if (row.token) entries.push({ id: row.id, token: row.token });
    }
  } catch {
    /* DB unavailable -> just use the env token */
  }

  cache = { entries, at: Date.now() };
  return entries;
}

export function invalidateOneCompilerTokenCache() {
  cache = null;
}

/** How many accounts are currently available (env token included). */
export async function oneCompilerPoolSize(): Promise<number> {
  return (await loadPool()).length;
}

function markUsed(entry: PoolEntry) {
  if (!entry.id) return;
  admin()
    .from("onecompiler_tokens")
    .update({ last_used_at: new Date().toISOString() })
    .eq("id", entry.id)
    .then(() => {}, () => {});
}

function noteFailure(entry: PoolEntry) {
  if (!entry.id) return;
  (async () => {
    const { data } = await admin().from("onecompiler_tokens").select("error_count").eq("id", entry.id!).maybeSingle();
    await admin()
      .from("onecompiler_tokens")
      .update({ error_count: (data?.error_count ?? 0) + 1 })
      .eq("id", entry.id!);
  })().catch(() => {});
}

/**
 * Errors that mean "this account is spent — try another one".
 *
 * Deliberately narrower than the Qwen equivalent, and matched against wording
 * observed from this upstream rather than borrowed: the daily-cap sentence and
 * the signed-out sentence. Both are terminal for the account but not for the
 * request, which is exactly what failover is for.
 *
 * An over-broad pattern here is expensive: it would burn every account in the
 * pool retrying an error that was never about the account.
 */
export function isOneCompilerTokenFailure(message: string, status?: number): boolean {
  if (status === 401 || status === 402 || status === 429) return true;
  return /daily limit|reached the daily|upgrade to a paid plan|please log ?in|unauthori[sz]ed|quota/i.test(message || "");
}

/**
 * Run `attempt` against pooled accounts, moving on when one is spent.
 *
 * `maxAttempts` is generous because a capped account rejects immediately without
 * generating anything, so a miss costs one round-trip and nothing else.
 */
export async function withOneCompilerFailover<T>(
  attempt: (token: string) => Promise<T>,
  maxAttempts = 8
): Promise<{ token: string; entryId: string | null; result: T }> {
  const pool = await loadPool();
  if (pool.length === 0) {
    throw new Error(
      "No OneCompiler tokens configured (add one in the admin dashboard or set ONECOMPILER_TOKEN)."
    );
  }

  // Shuffle so load spreads evenly, then take a few distinct candidates.
  const shuffled = [...pool].sort(() => Math.random() - 0.5).slice(0, Math.min(maxAttempts, pool.length));
  let lastError: unknown = new Error("No OneCompiler tokens available.");

  for (const entry of shuffled) {
    try {
      const result = await attempt(entry.token);
      markUsed(entry);
      return { token: entry.token, entryId: entry.id ?? "env", result };
    } catch (e: any) {
      lastError = e;
      if (!isOneCompilerTokenFailure(e?.message || "", e?.status)) throw e; // a real error, not a spent account
      // Without this the pool rotates in silence, so a day where every account
      // is capped looks identical in the logs to a day where none are.
      console.warn(`[onecompiler-pool] account ${entry.id ?? "env"} failed over: ${e?.message || e}`);
      noteFailure(entry);
    }
  }

  // Every candidate refused. With a daily cap this is an expected end-of-day
  // state, so it is worth stating plainly rather than as a generic upstream error.
  console.error(
    `[onecompiler-pool] all ${shuffled.length} attempted accounts are spent (pool size ${pool.length}). Last: ${
      (lastError as any)?.message || lastError
    }`
  );
  throw lastError;
}

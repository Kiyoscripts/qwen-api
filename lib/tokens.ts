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

// Pick a token at random from the active pool.
export async function pickToken(): Promise<PoolEntry> {
  const pool = await loadPool();
  if (pool.length === 0) throw new Error("No Qwen tokens configured (add one in the admin dashboard or set QWEN_TOKEN).");
  const entry = pool[Math.floor(Math.random() * pool.length)];
  if (entry.id) {
    admin().from("qwen_tokens").update({ last_used_at: new Date().toISOString() }).eq("id", entry.id).then(() => {}, () => {});
  }
  return entry;
}

import { NextResponse } from "next/server";
import { admin, cleanupUnlinkedKeys } from "@/lib/supabase";
import { getModels } from "@/lib/qwen";
import { withTokenFailover } from "@/lib/tokens";
import { VIRTUAL_MODELS } from "@/lib/media";
import { CUSTOM_MODELS } from "@/lib/customModels";

export const runtime = "nodejs";

// Public landing-page stats. Cached briefly so the auto-refreshing counter on the
// homepage is cheap even under load.
//   { poolAccounts, apiKeys, activeKeys24h, models }
// (A `users` counter gets added here once the account system ships.)
let cache: { at: number; data: Record<string, number> } | null = null;
const TTL_MS = 15_000;

export async function GET() {
  if (cache && Date.now() - cache.at < TTL_MS) {
    return NextResponse.json(cache.data, { headers: { "Cache-Control": "public, max-age=15" } });
  }

  // Opportunistic cleanup of expired anonymous keys (cheap; runs at most ~4x/min
  // thanks to the cache), so unlinked keys get deleted even without the cron.
  void cleanupUnlinkedKeys();

  const db = admin();
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

  const [pool, keys, recent, qwenModels] = await Promise.all([
    db.from("qwen_tokens").select("id", { count: "exact", head: true }).eq("active", true),
    db.from("api_keys").select("id", { count: "exact", head: true }),
    // Distinct keys active in the last 24h — dedupe client-side (cheap with the cache).
    db.from("usage_logs").select("api_key_id").gte("created_at", since).limit(20000),
    withTokenFailover((t) => getModels(t)).then((r) => r.result.length).catch(() => 0),
  ]);

  const activeKeys24h = new Set((recent.data || []).map((r: any) => r.api_key_id).filter(Boolean)).size;
  const models = (qwenModels || 0) + VIRTUAL_MODELS.length + CUSTOM_MODELS.length;

  const data = {
    poolAccounts: pool.count || 0,
    apiKeys: keys.count || 0,
    activeKeys24h,
    models,
  };
  cache = { at: Date.now(), data };
  return NextResponse.json(data, { headers: { "Cache-Control": "public, max-age=15" } });
}

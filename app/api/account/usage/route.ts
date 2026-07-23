import { NextRequest, NextResponse } from "next/server";
import { currentUser } from "@/lib/auth";
import { listUserKeys, admin } from "@/lib/supabase";

export const runtime = "nodejs";

const WINDOW_DAYS = 30;

// Usage analytics for the signed-in user's keys over the last 30 days:
//   { window, total, errors, series:[{date,count}], byModel:[{model,count}],
//     perKey:[{name,prefix,count}] }
export async function GET(req: NextRequest) {
  const user = await currentUser(req);
  if (!user) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  const keys = await listUserKeys(user.id);
  const idToKey = new Map(keys.map((k) => [k.id, k]));
  const empty = { window: WINDOW_DAYS, total: 0, errors: 0, series: dayScaffold(), byModel: [], perKey: [] };
  if (keys.length === 0) return NextResponse.json(empty);

  const since = new Date(Date.now() - WINDOW_DAYS * 86400_000);
  const { data } = await admin()
    .from("usage_logs")
    .select("api_key_id, created_at, model, status")
    .in("api_key_id", keys.map((k) => k.id))
    .gte("created_at", since.toISOString())
    .limit(100000);

  const rows = data || [];
  const byModel = new Map<string, number>();
  const perKey = new Map<string, number>();
  const byDay = new Map<string, number>();
  let errors = 0;

  for (const r of rows as any[]) {
    const model = r.model || "unknown";
    byModel.set(model, (byModel.get(model) || 0) + 1);
    perKey.set(r.api_key_id, (perKey.get(r.api_key_id) || 0) + 1);
    const day = new Date(r.created_at).toISOString().slice(0, 10);
    byDay.set(day, (byDay.get(day) || 0) + 1);
    if (typeof r.status === "number" && r.status >= 400) errors++;
  }

  const series = dayScaffold().map((d) => ({ date: d.date, count: byDay.get(d.date) || 0 }));

  return NextResponse.json({
    window: WINDOW_DAYS,
    total: rows.length,
    errors,
    series,
    byModel: [...byModel.entries()].map(([model, count]) => ({ model, count })).sort((a, b) => b.count - a.count),
    perKey: [...perKey.entries()]
      .map(([id, count]) => ({ name: idToKey.get(id)?.name || "Untitled", prefix: idToKey.get(id)?.key_prefix || "", count }))
      .sort((a, b) => b.count - a.count),
  });
}

// A [{date}] array for each of the last WINDOW_DAYS days (oldest -> newest).
function dayScaffold(): { date: string; count: number }[] {
  const out: { date: string; count: number }[] = [];
  for (let i = WINDOW_DAYS - 1; i >= 0; i--) {
    out.push({ date: new Date(Date.now() - i * 86400_000).toISOString().slice(0, 10), count: 0 });
  }
  return out;
}

import { NextRequest, NextResponse } from "next/server";
import { currentUser } from "@/lib/auth";
import { sql } from "@/lib/postgres";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const user = await currentUser(req);
  if (!user) return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  const search = req.nextUrl.searchParams;
  const days = Math.min(365, Math.max(1, Number(search.get("days") || 30)));
  const key = search.get("key") || null;
  if (key && !(await sql(`select 1 from api_keys where id=$1 and user_id=$2`, [key, user.id])).length) return NextResponse.json({ error: "API key not found." }, { status: 404 });

  const params = [user.id, days, key];
  const usageWindow = `k.user_id=$1 and l.created_at >= now()-make_interval(days => $2::int) and ($3::uuid is null or l.api_key_id=$3::uuid)`;
  try {
    const [summary, series, models, keyStats, keys] = await Promise.all([
      sql<any>(`select count(*)::int total,count(*) filter(where l.status<400)::int success,count(*) filter(where l.status>=400)::int errors,coalesce(avg(l.latency_ms),0)::int average,coalesce(percentile_cont(.5) within group(order by l.latency_ms) filter(where l.latency_ms is not null),0)::int p50,coalesce(percentile_cont(.95) within group(order by l.latency_ms) filter(where l.latency_ms is not null),0)::int p95,coalesce(percentile_cont(.99) within group(order by l.latency_ms) filter(where l.latency_ms is not null),0)::int p99 from usage_logs l join api_keys k on k.id=l.api_key_id where ${usageWindow}`, params),
      sql<any>(`select l.created_at::date date,count(*)::int count,count(*) filter(where l.status>=400)::int errors from usage_logs l join api_keys k on k.id=l.api_key_id where ${usageWindow} group by 1 order by 1`, params),
      sql<any>(`select coalesce(l.model,'unknown') model,count(*)::int count,count(*) filter(where l.status>=400)::int errors,coalesce(avg(l.latency_ms),0)::int average_latency_ms from usage_logs l join api_keys k on k.id=l.api_key_id where ${usageWindow} group by 1 order by count desc limit 50`, params),
      sql<any>(`select k.id,k.name,k.key_prefix,k.request_count,k.request_limit,k.revoked,k.expires_at,count(l.id) filter(where l.created_at>=now()-make_interval(days => $2::int))::int window_count,count(l.id) filter(where l.created_at>=now()-make_interval(days => $2::int) and l.status>=400)::int errors from api_keys k left join usage_logs l on l.api_key_id=k.id where k.user_id=$1 and ($3::uuid is null or k.id=$3::uuid) group by k.id order by k.request_count desc`, params),
      sql<any>(`select id,name,key_prefix,request_count,request_limit,revoked,expires_at from api_keys where user_id=$1 order by created_at desc`, [user.id]),
    ]);
    const row = summary[0] || { total: 0, success: 0, errors: 0, average: 0, p50: 0, p95: 0, p99: 0 };
    const authenticatedRequests = keyStats.reduce((sum, item) => sum + Number(item.request_count || 0), 0);
    return NextResponse.json({ window: days, filterKey: key, authenticatedRequests, total: row.total, success: row.success, errors: row.errors, errorRate: row.total ? row.errors / row.total : 0, latency: { average: row.average, p50: row.p50, p95: row.p95, p99: row.p99 }, series, byModel: models, perKey: keyStats, keys });
  } catch (error) {
    console.error(JSON.stringify({ event: "account_usage_failed", user_id: user.id, error: error instanceof Error ? error.message : "unknown" }));
    return NextResponse.json({ error: "Usage analytics are temporarily unavailable." }, { status: 500 });
  }
}

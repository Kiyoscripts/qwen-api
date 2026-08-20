import { NextRequest, NextResponse } from "next/server";
import { addQwenToken, addQwenTokens, listQwenTokens, setQwenTokenActive, deleteQwenToken } from "@/lib/supabase";
import { invalidateTokenCache } from "@/lib/tokens";
import { audit, requireAdmin } from "@/lib/auth";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const auth = await requireAdmin(req);
  if (auth.response) return auth.response;
  try {
    const tokens = await listQwenTokens();
    const now = Date.now();
    const state = (t: any) => !t.active ? "disabled" : t.expires_at && Date.parse(t.expires_at) <= now ? "expired" : t.parked_until && Date.parse(t.parked_until) > now ? (/challenge/i.test(`${t.last_failure_code || ""} ${t.last_error || ""}`) ? "challenged" : /429|rate/i.test(`${t.last_failure_code || ""} ${t.last_error || ""}`) ? "rate_limited" : "parked") : t.consecutive_failures > 0 ? "degraded" : t.last_health_at ? "healthy" : "unknown";
    const enriched = tokens.map((t: any) => ({ ...t, state: state(t) }));
    const counts = Object.fromEntries(["healthy", "degraded", "parked", "rate_limited", "challenged", "expired", "disabled", "unknown"].map(s => [s, enriched.filter((t: any) => t.state === s).length]));
    return NextResponse.json({ tokens: enriched, capacity: { total: enriched.length, usable: enriched.filter((t: any) => t.active && !["expired", "parked", "rate_limited", "challenged"].includes(t.state)).length, ...counts } });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const auth = await requireAdmin(req);
  if (auth.response) return auth.response;
  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }

  // Bulk: body.tokens is a newline-separated string (or array), one token per line.
  if (body?.tokens !== undefined) {
    const raw: string[] = Array.isArray(body.tokens) ? body.tokens : String(body.tokens).split(/\r?\n/);
    const seen = new Set<string>();
    const rows = raw
      .map((t) => (typeof t === "string" ? t.trim() : ""))
      .filter((t) => t && !seen.has(t) && seen.add(t))
      .map((t) => ({ label: (typeof body.label === "string" && body.label) || null, token: t }));
    if (rows.length === 0) return NextResponse.json({ error: "no tokens found" }, { status: 400 });
    try {
      const added = await addQwenTokens(rows);
      invalidateTokenCache();
      await audit(auth.user.id, "qwen_tokens.add_bulk", "qwen_token", null, { count: added });
      return NextResponse.json({ added });
    } catch (e: any) {
      return NextResponse.json({ error: e.message }, { status: 500 });
    }
  }

  const token = typeof body?.token === "string" ? body.token.trim() : "";
  const label = typeof body?.label === "string" ? body.label : null;
  if (!token) return NextResponse.json({ error: "token is required" }, { status: 400 });
  try {
    const created = await addQwenToken(label, token);
    invalidateTokenCache();
    await audit(auth.user.id, "qwen_token.add", "qwen_token", created.id, { label });
    return NextResponse.json({ token: created });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest) {
  const auth = await requireAdmin(req);
  if (auth.response) return auth.response;
  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }
  if (!body?.id || typeof body.active !== "boolean") return NextResponse.json({ error: "id and active required" }, { status: 400 });
  try {
    await setQwenTokenActive(body.id, body.active);
    invalidateTokenCache();
    await audit(auth.user.id, "qwen_token.update", "qwen_token", String(body.id), { active: body.active });
    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  const auth = await requireAdmin(req);
  if (auth.response) return auth.response;
  const id = req.nextUrl.searchParams.get("id");
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });
  try {
    await deleteQwenToken(id);
    invalidateTokenCache();
    await audit(auth.user.id, "qwen_token.delete", "qwen_token", id);
    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}

import { NextRequest, NextResponse } from "next/server";
import { addQwenToken, addQwenTokens, listQwenTokens, setQwenTokenActive, deleteQwenToken } from "@/lib/supabase";
import { invalidateTokenCache } from "@/lib/tokens";

export const runtime = "nodejs";

function authorized(req: NextRequest): boolean {
  const secret = process.env.ADMIN_SECRET;
  return Boolean(secret) && (req.headers.get("x-admin-secret") || "") === secret;
}

export async function GET(req: NextRequest) {
  if (!authorized(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  try {
    return NextResponse.json({ tokens: await listQwenTokens() });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  if (!authorized(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
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
    return NextResponse.json({ token: created });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest) {
  if (!authorized(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
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
    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  if (!authorized(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const id = req.nextUrl.searchParams.get("id");
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });
  try {
    await deleteQwenToken(id);
    invalidateTokenCache();
    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}

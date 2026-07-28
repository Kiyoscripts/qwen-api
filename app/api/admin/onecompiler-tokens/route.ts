// Admin CRUD for the OneCompiler account pool.
//
// A separate route from /api/admin/tokens (which owns the Qwen pool) rather than
// one endpoint with a `provider` parameter: the two pools hold different
// credential types, and a mistyped parameter on a shared endpoint would file a
// token into the wrong pool, where it can only ever fail.

import { NextRequest, NextResponse } from "next/server";
import {
  addOneCompilerToken,
  addOneCompilerTokens,
  listOneCompilerTokens,
  setOneCompilerTokenActive,
  deleteOneCompilerToken,
} from "@/lib/supabase";
import { invalidateOneCompilerTokenCache } from "@/lib/onecompilerTokens";
import { requireAdmin } from "@/lib/auth";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const auth = await requireAdmin(req);
  if (auth.response) return auth.response;
  try {
    return NextResponse.json({ tokens: await listOneCompilerTokens() });
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
      // Tolerate a pasted "Bearer <jwt>" — that is exactly how the value appears
      // in DevTools, so stripping it here saves a confusing round of 401s.
      .map((t) => t.replace(/^Bearer\s+/i, ""))
      .filter((t) => t && !seen.has(t) && seen.add(t))
      .map((t) => ({ label: (typeof body.label === "string" && body.label) || null, token: t }));
    if (rows.length === 0) return NextResponse.json({ error: "no tokens found" }, { status: 400 });
    try {
      const added = await addOneCompilerTokens(rows);
      invalidateOneCompilerTokenCache();
      return NextResponse.json({ added });
    } catch (e: any) {
      return NextResponse.json({ error: e.message }, { status: 500 });
    }
  }

  const token = typeof body?.token === "string" ? body.token.trim().replace(/^Bearer\s+/i, "") : "";
  const label = typeof body?.label === "string" ? body.label : null;
  if (!token) return NextResponse.json({ error: "token is required" }, { status: 400 });
  try {
    const created = await addOneCompilerToken(label, token);
    invalidateOneCompilerTokenCache();
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
  if (!body?.id || typeof body.active !== "boolean") {
    return NextResponse.json({ error: "id and active required" }, { status: 400 });
  }
  try {
    await setOneCompilerTokenActive(body.id, body.active);
    invalidateOneCompilerTokenCache();
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
    await deleteOneCompilerToken(id);
    invalidateOneCompilerTokenCache();
    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}

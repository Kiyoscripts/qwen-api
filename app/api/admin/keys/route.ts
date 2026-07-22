import { NextRequest, NextResponse } from "next/server";
import { createApiKey, listApiKeys, deleteApiKey, purgeKeysByPrefix, deleteAllApiKeys } from "@/lib/supabase";

export const runtime = "nodejs";

function authorized(req: NextRequest): boolean {
  const secret = process.env.ADMIN_SECRET;
  if (!secret) return false;
  const provided = req.headers.get("x-admin-secret") || "";
  return provided === secret;
}

// Create a new API key. Returns the raw key ONCE — store it, it can't be shown again.
export async function POST(req: NextRequest) {
  if (!authorized(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  let name: string | null = null;
  try {
    const body = await req.json();
    name = typeof body?.name === "string" ? body.name : null;
  } catch {
    /* name optional */
  }
  try {
    const created = await createApiKey(name);
    return NextResponse.json({
      id: created.id,
      name,
      key: created.key,
      note: "Save this key now — it is not stored in plaintext and cannot be retrieved again.",
    });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}

// List keys (metadata only, never the raw key).
export async function GET(req: NextRequest) {
  if (!authorized(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  try {
    return NextResponse.json({ keys: await listApiKeys() });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}

// Delete keys:
//   ?id=<uuid>          -> delete one
//   ?spam=<prefix>      -> delete unused keys whose name starts with <prefix> (default "batch-")
//   ?all=true           -> delete ALL keys
export async function DELETE(req: NextRequest) {
  if (!authorized(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const p = req.nextUrl.searchParams;
  try {
    if (p.get("all") === "true") {
      return NextResponse.json({ deleted: await deleteAllApiKeys() });
    }
    if (p.has("spam")) {
      const prefix = p.get("spam") || "batch-";
      return NextResponse.json({ deleted: await purgeKeysByPrefix(prefix) });
    }
    const id = p.get("id");
    if (id) {
      await deleteApiKey(id);
      return NextResponse.json({ ok: true });
    }
    return NextResponse.json({ error: "specify id, spam, or all" }, { status: 400 });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}

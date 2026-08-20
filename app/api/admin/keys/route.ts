import { NextRequest, NextResponse } from "next/server";
import { createApiKey, listApiKeys, deleteApiKey, purgeKeysByPrefix, deleteAllApiKeys } from "@/lib/supabase";

import { audit, requireAdmin } from "@/lib/auth";

export const runtime = "nodejs";

// Create a new API key. Returns the raw key ONCE — store it, it can't be shown again.
export async function POST(req: NextRequest) {
  const auth = await requireAdmin(req);
  if (auth.response) return auth.response;
  let name: string | null = null;
  try {
    const body = await req.json();
    name = typeof body?.name === "string" ? body.name : null;
  } catch {
    /* name optional */
  }
  try {
    const created = await createApiKey(name);
    await audit(auth.user.id, "api_key.create", "api_key", created.id, { name });
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
  const auth = await requireAdmin(req);
  if (auth.response) return auth.response;
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
  const auth = await requireAdmin(req);
  if (auth.response) return auth.response;
  const p = req.nextUrl.searchParams;
  try {
    if (p.get("all") === "true") {
      const deleted = await deleteAllApiKeys(); await audit(auth.user.id, "api_keys.delete_all", "api_key", null, { deleted }); return NextResponse.json({ deleted });
    }
    if (p.has("spam")) {
      const prefix = p.get("spam") || "batch-";
      const deleted = await purgeKeysByPrefix(prefix); await audit(auth.user.id, "api_keys.purge", "api_key", null, { prefix, deleted }); return NextResponse.json({ deleted });
    }
    const id = p.get("id");
    if (id) {
      await deleteApiKey(id);
      await audit(auth.user.id, "api_key.delete", "api_key", id);
      return NextResponse.json({ ok: true });
    }
    return NextResponse.json({ error: "specify id, spam, or all" }, { status: 400 });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}

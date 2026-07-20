import { NextRequest, NextResponse } from "next/server";
import { createApiKey, listApiKeys } from "@/lib/supabase";

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

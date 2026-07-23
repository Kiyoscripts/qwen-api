import { NextRequest, NextResponse } from "next/server";
import { currentUser } from "@/lib/auth";
import { listUserKeys, createApiKey } from "@/lib/supabase";

export const runtime = "nodejs";

// GET  -> the signed-in user's keys.
export async function GET(req: NextRequest) {
  const user = await currentUser(req);
  if (!user) return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  return NextResponse.json({ keys: await listUserKeys(user.id) });
}

// POST { name? } -> create a new key attached to the account (shown once).
export async function POST(req: NextRequest) {
  const user = await currentUser(req);
  if (!user) return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  let body: any = {};
  try { body = await req.json(); } catch { /* name optional */ }
  const name = typeof body.name === "string" && body.name.trim() ? body.name.trim().slice(0, 80) : null;
  try {
    const { id, key, key_prefix } = await createApiKey(name, null, user.id);
    return NextResponse.json({ id, key, key_prefix });
  } catch {
    return NextResponse.json({ error: "Could not create the key." }, { status: 500 });
  }
}

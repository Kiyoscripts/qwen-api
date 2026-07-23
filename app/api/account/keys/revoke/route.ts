import { NextRequest, NextResponse } from "next/server";
import { currentUser } from "@/lib/auth";
import { revokeUserKey } from "@/lib/supabase";

export const runtime = "nodejs";

// POST { id } -> revoke one of the signed-in user's keys.
export async function POST(req: NextRequest) {
  const user = await currentUser(req);
  if (!user) return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  let body: any;
  try { body = await req.json(); } catch { return NextResponse.json({ error: "Invalid JSON." }, { status: 400 }); }
  const id = String(body.id || "");
  if (!id) return NextResponse.json({ error: "id is required." }, { status: 400 });
  const ok = await revokeUserKey(user.id, id);
  return ok ? NextResponse.json({ ok: true }) : NextResponse.json({ error: "Could not revoke." }, { status: 400 });
}

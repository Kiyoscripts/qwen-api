import { NextRequest, NextResponse } from "next/server";
import { createHash, randomBytes } from "node:crypto";
import { admin } from "@/lib/supabase";
import { audit, requireAdmin } from "@/lib/auth";

export async function GET(req: NextRequest) {
  const auth = await requireAdmin(req); if (auth.response) return auth.response;
  const { data, error } = await admin().from("invites").select("id, code_prefix, created_at, expires_at, used_at, used_by, revoked").order("created_at", { ascending: false }).limit(500);
  return error ? NextResponse.json({ error: error.message }, { status: 500 }) : NextResponse.json({ invites: data || [] });
}
export async function POST(req: NextRequest) {
  const auth = await requireAdmin(req); if (auth.response) return auth.response;
  const body = await req.json().catch(() => ({})); const code = "syde_inv_" + randomBytes(18).toString("base64url");
  const code_hash = createHash("sha256").update(code).digest("hex");
  const expires_at = body.days ? new Date(Date.now() + Math.min(365, Math.max(1, Number(body.days))) * 86400000).toISOString() : null;
  const { data, error } = await admin().from("invites").insert({ code_hash, code_prefix: code.slice(0, 14) + "...", created_by: auth.user.id, expires_at }).select("id, code_prefix, created_at, expires_at, used_at, revoked").single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 }); await audit(auth.user.id, "invite.create", "invite", data.id, { expires_at });
  return NextResponse.json({ invite: data, code });
}
export async function DELETE(req: NextRequest) {
  const auth = await requireAdmin(req); if (auth.response) return auth.response;
  const id = req.nextUrl.searchParams.get("id"); if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });
  const { error } = await admin().from("invites").update({ revoked: true }).eq("id", id); if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  await audit(auth.user.id, "invite.revoke", "invite", id); return NextResponse.json({ ok: true });
}

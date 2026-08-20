import { NextRequest, NextResponse } from "next/server";
import { listBlacklist, blacklistIp, unblacklistIp, deleteKeysByIp } from "@/lib/supabase";

import { audit, requireAdmin } from "@/lib/auth";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const auth = await requireAdmin(req);
  if (auth.response) return auth.response;
  try {
    return NextResponse.json({ blacklist: await listBlacklist() });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}

// Manually blacklist an IP (and delete its keys).
export async function POST(req: NextRequest) {
  const auth = await requireAdmin(req);
  if (auth.response) return auth.response;
  let ip = "";
  try {
    ip = String((await req.json())?.ip || "").trim();
  } catch {}
  if (!ip) return NextResponse.json({ error: "ip required" }, { status: 400 });
  try {
    const deleted = await deleteKeysByIp(ip).catch(() => 0);
    await blacklistIp(ip, "manual", deleted);
    await audit(auth.user.id, "blacklist.add", "ip", ip, { deleted_keys: deleted });
    return NextResponse.json({ ok: true, deleted });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}

// Un-blacklist an IP: DELETE ?ip=...
export async function DELETE(req: NextRequest) {
  const auth = await requireAdmin(req);
  if (auth.response) return auth.response;
  const ip = req.nextUrl.searchParams.get("ip");
  if (!ip) return NextResponse.json({ error: "ip required" }, { status: 400 });
  try {
    await unblacklistIp(ip);
    await audit(auth.user.id, "blacklist.remove", "ip", ip);
    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}

import { NextRequest, NextResponse } from "next/server";
import { listBlacklist, blacklistIp, unblacklistIp, deleteKeysByIp } from "@/lib/supabase";

export const runtime = "nodejs";

function authorized(req: NextRequest): boolean {
  const secret = process.env.ADMIN_SECRET;
  return Boolean(secret) && (req.headers.get("x-admin-secret") || "") === secret;
}

export async function GET(req: NextRequest) {
  if (!authorized(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  try {
    return NextResponse.json({ blacklist: await listBlacklist() });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}

// Manually blacklist an IP (and delete its keys).
export async function POST(req: NextRequest) {
  if (!authorized(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  let ip = "";
  try {
    ip = String((await req.json())?.ip || "").trim();
  } catch {}
  if (!ip) return NextResponse.json({ error: "ip required" }, { status: 400 });
  try {
    const deleted = await deleteKeysByIp(ip).catch(() => 0);
    await blacklistIp(ip, "manual", deleted);
    return NextResponse.json({ ok: true, deleted });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}

// Un-blacklist an IP: DELETE ?ip=...
export async function DELETE(req: NextRequest) {
  if (!authorized(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const ip = req.nextUrl.searchParams.get("ip");
  if (!ip) return NextResponse.json({ error: "ip required" }, { status: 400 });
  try {
    await unblacklistIp(ip);
    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}

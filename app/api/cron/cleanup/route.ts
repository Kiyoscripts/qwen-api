import { NextRequest, NextResponse } from "next/server";
import { cleanupUnlinkedKeys } from "@/lib/supabase";

export const runtime = "nodejs";

// Deletes anonymous (unlinked) API keys older than 3 days. Wired to a Vercel Cron
// (see vercel.json). Also runs opportunistically from /api/stats, so it works even
// without the cron. Protected by CRON_SECRET when set (Vercel Cron sends it).
export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (secret) {
    const auth = req.headers.get("authorization") || "";
    if (auth !== `Bearer ${secret}`) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const deleted = await cleanupUnlinkedKeys();
  return NextResponse.json({ ok: true, deleted });
}

import { NextRequest, NextResponse } from "next/server";
import { claimPendingDMs, ackDM } from "@/lib/discord";

export const runtime = "nodejs";

function authed(req: NextRequest): boolean {
  const secret = process.env.LINK_BOT_SECRET;
  return Boolean(secret) && req.headers.get("authorization") === `Bearer ${secret}`;
}

// The bot polls this for DMs to send. Claiming is atomic (pending -> sending), so
// the same DM is never handed to two polls (no double-sends).
export async function GET(req: NextRequest) {
  if (!authed(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  return NextResponse.json({ dms: await claimPendingDMs() });
}

// The bot reports the result of each DM: { id, status: "sent"|"dms_closed"|"failed" }.
export async function POST(req: NextRequest) {
  if (!authed(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  let body: any;
  try { body = await req.json(); } catch { return NextResponse.json({ error: "bad json" }, { status: 400 }); }
  if (!body.id) return NextResponse.json({ error: "id required" }, { status: 400 });
  const status = ["sent", "dms_closed", "failed"].includes(body.status) ? body.status : "failed";
  await ackDM(String(body.id), status);
  return NextResponse.json({ ok: true });
}

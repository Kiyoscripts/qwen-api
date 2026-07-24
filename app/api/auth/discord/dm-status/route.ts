import { NextRequest, NextResponse } from "next/server";
import { latestDMStatus } from "@/lib/discord";
import { unseal } from "@/lib/secureToken";
import type { DiscordProfile } from "@/lib/auth";

export const runtime = "nodejs";

// The login page polls this after verifying, to tell the user whether their DM
// went through, or their DMs are closed. Uses the relay token (has the discord_id).
export async function GET(req: NextRequest) {
  const relay = unseal<{ p: DiscordProfile; t: number }>(req.nextUrl.searchParams.get("relay") || "");
  if (!relay?.p?.discord_id) return NextResponse.json({ status: null });
  return NextResponse.json({ status: await latestDMStatus(relay.p.discord_id) });
}

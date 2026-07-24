import { NextRequest, NextResponse } from "next/server";
import { createLinkCode } from "@/lib/discord";
import type { Role } from "@/lib/auth";

export const runtime = "nodejs";

// Called by the Discord bot's /link command (shared secret). Registers a one-time
// code for a Discord user and returns it so the bot can show it to them.
export async function POST(req: NextRequest) {
  const secret = process.env.LINK_BOT_SECRET;
  if (!secret || req.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  let body: any;
  try { body = await req.json(); } catch { return NextResponse.json({ error: "bad json" }, { status: 400 }); }
  if (!body.discord_id) return NextResponse.json({ error: "discord_id required" }, { status: 400 });

  const role: Role = ["owner", "admin", "member"].includes(body.role) ? body.role : "member";
  const code = await createLinkCode({
    discord_id: String(body.discord_id),
    discord_username: body.username,
    discord_global_name: body.global_name,
    discord_avatar: body.avatar,
    discord_role: role,
  });
  return NextResponse.json({ code });
}

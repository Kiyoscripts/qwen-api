import { NextRequest, NextResponse } from "next/server";
import { currentUser } from "@/lib/auth";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const user = await currentUser(req);
  if (!user) return NextResponse.json({ user: null }, { status: 401 });
  return NextResponse.json({
    user: {
      id: user.id,
      username: user.discord_global_name || user.discord_username,
      discord_id: user.discord_id,
      avatar: user.discord_avatar,
      role: user.discord_role || "member",
      created_at: user.created_at,
    },
  });
}

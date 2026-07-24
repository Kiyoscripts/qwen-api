import { NextRequest, NextResponse } from "next/server";
import { consumeLinkCode, queueDM, loginKeyDM } from "@/lib/discord";
import { linkDiscordAndIssueKey } from "@/lib/auth";
import { seal } from "@/lib/secureToken";

export const runtime = "nodejs";

// User enters their /link code on the site. We link/refresh the account, issue a
// fresh login key, and DM it via the bot. Returns whether the DM landed + a relay
// token (sealed profile) so the "Re-DM" button can retry without re-entering.
export async function POST(req: NextRequest) {
  let body: any;
  try { body = await req.json(); } catch { return NextResponse.json({ error: "Invalid JSON." }, { status: 400 }); }
  const code = String(body.code || "").trim();
  if (!code) return NextResponse.json({ error: "Enter your code." }, { status: 400 });

  const profile = await consumeLinkCode(code);
  if (!profile) return NextResponse.json({ error: "That code is invalid or expired — run /link again." }, { status: 400 });

  const { loginKey } = await linkDiscordAndIssueKey(profile);
  await queueDM(profile.discord_id, loginKeyDM(loginKey));

  return NextResponse.json({
    ok: true,
    queued: true,
    discord: {
      username: profile.discord_global_name || profile.discord_username,
      avatar: profile.discord_avatar,
      role: profile.discord_role,
    },
    relay: seal({ p: profile, t: Date.now() }),
  });
}

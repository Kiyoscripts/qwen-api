import { NextRequest, NextResponse } from "next/server";
import { botDM, loginKeyDM } from "@/lib/discord";
import { linkDiscordAndIssueKey, type DiscordProfile } from "@/lib/auth";
import { unseal } from "@/lib/secureToken";

export const runtime = "nodejs";

// Re-DM the login key (issues a fresh one). Uses the relay token from /verify so
// the user doesn't re-enter their code. Valid for 30 minutes.
export async function POST(req: NextRequest) {
  let body: any;
  try { body = await req.json(); } catch { return NextResponse.json({ error: "Invalid JSON." }, { status: 400 }); }
  const relay = unseal<{ p: DiscordProfile; t: number }>(String(body.relay || ""));
  if (!relay?.p?.discord_id || Date.now() - relay.t > 30 * 60 * 1000) {
    return NextResponse.json({ error: "This link expired — enter your code again." }, { status: 400 });
  }
  const { loginKey } = await linkDiscordAndIssueKey(relay.p);
  const dm = await botDM(relay.p.discord_id, loginKeyDM(loginKey));
  return NextResponse.json({ ok: true, dmSent: dm.ok, reason: dm.reason });
}

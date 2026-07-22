import { NextRequest, NextResponse } from "next/server";
import { checkBotId } from "botid/server";
import {
  createApiKey,
  countRecentKeysByIp,
  countRecentKeysGlobal,
  isIpBlacklisted,
  blacklistIp,
  deleteKeysByIp,
  countKeysByIp,
} from "@/lib/supabase";

export const runtime = "nodejs";

// Rate limits for public, self-serve key creation (env-overridable).
const HOUR = 60 * 60 * 1000;
const num = (v: string | undefined, d: number) => (v && !isNaN(+v) ? +v : d);
const MAX_PER_IP_PER_HOUR = num(process.env.KEY_RL_PER_IP_HOUR, 3);
const MAX_PER_IP_PER_DAY = num(process.env.KEY_RL_PER_IP_DAY, 10);
// Hard auto-ban: if one IP has created this many keys total, blacklist it and
// delete every key it created. Set to 0 to disable.
const BLACKLIST_THRESHOLD = num(process.env.KEY_BLACKLIST_THRESHOLD, 12);
// Global cap is DISABLED by default: during a flood it counts the attacker's
// volume and would 429 every legitimate user too. Only enable (KEY_RL_GLOBAL_HOUR
// > 0) if you understand that trade-off. Per-IP limiting is the right mechanism.
const MAX_GLOBAL_PER_HOUR = num(process.env.KEY_RL_GLOBAL_HOUR, 0);
// Kill switch: set PUBLIC_KEY_CREATION=false to require the admin secret.
const PUBLIC = !/^(0|false|no)$/i.test(process.env.PUBLIC_KEY_CREATION || "");

// Best-effort client IP behind Vercel's proxy.
function clientIp(req: NextRequest): string {
  const xff = req.headers.get("x-forwarded-for") || req.headers.get("x-vercel-forwarded-for");
  if (xff) return xff.split(",")[0].trim();
  return req.headers.get("x-real-ip") || "unknown";
}

// Self-serve key creation. Public + rate-limited by default; admin-only if the
// PUBLIC_KEY_CREATION kill switch is off.
export async function POST(req: NextRequest) {
  // Bot check first: only real browser sessions from our site pass. Scripted /
  // curl requests to this endpoint are classified as bots and rejected.
  // (Bypassed when creation is locked to admins, who use the admin secret.)
  if (PUBLIC) {
    const verification = await checkBotId();
    if (verification.isBot) {
      return NextResponse.json({ error: "Automated requests are not allowed. Create your key on the website." }, { status: 403 });
    }
  }

  if (!PUBLIC) {
    const secret = process.env.ADMIN_SECRET;
    if (!secret || (req.headers.get("x-admin-secret") || "") !== secret) {
      return NextResponse.json({ error: "Key creation is currently admin-only." }, { status: 401 });
    }
  }

  const ip = clientIp(req);

  // Rate limits + blacklist only apply to public (unauthenticated) creation.
  if (PUBLIC) {
    // Already-banned IP: reject immediately.
    if (await isIpBlacklisted(ip)) {
      return NextResponse.json({ error: "This IP has been blocked for abuse." }, { status: 403 });
    }
    const [perHour, perDay] = await Promise.all([
      countRecentKeysByIp(ip, HOUR),
      countRecentKeysByIp(ip, 24 * HOUR),
    ]);
    if (perHour >= MAX_PER_IP_PER_HOUR || perDay >= MAX_PER_IP_PER_DAY) {
      return NextResponse.json(
        { error: "Rate limit exceeded. You can only create a few keys per hour — reuse the key you already have." },
        { status: 429 }
      );
    }
    if (MAX_GLOBAL_PER_HOUR > 0 && (await countRecentKeysGlobal(HOUR)) >= MAX_GLOBAL_PER_HOUR) {
      return NextResponse.json({ error: "Key creation is temporarily rate-limited. Try again later." }, { status: 429 });
    }
  }

  let name: string | null = null;
  try {
    const body = await req.json();
    if (typeof body?.name === "string") name = body.name.slice(0, 80);
  } catch {
    /* name is optional */
  }
  try {
    const created = await createApiKey(name, ip);

    // Auto-ban: if this IP has now created a suspicious number of keys total,
    // blacklist it and delete every key it made (including this one).
    if (PUBLIC && BLACKLIST_THRESHOLD > 0 && ip !== "unknown") {
      const total = await countKeysByIp(ip);
      if (total >= BLACKLIST_THRESHOLD) {
        let deleted = 0;
        try {
          deleted = await deleteKeysByIp(ip);
        } catch {}
        await blacklistIp(ip, `auto: created ${total} keys`, deleted);
        return NextResponse.json({ error: "This IP has been blocked for abuse (too many keys created)." }, { status: 403 });
      }
    }

    return NextResponse.json({
      key: created.key,
      id: created.id,
      name,
      note: "Save this key now — it is shown only once and cannot be retrieved again.",
    });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}

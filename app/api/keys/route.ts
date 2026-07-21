import { NextRequest, NextResponse } from "next/server";
import { createApiKey, countRecentKeysByIp, countRecentKeysGlobal } from "@/lib/supabase";

export const runtime = "nodejs";

// Rate limits for public, self-serve key creation (env-overridable).
const HOUR = 60 * 60 * 1000;
const num = (v: string | undefined, d: number) => (v && !isNaN(+v) ? +v : d);
const MAX_PER_IP_PER_HOUR = num(process.env.KEY_RL_PER_IP_HOUR, 3);
const MAX_PER_IP_PER_DAY = num(process.env.KEY_RL_PER_IP_DAY, 10);
const MAX_GLOBAL_PER_HOUR = num(process.env.KEY_RL_GLOBAL_HOUR, 60);
// Kill switch: set PUBLIC_KEY_CREATION=false to require the admin secret.
const PUBLIC = !/^(0|false|no)$/i.test(process.env.PUBLIC_KEY_CREATION || "");

function clientIp(req: NextRequest): string {
  const xff = req.headers.get("x-forwarded-for");
  if (xff) return xff.split(",")[0].trim();
  return req.headers.get("x-real-ip") || "unknown";
}

// Self-serve key creation. Public + rate-limited by default; admin-only if the
// PUBLIC_KEY_CREATION kill switch is off.
export async function POST(req: NextRequest) {
  if (!PUBLIC) {
    const secret = process.env.ADMIN_SECRET;
    if (!secret || (req.headers.get("x-admin-secret") || "") !== secret) {
      return NextResponse.json({ error: "Key creation is currently admin-only." }, { status: 401 });
    }
  }

  const ip = clientIp(req);

  // Rate limits only apply to public (unauthenticated) creation.
  if (PUBLIC) {
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
    if ((await countRecentKeysGlobal(HOUR)) >= MAX_GLOBAL_PER_HOUR) {
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

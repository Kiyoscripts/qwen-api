import { NextRequest, NextResponse } from "next/server";
import { currentUser } from "@/lib/auth";
import { claimKey } from "@/lib/supabase";

export const runtime = "nodejs";

// POST { key } -> attach an existing anonymous key to the signed-in account, so it
// stops being auto-deleted and shows up in the dashboard.
export async function POST(req: NextRequest) {
  const user = await currentUser(req);
  if (!user) return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  let body: any;
  try { body = await req.json(); } catch { return NextResponse.json({ error: "Invalid JSON." }, { status: 400 }); }
  const key = String(body.key || "").trim();
  if (!/^qwen_sk_/.test(key)) return NextResponse.json({ error: "That doesn't look like a qwen_sk_ key." }, { status: 400 });

  const r = await claimKey(user.id, key);
  if (!r.ok) return NextResponse.json({ error: r.error }, { status: 400 });
  return NextResponse.json({ ok: true, key_prefix: r.prefix });
}

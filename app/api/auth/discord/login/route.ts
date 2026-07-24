import { NextRequest, NextResponse } from "next/server";
import { getUserByLoginKey, sessionCookie } from "@/lib/auth";

export const runtime = "nodejs";

// Log in with the login key that was DM'd after linking.
export async function POST(req: NextRequest) {
  let body: any;
  try { body = await req.json(); } catch { return NextResponse.json({ error: "Invalid JSON." }, { status: 400 }); }
  const key = String(body.key || "").trim();
  if (!key) return NextResponse.json({ error: "Enter your login key." }, { status: 400 });

  const user = await getUserByLoginKey(key);
  if (!user) return NextResponse.json({ error: "That login key isn't valid. Run /link for a fresh one." }, { status: 401 });

  const res = NextResponse.json({ user: { id: user.id } });
  res.headers.set("Set-Cookie", sessionCookie(user));
  return res;
}

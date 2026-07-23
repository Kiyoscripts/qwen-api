import { NextRequest, NextResponse } from "next/server";
import { getUserByEmail, verifyPassword, sessionCookie, normalizeEmail } from "@/lib/auth";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON." }, { status: 400 });
  }
  const email = normalizeEmail(body.email);
  const password = String(body.password || "");

  const row = await getUserByEmail(email);
  if (!row || !verifyPassword(password, row.password_hash)) {
    return NextResponse.json({ error: "Wrong email or password." }, { status: 401 });
  }
  const res = NextResponse.json({ user: { id: row.id, email: row.email } });
  res.headers.set("Set-Cookie", sessionCookie(row));
  return res;
}

import { NextRequest, NextResponse } from "next/server";
import { createUser, getUserByEmail, sessionCookie, normalizeEmail, validEmail } from "@/lib/auth";

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

  if (!validEmail(email)) return NextResponse.json({ error: "Enter a valid email." }, { status: 400 });
  if (password.length < 8) return NextResponse.json({ error: "Password must be at least 8 characters." }, { status: 400 });

  try {
    if (await getUserByEmail(email)) {
      return NextResponse.json({ error: "An account with that email already exists." }, { status: 409 });
    }
    const user = await createUser(email, password);
    const res = NextResponse.json({ user: { id: user.id, email: user.email } });
    res.headers.set("Set-Cookie", sessionCookie(user));
    return res;
  } catch (e: any) {
    // Unique-violation race -> treat as "already exists".
    if (/duplicate|unique/i.test(e?.message || "")) {
      return NextResponse.json({ error: "An account with that email already exists." }, { status: 409 });
    }
    return NextResponse.json({ error: "Could not create the account." }, { status: 500 });
  }
}

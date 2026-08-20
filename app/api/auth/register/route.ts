import { NextRequest, NextResponse } from "next/server";
import { createHash } from "node:crypto";
import { hashPassword, normalizeUsername, sessionCookie } from "@/lib/auth";
import { transaction } from "@/lib/postgres";
import { clientIp, rateLimit } from "@/lib/rateLimit";
import { getSetting } from "@/lib/settings";

export async function POST(req: NextRequest) {
  const limited = rateLimit(`register:${clientIp(req)}`, 5, 60 * 60_000);
  if (!limited.allowed) return NextResponse.json({ error: "Too many registration attempts." }, { status: 429, headers: { "Retry-After": String(limited.retryAfter) } });
  try {
    const body = await req.json();
    const username = normalizeUsername(String(body.username || ""));
    const passwordHash = await hashPassword(String(body.password || ""));
    const inviteOnly = (await getSetting("registration")).invite_only;
    const codeHash = createHash("sha256").update(String(body.invite || "").trim()).digest("hex");

    const user = await transaction(async (client) => {
      const inviteResult = inviteOnly ? await client.query(
        `select id from invites
         where code_hash = $1 and revoked = false and used_at is null
           and (expires_at is null or expires_at > now())
         for update`,
        [codeHash],
      ) : null;
      if (inviteOnly && !inviteResult?.rowCount) throw new Error("INVITE_INVALID");

      const userResult = await client.query(
        `insert into users (username, password_hash, role)
         values ($1, $2, 'user')
         returning id, username, role, disabled, created_at`,
        [username, passwordHash],
      );
      const created = userResult.rows[0];
      if (inviteResult) await client.query("update invites set used_at = now(), used_by = $1 where id = $2", [created.id, inviteResult.rows[0].id]);
      return created;
    });

    const response = NextResponse.json({ user });
    response.headers.set("Set-Cookie", sessionCookie(user));
    return response;
  } catch (error: any) {
    if (error.message === "INVITE_INVALID") return NextResponse.json({ error: "Invite is invalid or expired." }, { status: 403 });
    if (error.code === "23505") return NextResponse.json({ error: "Username is already taken." }, { status: 409 });
    return NextResponse.json({ error: error.message }, { status: 400 });
  }
}

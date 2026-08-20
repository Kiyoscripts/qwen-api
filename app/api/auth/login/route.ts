import { NextRequest, NextResponse } from "next/server";
import { audit, authenticate, sessionCookie } from "@/lib/auth";
import { clientIp, rateLimit } from "@/lib/rateLimit";
import { recordSecurityEvent } from "@/lib/securityEvents";

export async function POST(req: NextRequest) {
  const ip = clientIp(req);
  const limited = rateLimit(`login:${ip}`, 10, 15 * 60_000);
  if (!limited.allowed) { await Promise.all([audit(null, "auth.login.rate_limited", "ip", ip), recordSecurityEvent({ type: "auth.login.rate_limited", category: "authentication", severity: "high", sourceIp: ip, targetType: "ip", targetId: ip, requestId: req.headers.get("x-request-id"), route: req.nextUrl.pathname })]); return NextResponse.json({ error: "Too many login attempts." }, { status: 429, headers: { "Retry-After": String(limited.retryAfter) } }); }
  const body = await req.json().catch(() => ({}));
  const user = await authenticate(String(body.username || ""), String(body.password || ""));
  if (!user) { const username=String(body.username || "").trim().toLowerCase(); await Promise.all([audit(null, "auth.login.failed", "username", username, { ip }), recordSecurityEvent({ type: "auth.login.failed", category: "authentication", severity: "medium", sourceIp: ip, targetType: "username", targetId: username, requestId: req.headers.get("x-request-id"), route: req.nextUrl.pathname })]); return NextResponse.json({ error: "Invalid username or password." }, { status: 401 }); }
  const response = NextResponse.json({ user });
  response.headers.set("Set-Cookie", sessionCookie(user));
  return response;
}

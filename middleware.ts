import { NextRequest, NextResponse } from "next/server";
import { CANONICAL_URL, isAllowedHost, isApiPath, movedPage } from "@/lib/canonicalHost";
import { forwardedClientIp, proxyIsTrusted } from "@/lib/clientIp";
import { applySecurityHeaders, createNonce } from "@/lib/securityHeaders";

/** Enforces the canonical host and attaches request identity and browser defenses. */
export function middleware(req: NextRequest) {
  const id = req.headers.get("x-request-id")?.trim() || `req_${crypto.randomUUID().replace(/-/g, "")}`;
  const nonce = createNonce();
  const requestHeaders = new Headers(req.headers);
  requestHeaders.set("x-request-id", id);
  requestHeaders.set("x-nonce", nonce);
  const trustedProxy = proxyIsTrusted(req.headers);
  requestHeaders.set("x-client-ip", forwardedClientIp(req.headers, trustedProxy));
  requestHeaders.delete("x-origin-proxy-secret");
  requestHeaders.delete("cf-connecting-ip");
  requestHeaders.delete("x-forwarded-for");
  requestHeaders.delete("x-real-ip");

  if (!CANONICAL_URL || isAllowedHost(req.headers.get("host"))) {
    const response = NextResponse.next({ request: { headers: requestHeaders } });
    response.headers.set("X-Request-ID", id);
    applySecurityHeaders(response.headers, nonce);
    return response;
  }

  const { pathname, search } = req.nextUrl;
  let response: NextResponse;
  if (isApiPath(pathname)) {
    response = NextResponse.json(
      {
        error: {
          message: `This host has been retired. Point your base URL at ${CANONICAL_URL}/v1 — your API key is unchanged.`,
          type: "moved_permanently",
          new_base_url: `${CANONICAL_URL}/v1`,
        },
      },
      {
        status: 410,
        headers: {
          Link: `<${CANONICAL_URL}${pathname}${search}>; rel="canonical"`,
          "Cache-Control": "no-store",
          "X-Request-ID": id,
        },
      }
    );
  } else {
    response = new NextResponse(movedPage(pathname), {
      status: 410,
      headers: {
        "Content-Type": "text/html; charset=utf-8",
        Link: `<${CANONICAL_URL}${pathname}>; rel="canonical"`,
        "Cache-Control": "no-store",
        "X-Request-ID": id,
      },
    });
  }
  applySecurityHeaders(response.headers, nonce);
  return response;
}

export const config = {
  // BotID's same-origin challenge and all dynamic/API routes must pass through CSP.
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|ttf|woff2?)$).*)"],
};

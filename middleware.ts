import { NextRequest, NextResponse } from "next/server";
import { CANONICAL_URL, isAllowedHost, isApiPath, movedPage } from "@/lib/canonicalHost";

/**
 * Retires every host that isn't the canonical one.
 *
 * A client-side banner is only cosmetic — deleting the element in devtools
 * leaves a fully working app underneath, and the API never saw the banner at
 * all. Enforcing it here means the request is answered before any route runs,
 * so on a retired host there is no page to strip and no endpoint to call.
 *
 * 410 rather than 404: the resource existed and is deliberately gone, which is
 * also what tells crawlers to drop it rather than keep retrying.
 */
export function middleware(req: NextRequest) {
  if (isAllowedHost(req.headers.get("host"))) return NextResponse.next();

  const { pathname, search } = req.nextUrl;

  if (isApiPath(pathname)) {
    // Machine-readable, and shaped like the errors every other route returns so
    // existing clients surface the message instead of a parse failure.
    return NextResponse.json(
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
        },
      }
    );
  }

  return new NextResponse(movedPage(pathname), {
    status: 410,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      Link: `<${CANONICAL_URL}${pathname}>; rel="canonical"`,
      "Cache-Control": "no-store",
    },
  });
}

export const config = {
  // Static assets are excluded: the notice is self-contained, so serving them is
  // pointless either way, and matching them would run this on every chunk.
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|ttf|woff2?)$).*)"],
};

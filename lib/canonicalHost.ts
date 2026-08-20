// Which host this deployment is allowed to serve from.
//
// Kept in one place because both the middleware that enforces it and the test
// that pins it need the same predicate; two copies would drift, and a mistake
// here either locks people out of the working site or leaves the retired one
// usable.

export const CANONICAL_HOST = "syde.up.railway.app";
export const CANONICAL_URL = `https://${CANONICAL_HOST}`;

/**
 * True for the canonical host and for local/LAN development.
 *
 * Every pattern is anchored: `syde.up.railway.app.evil.com`
 * and `localhost.evil.com` are hosts an attacker controls, and an unanchored
 * `includes()` would treat both as trusted.
 */
export function isAllowedHost(hostHeader: string | null | undefined): boolean {
  if (!hostHeader) return false;
  // Strip the port, and the brackets IPv6 literals arrive wrapped in.
  const host = hostHeader.trim().toLowerCase().replace(/:\d+$/, "");

  if (host === CANONICAL_HOST) return true;
  if (host === "localhost" || host === "127.0.0.1" || host === "[::1]" || host === "::1") return true;
  // Cloudflare Quick Tunnels use a random subdomain during local development.
  if (host.endsWith(".trycloudflare.com")) return true;
  if (/^192\.168\.\d{1,3}\.\d{1,3}$/.test(host)) return true;
  if (/^10\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(host)) return true;
  if (/^172\.(1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3}$/.test(host)) return true;
  if (host.endsWith(".local")) return true;
  return false;
}

/** Whether a path is part of the API surface rather than the site. */
export function isApiPath(pathname: string): boolean {
  return pathname.startsWith("/api/") || pathname.startsWith("/v1/");
}

/**
 * The page served on a retired host. Deliberately self-contained — no scripts,
 * no stylesheet, nothing to strip in devtools — because the point is that the
 * app is unreachable here, not merely covered up.
 */
export function movedPage(pathname: string): string {
  const target = CANONICAL_URL + (pathname === "/" ? "" : pathname);
  return `<!doctype html>
<html lang="en"><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex">
<title>Syde has moved</title>
<style>
  :root { color-scheme: dark; }
  * { box-sizing: border-box; }
  body { margin:0; min-height:100vh; display:flex; align-items:center; justify-content:center; padding:24px;
    background:radial-gradient(circle at 50% 30%,#12141f,#05060c 70%); color:#eef0f7;
    font-family:ui-sans-serif,system-ui,-apple-system,"Segoe UI",Roboto,Helvetica,Arial,sans-serif; }
  .card { max-width:480px; width:100%; text-align:center; padding:36px 32px; border-radius:18px;
    background:rgba(255,255,255,.04); border:1px solid rgba(255,255,255,.09);
    box-shadow:inset 0 1px 0 rgba(255,255,255,.06),0 24px 60px -20px rgba(0,0,0,.8); }
  .logo { width:40px; height:40px; margin:0 auto 16px; border-radius:11px; display:block;
    background:linear-gradient(135deg,#8b7dff,#4fd3ac); }
  h1 { margin:0 0 12px; font-size:25px; letter-spacing:-.5px; }
  p { margin:0 0 14px; color:#9aa0b4; font-size:14.5px; line-height:1.65; }
  a.btn { display:inline-block; margin-top:8px; padding:12px 24px; border-radius:11px; font-weight:600;
    font-size:15px; text-decoration:none; color:#0a0b12;
    background:linear-gradient(135deg,#8b7dff,#4fd3ac); }
  code { background:rgba(255,255,255,.06); border:1px solid rgba(255,255,255,.09); border-radius:5px;
    padding:1px 5px; font-size:12px; color:#cdd2e6; word-break:break-all;
    font-family:ui-monospace,SFMono-Regular,Menlo,monospace; }
  .fine { font-size:12.5px; color:#6b7189; margin-top:18px; }
</style>
</head><body>
  <main class="card">
    <span class="logo"></span>
    <h1>Syde has moved</h1>
    <p>This address has been retired. The API, your keys and your account all live at the new URL.</p>
    <a class="btn" href="${target}">Go to ${CANONICAL_HOST}</a>
    <p class="fine">Calling it from code? Point <code>baseURL</code> at <code>${CANONICAL_URL}/v1</code>.
    Your keys still work — only the host changed.</p>
  </main>
</body></html>`;
}

/**
 * The origin a browser can actually reach us on.
 *
 * `req.nextUrl.origin` is wrong behind a proxy: the standalone server builds it
 * from the address it binds to, which the Dockerfile sets to 0.0.0.0:8080, so
 * generated media URLs came out as https://0.0.0.0:8080/api/media?t=… and
 * loaded nowhere. Vercel happened to paper over this; Railway does not.
 *
 * Reading the host from headers is safe here specifically because middleware
 * has already rejected every host except the canonical one and local/LAN dev —
 * so an attacker cannot use a forged Host to make us mint URLs on their domain.
 * Anything unexpected still falls back to the canonical origin.
 */
export function publicOrigin(req: Request): string {
  const h = req.headers;
  const host = (h.get("x-forwarded-host") || h.get("host") || "").split(",")[0].trim();
  if (!host || !isAllowedHost(host)) return CANONICAL_URL;

  const fwdProto = (h.get("x-forwarded-proto") || "").split(",")[0].trim();
  if (fwdProto) return `${fwdProto}://${host}`;

  // No proxy header: local and LAN development is plain http.
  const bare = host.replace(/:\d+$/, "");
  const local =
    bare === "localhost" || bare === "127.0.0.1" || bare === "[::1]" || bare === "::1" ||
    bare.endsWith(".local") || /^(10|192\.168|172\.(1[6-9]|2\d|3[01]))\./.test(bare);
  return `${local ? "http" : "https"}://${host}`;
}

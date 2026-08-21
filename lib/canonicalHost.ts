// Optional canonical-host enforcement for operators intentionally retiring an
// old deployment. Self-hosted installations accept their assigned hostname by
// default; set PUBLIC_APP_URL to enforce one HTTPS origin.
const configuredUrl = (process.env.PUBLIC_APP_URL || "").trim().replace(/\/$/, "");
let configuredHost = "";
if (configuredUrl) {
  try {
    const parsed = new URL(configuredUrl);
    if (parsed.protocol === "https:" && parsed.origin === configuredUrl) configuredHost = parsed.host.toLowerCase();
  } catch { /* validation is also documented and deployment remains accessible */ }
}

export const CANONICAL_HOST = configuredHost;
export const CANONICAL_URL = configuredHost ? `https://${configuredHost}` : "";

export function isAllowedHost(hostHeader: string | null | undefined): boolean {
  if (!hostHeader) return false;
  if (!CANONICAL_HOST) return true;
  const host = hostHeader.trim().toLowerCase().replace(/:\d+$/, "");
  if (host === CANONICAL_HOST.replace(/:\d+$/, "")) return true;
  if (host === "localhost" || host === "127.0.0.1" || host === "[::1]" || host === "::1") return true;
  if (host.endsWith(".trycloudflare.com")) return true;
  if (/^192\.168\.\d{1,3}\.\d{1,3}$/.test(host)) return true;
  if (/^10\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(host)) return true;
  if (/^172\.(1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3}$/.test(host)) return true;
  if (host.endsWith(".local")) return true;
  return false;
}

export function isApiPath(pathname: string): boolean {
  return pathname.startsWith("/api/") || pathname.startsWith("/v1/");
}

export function movedPage(pathname: string): string {
  const target = CANONICAL_URL + (pathname === "/" ? "" : pathname);
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>Service has moved</title><style>:root{color-scheme:dark}*{box-sizing:border-box}body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;padding:24px;background:#080a10;color:#eef0f7;font-family:system-ui,sans-serif}.card{max-width:480px;width:100%;text-align:center;padding:36px 32px;border:1px solid #303442;border-radius:18px;background:#12151e}h1{font-size:2rem}p{color:#aeb4c4;line-height:1.7}a{display:block;margin-top:24px;padding:14px;background:#eef0f7;color:#080a10;text-decoration:none;border-radius:10px}</style></head><body><main class="card"><h1>Service has moved</h1><p>This hostname has been retired. Continue at the configured deployment URL.</p><a href="${target}">Go to ${CANONICAL_HOST}</a></main></body></html>`;
}

export function publicOrigin(req: Request): string {
  const h = req.headers;
  const host = (h.get("x-forwarded-host") || h.get("host") || "").split(",")[0].trim();
  if (!host || !isAllowedHost(host)) return CANONICAL_URL || "http://localhost:3000";
  const fwdProto = (h.get("x-forwarded-proto") || "").split(",")[0].trim();
  if (fwdProto === "http" || fwdProto === "https") return `${fwdProto}://${host}`;
  const bare = host.replace(/:\d+$/, "");
  const local = bare === "localhost" || bare === "127.0.0.1" || bare === "[::1]" || bare === "::1" || bare.endsWith(".local") || /^(10|192\.168|172\.(1[6-9]|2\d|3[01]))\./.test(bare);
  return `${local ? "http" : "https"}://${host}`;
}

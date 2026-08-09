// Generated media URLs must point at a host a browser can reach. On Railway the
// standalone server binds 0.0.0.0:8080, so req.nextUrl.origin produced
// https://0.0.0.0:8080/api/media?t=… and every generated image 404'd.

import { publicOrigin, CANONICAL_URL } from "../lib/canonicalHost";

const req = (h: Record<string, string>) => new Request("http://0.0.0.0:8080/v1/x", { headers: h });

let pass = 0, fail = 0;
const check = (name: string, got: string, want: string) => {
  if (got === want) pass++;
  else { fail++; console.error(`✗ ${name}\n    got  ${got}\n    want ${want}`); }
};

// Behind Railway's proxy: forwarded headers decide.
check("railway proxy", publicOrigin(req({ host: "0.0.0.0:8080", "x-forwarded-host": "syde.up.railway.app", "x-forwarded-proto": "https" })),
  "https://syde.up.railway.app");
check("proxy sets Host only", publicOrigin(req({ host: "syde.up.railway.app", "x-forwarded-proto": "https" })),
  "https://syde.up.railway.app");
check("no forwarded proto, public host", publicOrigin(req({ host: "syde.up.railway.app" })),
  "https://syde.up.railway.app");
check("comma-joined forwarded chain", publicOrigin(req({ host: "0.0.0.0:8080", "x-forwarded-host": "syde.up.railway.app, internal", "x-forwarded-proto": "https, http" })),
  "https://syde.up.railway.app");

// Development stays on http, with the port preserved.
check("localhost dev", publicOrigin(req({ host: "localhost:3000" })), "http://localhost:3000");
check("LAN preview", publicOrigin(req({ host: "192.168.0.14:3000" })), "http://192.168.0.14:3000");
check("mDNS", publicOrigin(req({ host: "manolis-macbook.local:3000" })), "http://manolis-macbook.local:3000");

// A forged Host cannot make us mint URLs on someone else's domain.
check("forged host falls back", publicOrigin(req({ host: "evil.com" })), CANONICAL_URL);
check("suffix spoof falls back", publicOrigin(req({ host: "syde.up.railway.app.evil.com" })), CANONICAL_URL);
check("no host at all", publicOrigin(req({})), CANONICAL_URL);
// The bug itself: the bind address is not a reachable origin.
check("bare bind address falls back", publicOrigin(req({ host: "0.0.0.0:8080" })), CANONICAL_URL);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

// The retirement check gates the whole deployment: a false positive hides a
// working site, a false negative leaves a retired one usable. Both matter, so
// the predicate is pinned here — including the spoofing cases its anchors exist
// for.

import { isAllowedHost, isApiPath, CANONICAL_HOST } from "../lib/canonicalHost";

const allowed = (h: string) => isAllowedHost(h);

let pass = 0, fail = 0;
const check = (host: string, want: boolean, why: string) => {
  const got = allowed(host);
  if (got === want) pass++;
  else { fail++; console.error(`✗ ${host} -> ${got}, expected ${want} (${why})`); }
};

console.log(`canonical host: ${CANONICAL_HOST}\n`);

// Must NOT show the notice.
check(CANONICAL_HOST, true, "the canonical host itself");
check("localhost", true, "local dev");
check("127.0.0.1", true, "local dev by IP");
check("[::1]", true, "local dev over IPv6");
check("localhost:3000", true, "host header carries a port");
check("192.168.0.14:3000", true, "LAN preview with a port");
check("192.168.0.14", true, "LAN preview, phone testing");
check("10.0.0.5", true, "LAN preview");
check("172.16.4.2", true, "LAN preview, lower bound of the private range");
check("172.31.255.254", true, "LAN preview, upper bound");
check("manolis-macbook.local", true, "mDNS name");

// Must show the notice.
check("qwen3-8-api.vercel.app", false, "the old deployment — the whole point");
check("qwen38-api.vercel.app", false, "any other vercel host");
check("example.com", false, "unrelated host");
check("syde.up.railway.app.evil.com", false, "suffix spoofing");
check("evil-syde.up.railway.app", false, "prefix spoofing");
check("172.32.0.1", false, "just outside the private range — a public IP");
check("172.15.0.1", false, "just below the private range");
check("192.168.0.14.evil.com", false, "IP-looking prefix on a public domain");
check("notlocalhost", false, "substring of localhost");
check("localhost.evil.com", false, "localhost as a prefix");

// Paths routed to the JSON error rather than the HTML notice.
for (const [p, want] of [["/v1/chat/completions", true], ["/api/auth/me", true],
                         ["/", false], ["/chat", false], ["/docs", false]] as [string, boolean][]) {
  const got = isApiPath(p);
  if (got === want) pass++;
  else { fail++; console.error(`\u2717 isApiPath(${p}) -> ${got}, expected ${want}`); }
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

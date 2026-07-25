// The moved-notice covers the whole page, so a false positive hides the working
// site. These pin down exactly which hosts are treated as canonical.

import { readFileSync } from "node:fs";

// The predicate is not exported (it is internal to a client component), so lift
// it out of the source rather than duplicating it here — a copy would drift.
const src = readFileSync(new URL("../app/MovedNotice.tsx", import.meta.url), "utf8");
const CANONICAL_HOST = /export const CANONICAL_HOST = "([^"]+)"/.exec(src)![1];
const body = /function isAllowedHost\(host: string\): boolean \{([\s\S]*?)\n\}/.exec(src)![1];
const isAllowedHost = new Function("host", "CANONICAL_HOST", body.replace(/: boolean/g, "")) as (
  h: string,
  c: string
) => boolean;
const allowed = (h: string) => isAllowedHost(h, CANONICAL_HOST);

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
check("192.168.0.14", true, "LAN preview, phone testing");
check("10.0.0.5", true, "LAN preview");
check("172.16.4.2", true, "LAN preview, lower bound of the private range");
check("172.31.255.254", true, "LAN preview, upper bound");
check("manolis-macbook.local", true, "mDNS name");

// Must show the notice.
check("qwen3-8-api.vercel.app", false, "the old deployment — the whole point");
check("qwen38-api.vercel.app", false, "any other vercel host");
check("example.com", false, "unrelated host");
check("qwen38-api-production.up.railway.app.evil.com", false, "suffix spoofing");
check("evil-qwen38-api-production.up.railway.app", false, "prefix spoofing");
check("172.32.0.1", false, "just outside the private range — a public IP");
check("172.15.0.1", false, "just below the private range");
check("192.168.0.14.evil.com", false, "IP-looking prefix on a public domain");
check("notlocalhost", false, "substring of localhost");
check("localhost.evil.com", false, "localhost as a prefix");

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

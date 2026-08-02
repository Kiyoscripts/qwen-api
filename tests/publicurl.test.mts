// Which URL the link bot puts in front of a user.
//
// The bug this pins: bot and site share a container, so the supervisor points
// the bot at http://127.0.0.1:8080. That is right for the bot's own fetches and
// wrong in a Discord message, where it told everyone to open a site on their own
// machine. The two addresses are now resolved separately.

import { publicSiteUrl, isLoopback } from "../linkbot/publicUrl.mjs";

let passed = 0;
let failed = 0;
function check(name: string, cond: boolean, detail = "") {
  if (cond) {
    passed++;
  } else {
    failed++;
    console.error(`  FAIL: ${name}${detail ? ` — ${detail}` : ""}`);
  }
}
const eq = (name: string, got: string, want: string) => check(name, got === want, `got ${JSON.stringify(got)}`);

// 1. The deployed shape: the supervisor's loopback must never win over the
//    public domain Railway injects.
eq("railway domain beats loopback SITE_URL",
  publicSiteUrl({ SITE_URL: "http://127.0.0.1:8080", RAILWAY_PUBLIC_DOMAIN: "qwen38-api-production.up.railway.app" }),
  "https://qwen38-api-production.up.railway.app");

// 2. Railway supplies a bare domain, not a URL, so a scheme has to be added —
//    without double-prefixing one that already has it.
eq("bare domain gains https", publicSiteUrl({ RAILWAY_PUBLIC_DOMAIN: "example.com" }), "https://example.com");
eq("domain with scheme is left alone", publicSiteUrl({ RAILWAY_PUBLIC_DOMAIN: "https://example.com" }), "https://example.com");

// 3. An explicit override outranks everything: a custom domain in front of
//    Railway is exactly the case that needs it.
eq("PUBLIC_SITE_URL wins",
  publicSiteUrl({ PUBLIC_SITE_URL: "https://api.example.com", RAILWAY_PUBLIC_DOMAIN: "x.up.railway.app", SITE_URL: "http://127.0.0.1:8080" }),
  "https://api.example.com");

// 4. Running the bot off-host — a dev machine aimed at the real site — has
//    neither of the first two, and SITE_URL is then the only sensible answer.
eq("falls back to SITE_URL", publicSiteUrl({ SITE_URL: "https://qwen38-api-production.up.railway.app" }),
  "https://qwen38-api-production.up.railway.app");
eq("nothing set yields empty", publicSiteUrl({}), "");

// 5. Trailing slashes would produce "//login" once a path is appended.
eq("trailing slash trimmed", publicSiteUrl({ PUBLIC_SITE_URL: "https://example.com/" }), "https://example.com");
eq("repeated slashes trimmed", publicSiteUrl({ PUBLIC_SITE_URL: "https://example.com///" }), "https://example.com");
eq("whitespace trimmed", publicSiteUrl({ PUBLIC_SITE_URL: "  https://example.com  " }), "https://example.com");

// 6. The loopback predicate is what turns a silent misconfiguration into a
//    startup warning, so it has to catch every spelling of "this machine".
for (const url of ["http://127.0.0.1:8080", "http://localhost:3000", "https://0.0.0.0:8080", "http://[::1]:8080", "http://localhost"]) {
  check(`loopback: ${url}`, isLoopback(url));
}
for (const url of ["https://qwen38-api-production.up.railway.app", "https://example.com", "https://127.0.0.1.evil.com"]) {
  check(`not loopback: ${url}`, !isLoopback(url));
}

console.log(`publicurl: ${passed} passed, ${failed} failed`);
if (failed) process.exit(1);

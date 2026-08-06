// Qwen answers ANY credential it will not honour with the anti-bot page.
//
// Measured against the live endpoint: a tampered signature, a back-dated exp and
// the literal string "not-a-token" each came back as HTTP 200 carrying
// FAIL_SYS_USER_VALIDATE / RGV587 — the same body a real challenge produces.
// So that body says "this account was refused", not "this deployment is
// blocked", and the pool must keep treating it as an account-level failure.
//
// Expiry is the part that can be known locally, before spending a request.

import { tokenExpiry, isTokenExpired, isChallenge, isTokenFailure } from "../lib/tokens.ts";

let passed = 0, failed = 0;
function check(name: string, cond: boolean, detail = "") {
  if (cond) passed++;
  else { failed++; console.error(`  FAIL: ${name}${detail ? ` — ${detail}` : ""}`); }
}

const b64 = (o: any) => Buffer.from(JSON.stringify(o)).toString("base64url");
/** A token shaped like Qwen's: {id, last_password_change, exp}. */
const jwt = (exp: number) =>
  `${b64({ alg: "HS256", typ: "JWT" })}.${b64({ id: "0b7f", last_password_change: 1, exp })}.sig`;

const NOW = Date.now();
const SEC = Math.floor(NOW / 1000);

// 1. Expiry is read from the payload, in ms.
{
  const t = jwt(SEC + 3600);
  check("expiry parsed", tokenExpiry(t) === (SEC + 3600) * 1000, String(tokenExpiry(t)));
  check("future token is not expired", !isTokenExpired(t, NOW));
  check("past token is expired", isTokenExpired(jwt(SEC - 3600), NOW));
}

// 2. Unreadable is "cannot tell", never "expired" — a token we cannot parse must
//    still get its chance upstream rather than being dropped locally.
for (const bad of ["", "not-a-token", "a.b", "a.b.c.d", "header.!!!notbase64!!!.sig"]) {
  check(`unreadable stays unknown: ${JSON.stringify(bad).slice(0, 22)}`, tokenExpiry(bad) === null && !isTokenExpired(bad, NOW));
}

// 3. A JWT with no exp claim is also "cannot tell", not expired.
{
  const noExp = `${b64({ alg: "HS256" })}.${b64({ id: "x", last_password_change: 1 })}.sig`;
  check("missing exp is unknown", tokenExpiry(noExp) === null && !isTokenExpired(noExp, NOW));
}

// 4. Boundary: exp exactly now counts as expired, not usable-for-one-more-ms.
{
  const t = jwt(SEC);
  check("exp == now is expired", isTokenExpired(t, SEC * 1000));
  check("exp one second out is not", !isTokenExpired(jwt(SEC + 1), SEC * 1000));
}

// 5. The challenge stays an ACCOUNT failure. This is the regression that matters:
//    if it ever stops being one, a single refused account stalls the whole pool.
{
  const chal = { code: "challenge", message: "Qwen served an anti-bot challenge to this account." };
  check("challenge is recognised", isChallenge(chal));
  check("challenge routes to failover", isTokenFailure(chal.message));
  check("unrelated error is not a challenge", !isChallenge({ message: "socket hang up" }));
  check("unrelated error does not trigger failover", !isTokenFailure("socket hang up"));
}

console.log(`token.expiry: ${passed} passed, ${failed} failed`);
if (failed) process.exit(1);

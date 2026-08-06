// How an upstream refusal is classified decides two things: what the operator
// reads in the logs, and whether the request rolls onto another account or dies.
//
// The second is easy to break silently. Failover keys off the error, so a
// reworded message that no longer reads as an account failure turns a routine
// rotation into a failed request for the user — with nothing in the logs to say
// the wording was the cause.

import { classifyRefusal, QwenError } from "../lib/qwen.ts";
import { isTokenFailure, parkMsForFailure } from "../lib/tokens.ts";

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

/** The pool rotates on an error only if one of these holds. */
const rotates = (e: QwenError) => e.retryable === true || isTokenFailure(e.message);

// 1. Each refusal is named for what it actually is. These used to share one
//    message — "anti-bot challenge / rate limit" — for an expired token, a
//    banned account and a real challenge alike, which is why a sudden outage
//    read as a bot problem regardless of cause.
{
  const expired = classifyRefusal(401, '{"code":401,"msg":"unauthorized"}');
  check("401 is reported as a token problem", /expired|no longer valid/i.test(expired?.message || ""), expired?.message);
  check("401 does not claim anti-bot", !/anti-bot|challenge/i.test(expired?.message || ""), expired?.message);

  const forbidden = classifyRefusal(403, '{"code":403}');
  check("403 is reported as a refused account", /forbidden|banned|restricted/i.test(forbidden?.message || ""), forbidden?.message);
  check("403 does not claim anti-bot", !/anti-bot|challenge/i.test(forbidden?.message || ""), forbidden?.message);

  const limited = classifyRefusal(429, "slow down");
  check("429 is reported as rate limiting", /rate limited/i.test(limited?.message || ""), limited?.message);
}

// 2. A genuine challenge is recognised by its markers, whatever the status —
//    Qwen serves these with a 200 as readily as a 403.
{
  for (const body of [
    "please complete the operation to continue",
    "Access verification required",
    '{"data":{"punish":"slide"}}',
    "rgv587_flag",
    "baxia captcha",
  ]) {
    const e = classifyRefusal(200, body);
    check(`challenge marker detected: ${JSON.stringify(body.slice(0, 24))}`, /anti-bot challenge/i.test(e?.message || ""), e?.message);
  }
  // Markers win over the status code: a challenge served as 403 is a challenge.
  const e = classifyRefusal(403, "please complete the operation");
  check("challenge marker beats the status code", /anti-bot challenge/i.test(e?.message || ""), e?.message);
}

// 3. Every refusal must still roll the request onto another account.
{
  const cases: [string, QwenError | null][] = [
    ["expired token", classifyRefusal(401, "{}")],
    ["forbidden account", classifyRefusal(403, "{}")],
    ["rate limited", classifyRefusal(429, "{}")],
    ["anti-bot challenge", classifyRefusal(200, "please complete the operation")],
  ];
  for (const [name, e] of cases) {
    check(`${name} triggers failover`, e !== null && rotates(e), e ? `retryable=${e.retryable} msg=${e.message}` : "not classified");
  }
}

// 4. A retry-after hint is worth keeping — it is the only number upstream gives
//    us about when the account will work again.
{
  const withHint = classifyRefusal(429, "", new Headers({ "retry-after": "30" }));
  check("retry-after is surfaced", (withHint?.message || "").includes("30"), withHint?.message);
  const without = classifyRefusal(429, "", new Headers());
  check("no retry-after still classifies", /rate limited/i.test(without?.message || ""), without?.message);
}

// 5. Responses that are not refusals must pass through, or ordinary upstream
//    errors get misreported as account problems and burn the whole pool.
{
  check("200 with a normal body is not a refusal", classifyRefusal(200, '{"data":{"id":"abc"}}') === null);
  check("500 is not an account refusal", classifyRefusal(500, "internal error") === null);
  check("404 is not an account refusal", classifyRefusal(404, "not found") === null);
  // The word "quota" in a successful payload must not be mistaken for one.
  check("a body mentioning quota is not a refusal", classifyRefusal(200, '{"data":{"quota":5}}') === null);
}

// 6. Status codes carry through, so callers can map them to a response.
{
  check("401 keeps its status", classifyRefusal(401, "{}")?.status === 401);
  check("429 keeps its status", classifyRefusal(429, "{}")?.status === 429);
  check("challenge reports 503", classifyRefusal(200, "captcha")?.status === 503);
}

// 7. Refusal codes drive park duration so challenged accounts stop being
//    re-selected immediately (the user-facing failure mode when a few accounts
//    trip baxia and the rest of the pool is fine).
{
  const challenge = classifyRefusal(200, "captcha");
  const expired = classifyRefusal(401, "{}");
  const forbidden = classifyRefusal(403, "{}");
  const limited = classifyRefusal(429, "{}");
  check("challenge has code", challenge?.code === "challenge");
  check("expired has code", expired?.code === "expired");
  check("forbidden has code", forbidden?.code === "forbidden");
  check("rate_limit has code", limited?.code === "rate_limit");
  check("challenge parks ≥ 10 min", parkMsForFailure(challenge!) >= 10 * 60_000);
  check("expired parks ≥ 1 hour", parkMsForFailure(expired!) >= 60 * 60_000);
  check("rate_limit parks briefly", parkMsForFailure(limited!) > 0 && parkMsForFailure(limited!) <= 5 * 60_000);
  check("unknown message with no failure shape does not park", parkMsForFailure({ message: "model not found" }) === 0);
}

console.log(`${passed} passed, ${failed} failed`);
if (failed) process.exit(1);

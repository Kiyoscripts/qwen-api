// A challenge must stop the failover loop, not drive it.
//
// Measured against the live endpoint: createChat succeeds on the same token and
// egress IP that then gets FAIL_SYS_USER_VALIDATE / RGV587 on completions, and
// more accounts do not help. So the WAF keys on the caller, not the credential —
// and walking the pool turns one challenge into one full request per account
// aimed at a WAF that is already saying "retry later".

import { isChallenge, challengeActive, challengeCooldownRemaining, noteChallenge, resetChallengeCooldown } from "../lib/tokens.ts";
import { classifyRefusal } from "../lib/qwen.ts";

let passed = 0, failed = 0;
function check(name: string, cond: boolean, detail = "") {
  if (cond) passed++;
  else { failed++; console.error(`  FAIL: ${name}${detail ? ` — ${detail}` : ""}`); }
}

// The exact body the live endpoint returned, at HTTP 200.
const REAL_BODY = '{"ret":["FAIL_SYS_USER_VALIDATE","RGV587_ERROR::SM::哎哟喂,被挤爆啦,请稍后重试"],"data":{"url":"https://chat.qwen.ai:443//api/v2/chat/completions/_____tmd_____/punish?x5secdata=xg8a&x5step=2&action=captcha&pureCaptcha="}}';

// 1. The real body is recognised as a challenge, despite arriving with HTTP 200.
{
  const e = classifyRefusal(200, REAL_BODY);
  check("real punish body classifies", e !== null && e.code === "challenge", String(e?.code));
  check("real punish body is a challenge to the pool", isChallenge(e));
}

// 2. A spent account is NOT a challenge — it must still roll to another account,
//    which is the behaviour the cooldown must not swallow.
{
  const quota: any = new Error("You have reached your upper limit for today.");
  check("quota message is not a challenge", !isChallenge(quota));
  const expired = classifyRefusal(401, "unauthorized");
  check("expired token is not a challenge", !isChallenge(expired), String(expired?.code));
  const forbidden = classifyRefusal(403, "forbidden");
  check("forbidden is not a challenge", !isChallenge(forbidden), String(forbidden?.code));
}

// 3. The window opens on a challenge and reports time remaining, so the caller
//    can say how long rather than just "unavailable".
{
  resetChallengeCooldown();
  check("no cooldown initially", !challengeActive());
  check("no time remaining initially", challengeCooldownRemaining() === 0);
  noteChallenge();
  check("cooldown active after a challenge", challengeActive());
  check("reports time remaining", challengeCooldownRemaining() > 0, String(challengeCooldownRemaining()));
}

// 4. The window expires on its own — a challenge must not park the pool forever.
{
  resetChallengeCooldown();
  noteChallenge(Date.now() - 10 * 60_000); // a challenge from ten minutes ago
  check("old challenge no longer active", !challengeActive(), String(challengeCooldownRemaining()));
}

// 5. Matching is by code, not only by wording, so a rephrased message still
//    backs off rather than silently reverting to walking the pool.
{
  check("code alone is enough", isChallenge({ code: "challenge" }));
  check("wording alone is enough", isChallenge({ message: "Qwen served an anti-bot challenge to this account." }));
  check("unrelated error is not a challenge", !isChallenge({ message: "socket hang up" }));
}

resetChallengeCooldown();
console.log(`challenge.backoff: ${passed} passed, ${failed} failed`);
if (failed) process.exit(1);

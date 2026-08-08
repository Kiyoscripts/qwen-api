// Offline checks for the QwenFreeApi-ported SSXMOD fingerprint cookies and
// browser-shaped headers. No network: we only assert encoding shape + that
// qwenHeaders attaches Cookie / Client Hints the WAF expects.

import { generateCookies, generateFingerprint, buildQwenCookieHeader, rotateSsxmod } from "../lib/ssxmod.ts";
import { qwenHeaders, isWafResponse, classifyRefusal } from "../lib/qwen.ts";

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

// 1. Fingerprint is 37 caret-separated fields.
{
  const fp = generateFingerprint({ platform: "win64", screen: "1920x1080", locale: "zh-CN" });
  const fields = fp.split("^");
  check("fingerprint has 37 fields", fields.length === 37, `got ${fields.length}`);
  check("fingerprint deviceId is hex-ish", /^[0-9a-f]{20}$/i.test(fields[0]), fields[0]);
  check("fingerprint sdk version present", fields[1].includes("websdk"), fields[1]);
}

// 2. Cookies encode to the "1-<custom-base64>" form Alibaba accepts.
{
  const c = generateCookies();
  check("ssxmod_itna starts with 1-", c.ssxmod_itna.startsWith("1-"), c.ssxmod_itna.slice(0, 20));
  check("ssxmod_itna2 starts with 1-", c.ssxmod_itna2.startsWith("1-"), c.ssxmod_itna2.slice(0, 20));
  check("ssxmod_itna has body after prefix", c.ssxmod_itna.length > 20);
  check("ssxmod_itna2 has body after prefix", c.ssxmod_itna2.length > 20);
  check("deviceId non-empty", Boolean(c.deviceId));
  check("timestamp is recent ms epoch", c.timestamp > 1_700_000_000_000 && c.timestamp < Date.now() + 60_000);
}

// 3. Cookie header includes token + both ssxmod cookies.
{
  rotateSsxmod();
  const header = buildQwenCookieHeader("test-jwt-token");
  check("cookie header has token=", header.includes("token=test-jwt-token"), header.slice(0, 80));
  check("cookie header has ssxmod_itna=", /ssxmod_itna=1-/.test(header), header);
  check("cookie header has ssxmod_itna2=", /ssxmod_itna2=1-/.test(header), header);
}

// 4. qwenHeaders looks like a real browser same-origin XHR.
{
  const h = qwenHeaders("tok", {}, { refererPath: "/c/new-chat" });
  check("Authorization bearer", h.Authorization === "Bearer tok");
  check("Version header present", Boolean(h.Version));
  check("Cookie present", Boolean(h.Cookie) && h.Cookie.includes("ssxmod_itna="));
  check("sec-ch-ua present", Boolean(h["sec-ch-ua"]));
  check("sec-fetch-site same-origin", h["sec-fetch-site"] === "same-origin");
  check("Referer uses SPA path", h.Referer === "https://chat.qwen.ai/c/new-chat", h.Referer);
  check("Origin is chat.qwen.ai", h.Origin === "https://chat.qwen.ai");
  check("User-Agent is Chrome-like", /Chrome\/\d+/.test(h["User-Agent"] || ""), h["User-Agent"]);
}

// 5. WAF / challenge bodies are recognized (incl. QwenFreeApi markers).
{
  check("html content-type is WAF", isWafResponse(200, "text/html; charset=utf-8", "<html>hi</html>"));
  check("504 is WAF", isWafResponse(504, "application/json", "{}"));
  check("FAIL_SYS_USER_VALIDATE is WAF", isWafResponse(200, "application/json", "FAIL_SYS_USER_VALIDATE"));
  check("aliyun_waf marker is WAF", isWafResponse(403, "text/plain", "aliyun_waf block"));
  check("clean JSON is not WAF", !isWafResponse(200, "application/json", '{"data":{"id":"x"}}'));

  const challenge = classifyRefusal(200, "FAIL_SYS_USER_VALIDATE");
  check("classifyRefusal names challenge", challenge?.code === "challenge", challenge?.message);
  check("challenge is retryable (pool rotates)", challenge?.retryable === true);
}

console.log(`ssxmod: ${passed} passed, ${failed} failed`);
if (failed) process.exit(1);

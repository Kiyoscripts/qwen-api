import assert from "node:assert/strict";

const lines: string[] = [];
const original = console.info;
console.info = (line?: unknown) => lines.push(String(line));
const { logger } = await import("../lib/logger.ts");
logger.info("security.redaction_test", {
  authorization: "Bearer top-secret",
  qwen_token: "eyJabc.def.ghi",
  nested: { password: "hunter2", note: "Bearer another-secret", apiKey: "syde_sk_dontlogme" },
});
console.info = original;

assert.equal(lines.length, 1);
const line = lines[0];
assert.doesNotMatch(line, /top-secret|another-secret|hunter2|dontlogme|eyJabc/);
const parsed = JSON.parse(line);
assert.equal(parsed.event, "security.redaction_test");
assert.equal(parsed.authorization, "[REDACTED]");
assert.equal(parsed.nested.password, "[REDACTED]");
console.log("logger redaction tests passed");

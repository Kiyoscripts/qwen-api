import assert from "node:assert/strict";
import { applySecurityHeaders, contentSecurityPolicy } from "../lib/securityHeaders";

const nonce = "fixed-test-nonce";
const production = contentSecurityPolicy(nonce, true);
assert.match(production, /script-src 'self' 'nonce-fixed-test-nonce' 'strict-dynamic'/);
assert.doesNotMatch(production, /script-src[^;]*'unsafe-inline'/);
assert.doesNotMatch(production, /'unsafe-eval'/);
assert.match(production, /object-src 'none'/);
assert.match(production, /frame-ancestors 'none'/);
assert.match(production, /upgrade-insecure-requests/);
assert.match(contentSecurityPolicy(nonce, false), /script-src[^;]*'unsafe-eval'/);
assert.doesNotMatch(contentSecurityPolicy(nonce, false), /upgrade-insecure-requests/);

const headers = new Headers();
applySecurityHeaders(headers, nonce);
assert.equal(headers.get("x-content-type-options"), "nosniff");
assert.equal(headers.get("x-frame-options"), "DENY");
assert.equal(headers.get("cross-origin-opener-policy"), "same-origin");
assert.equal(headers.get("cross-origin-resource-policy"), "same-origin");
assert.match(headers.get("strict-transport-security") ?? "", /includeSubDomains/);
assert.match(headers.get("permissions-policy") ?? "", /microphone=\(\)/);

console.log("security headers: ok");

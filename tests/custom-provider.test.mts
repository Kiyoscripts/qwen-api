import assert from "node:assert/strict";
import { encryptCredential, decryptCredential } from "../lib/credentialEncryption";
import { isBlockedProviderAddress, validateProviderBaseUrl } from "../lib/providerUrl";

process.env.PROVIDER_CREDENTIAL_KEY = "test-only-provider-key-material-at-least-32-characters";
const encrypted = encryptCredential("sk-secret-value");
assert.notEqual(encrypted, "sk-secret-value");
assert.equal(decryptCredential(encrypted), "sk-secret-value");
const raw = Buffer.from(encrypted, "base64url");
raw[raw.length - 1] ^= 1;
assert.throws(() => decryptCredential(raw.toString("base64url")));
process.env.PROVIDER_CREDENTIAL_KEY = "different-test-key-material-at-least-32-characters";
assert.throws(() => decryptCredential(encrypted));
process.env.PROVIDER_CREDENTIAL_KEY = "test-only-provider-key-material-at-least-32-characters";

for (const address of ["127.0.0.1","10.0.0.1","172.16.0.1","192.168.1.1","169.254.1.1","::1","fc00::1","fe80::1","::ffff:127.0.0.1"]) assert.equal(isBlockedProviderAddress(address), true, address);
for (const address of ["1.1.1.1","8.8.8.8","2606:4700:4700::1111"]) assert.equal(isBlockedProviderAddress(address), false, address);
assert.equal(validateProviderBaseUrl("https://example.com/v1/").href, "https://example.com/v1");
for (const value of ["http://example.com/v1","https://user:pass@example.com/v1","https://example.com/v1?q=1","https://example.com/v1#x"]) assert.throws(() => validateProviderBaseUrl(value), value);
console.log("custom provider security tests passed");

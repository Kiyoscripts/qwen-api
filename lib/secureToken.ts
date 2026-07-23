// Tiny AES-256-GCM sealed tokens for opaque, tamper-evident round-trips through a
// client (e.g. "which pooled account owns this video task"). Same key as the media
// tokens, but kept dependency-free (no sharp) so any route can import it.

import { createCipheriv, createDecipheriv, randomBytes, createHash } from "node:crypto";

function key(): Buffer {
  const secret = process.env.MEDIA_SECRET || process.env.ADMIN_SECRET || "qwen-media-dev-secret";
  return createHash("sha256").update(secret).digest(); // 32 bytes
}

export function seal(obj: unknown): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(), iv);
  const pt = Buffer.from(JSON.stringify(obj), "utf8");
  const ct = Buffer.concat([cipher.update(pt), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, ct]).toString("base64url");
}

export function unseal<T = any>(token: string): T | null {
  try {
    const raw = Buffer.from(token, "base64url");
    if (raw.length < 29) return null;
    const iv = raw.subarray(0, 12);
    const tag = raw.subarray(12, 28);
    const ct = raw.subarray(28);
    const decipher = createDecipheriv("aes-256-gcm", key(), iv);
    decipher.setAuthTag(tag);
    const pt = Buffer.concat([decipher.update(ct), decipher.final()]);
    return JSON.parse(pt.toString("utf8")) as T;
  } catch {
    return null;
  }
}

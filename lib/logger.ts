type LogLevel = "info" | "warn" | "error";
type Fields = Record<string, unknown>;

const SECRET_KEYS = /authorization|cookie|password|secret|token|api[_-]?key|key_hash|invite_code/i;
const BEARER = /\bBearer\s+[A-Za-z0-9._~+\/-]+=*/gi;
const API_KEY = /\b(?:qwen|syde)_sk_[A-Za-z0-9_-]+/gi;
const JWT = /\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g;

function safe(value: unknown, key = "", seen = new WeakSet<object>()): unknown {
  if (SECRET_KEYS.test(key)) return "[REDACTED]";
  if (typeof value === "string") return value.replace(BEARER, "Bearer [REDACTED]").replace(API_KEY, "[REDACTED_API_KEY]").replace(JWT, "[REDACTED_TOKEN]").slice(0, 2000);
  if (value instanceof Error) return { name: value.name, message: safe(value.message), stack: process.env.NODE_ENV === "development" ? safe(value.stack || "") : undefined };
  if (!value || typeof value !== "object") return value;
  if (seen.has(value as object)) return "[CIRCULAR]";
  seen.add(value as object);
  if (Array.isArray(value)) return value.slice(0, 100).map((item) => safe(item, "", seen));
  return Object.fromEntries(Object.entries(value as Fields).map(([name, item]) => [name, safe(item, name, seen)]));
}

export function log(level: LogLevel, event: string, fields: Fields = {}) {
  const record = safe({ timestamp: new Date().toISOString(), level, event, service: "qwen38-api", ...fields });
  const line = JSON.stringify(record);
  if (level === "error") console.error(line);
  else if (level === "warn") console.warn(line);
  else console.info(line);
}

export const logger = {
  info: (event: string, fields?: Fields) => log("info", event, fields),
  warn: (event: string, fields?: Fields) => log("warn", event, fields),
  error: (event: string, fields?: Fields) => log("error", event, fields),
};

export function publicError(error: unknown): { error_name: string; error_message: string } {
  const value = error instanceof Error ? error : new Error(String(error));
  return safe({ error_name: value.name, error_message: value.message }) as { error_name: string; error_message: string };
}

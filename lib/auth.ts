import { randomBytes, scrypt as scryptCallback, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
import { admin } from "./supabase";
import { seal, unseal } from "./secureToken";
import { recordSecurityEvent } from "./securityEvents";

const scrypt = promisify(scryptCallback);
const COOKIE = "qwen_session";
const MAX_AGE = 60 * 60 * 24 * 30;
export type Role = "admin" | "user";
export interface User { id: string; username: string; role: Role; disabled: boolean; created_at: string; }
const USER_COLS = "id, username, role, disabled, created_at";

export async function hashPassword(password: string): Promise<string> {
  if (password.length < 10) throw new Error("Password must be at least 10 characters.");
  const salt = randomBytes(16).toString("hex");
  const key = await scrypt(password, salt, 64) as Buffer;
  return `scrypt:${salt}:${key.toString("hex")}`;
}
export async function verifyPassword(password: string, encoded: string): Promise<boolean> {
  const [kind, salt, expectedHex] = String(encoded).split(":");
  if (kind !== "scrypt" || !salt || !expectedHex) return false;
  const expected = Buffer.from(expectedHex, "hex");
  const actual = await scrypt(password, salt, expected.length) as Buffer;
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}
export function normalizeUsername(value: string): string {
  const username = value.trim().toLowerCase();
  if (!/^[a-z0-9][a-z0-9_.-]{2,31}$/.test(username)) throw new Error("Username must be 3-32 letters, numbers, dots, dashes, or underscores.");
  return username;
}
export interface Session { uid: string; iat: number; sid?: string; }
export const RECENT_LOGIN_MS = 15 * 60_000;
export function isRecentLogin(session: Session | null, now = Date.now()) {
  return Boolean(session && now >= session.iat && now - session.iat <= RECENT_LOGIN_MS);
}
export function sessionCookie(user: { id: string }, sid?: string): string {
  const secure = process.env.NODE_ENV === "production" ? " Secure;" : "";
  return `${COOKIE}=${seal({ uid: user.id, iat: Date.now(), sid })}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${MAX_AGE};${secure}`;
}
export function clearSessionCookie(): string {
  const secure = process.env.NODE_ENV === "production" ? " Secure;" : "";
  return `${COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0;${secure}`;
}
export function readSession(req: Request): Session | null {
  const match = (req.headers.get("cookie") || "").match(new RegExp(`(?:^|;\\s*)${COOKIE}=([^;]+)`));
  const value = match ? unseal<Session>(match[1]) : null;
  return value && typeof value.uid === "string" ? value : null;
}
export async function getUserById(id: string): Promise<User | null> {
  const { data } = await admin().from("users").select(USER_COLS).eq("id", id).maybeSingle();
  return data && !data.disabled ? data as User : null;
}
export async function currentUser(req: Request): Promise<User | null> {
  const session = readSession(req);
  return session ? getUserById(session.uid) : null;
}
export function isAdminRole(role: Role | null | undefined) { return role === "admin"; }
export async function requireAdmin(req: Request): Promise<{ user: User; response?: undefined } | { user?: undefined; response: Response }> {
  const user = await currentUser(req);
  const target = new URL(req.url).pathname;
  if (!user) { await Promise.allSettled([audit(null, "admin.access.denied", "route", target, { reason: "not_signed_in" }),recordSecurityEvent({type:"admin_access_denied",category:"authorization",severity:"medium",sourceIp:req.headers.get("x-client-ip"),requestId:req.headers.get("x-request-id"),route:target,details:{reason:"not_signed_in"}})]); return { response: Response.json({ error: "Not signed in." }, { status: 401 }) }; }
  if (user.role !== "admin") { await Promise.allSettled([audit(user.id, "admin.access.denied", "route", target, { reason: "insufficient_role" }),recordSecurityEvent({type:"admin_access_denied",category:"authorization",severity:"high",actorId:user.id,sourceIp:req.headers.get("x-client-ip"),requestId:req.headers.get("x-request-id"),route:target,details:{reason:"insufficient_role"}})]); return { response: Response.json({ error: "Admin access required." }, { status: 403 }) }; }
  return { user };
}
export async function authenticate(username: string, password: string): Promise<User | null> {
  let clean: string;
  try { clean = normalizeUsername(username); } catch { return null; }
  const { data } = await admin().from("users").select(`${USER_COLS}, password_hash`).eq("username", clean).maybeSingle();
  if (!data || data.disabled || !(await verifyPassword(password, data.password_hash))) return null;
  const { password_hash: _passwordHash, ...user } = data;
  return user as User;
}
export async function audit(actorId: string | null, action: string, targetType?: string, targetId?: string | null, details?: unknown) {
  await admin().from("admin_audit_logs").insert({ actor_id: actorId, action, target_type: targetType || null, target_id: targetId || null, details: details || {} });
}

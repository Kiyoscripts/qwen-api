// Lightweight custom auth: scrypt password hashing + signed (AES-GCM) session
// cookies. No Supabase Auth, no email verification, no session table.

import { scryptSync, randomBytes, timingSafeEqual } from "node:crypto";
import { admin } from "./supabase";
import { seal, unseal } from "./secureToken";

const COOKIE = "qwen_session";
const MAX_AGE = 60 * 60 * 24 * 30; // 30 days

// --- passwords --------------------------------------------------------------
export function hashPassword(pw: string): string {
  const salt = randomBytes(16);
  const hash = scryptSync(pw, salt, 32);
  return `scrypt$${salt.toString("hex")}$${hash.toString("hex")}`;
}
export function verifyPassword(pw: string, stored: string): boolean {
  const [scheme, saltHex, hashHex] = (stored || "").split("$");
  if (scheme !== "scrypt" || !saltHex || !hashHex) return false;
  try {
    const got = scryptSync(pw, Buffer.from(saltHex, "hex"), 32);
    const want = Buffer.from(hashHex, "hex");
    return got.length === want.length && timingSafeEqual(got, want);
  } catch {
    return false;
  }
}

// --- session cookie ---------------------------------------------------------
export interface Session {
  uid: string;
  email: string;
  iat: number;
}
export function sessionCookie(user: { id: string; email: string }): string {
  const token = seal({ uid: user.id, email: user.email, iat: Date.now() });
  const secure = process.env.NODE_ENV === "production" ? " Secure;" : "";
  return `${COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${MAX_AGE};${secure}`;
}
export function clearSessionCookie(): string {
  const secure = process.env.NODE_ENV === "production" ? " Secure;" : "";
  return `${COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0;${secure}`;
}
export function readSession(req: Request): Session | null {
  const cookie = req.headers.get("cookie") || "";
  const m = cookie.match(new RegExp(`(?:^|;\\s*)${COOKIE}=([^;]+)`));
  if (!m) return null;
  const s = unseal<Session>(m[1]);
  return s && typeof s.uid === "string" ? s : null;
}

// --- users ------------------------------------------------------------------
export interface User {
  id: string;
  email: string;
  created_at: string;
}
export function normalizeEmail(email: string): string {
  return String(email || "").trim().toLowerCase();
}
export function validEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

export async function getUserByEmail(email: string): Promise<{ id: string; email: string; password_hash: string } | null> {
  const { data } = await admin().from("users").select("id, email, password_hash").eq("email", normalizeEmail(email)).maybeSingle();
  return (data as any) || null;
}
export async function getUserById(id: string): Promise<User | null> {
  const { data } = await admin().from("users").select("id, email, created_at").eq("id", id).maybeSingle();
  return (data as any) || null;
}
export async function createUser(email: string, password: string): Promise<User> {
  const { data, error } = await admin()
    .from("users")
    .insert({ email: normalizeEmail(email), password_hash: hashPassword(password) })
    .select("id, email, created_at")
    .single();
  if (error) throw error;
  return data as User;
}

// Resolve the logged-in user from the request cookie (verifies they still exist).
export async function currentUser(req: Request): Promise<User | null> {
  const s = readSession(req);
  if (!s) return null;
  return getUserById(s.uid);
}

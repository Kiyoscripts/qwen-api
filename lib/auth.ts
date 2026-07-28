// Discord-based auth. Identity comes from Discord (via the /link bot flow). We
// store a high-entropy "login key" (hashed) per account; the user logs in with it.
// Sessions are signed (AES-GCM) cookies — no session table.

import { createHash, randomBytes } from "node:crypto";
import { admin } from "./supabase";
import { seal, unseal } from "./secureToken";

const COOKIE = "qwen_session";
const MAX_AGE = 60 * 60 * 24 * 30; // 30 days

export type Role = "owner" | "admin" | "member";

export interface User {
  id: string;
  discord_id: string | null;
  discord_username: string | null;
  discord_global_name: string | null;
  discord_avatar: string | null;
  discord_role: Role | null;
  created_at: string;
}

// --- login keys -------------------------------------------------------------
export function newLoginKey(): string {
  return "qkey_" + randomBytes(20).toString("hex");
}
export function hashLoginKey(key: string): string {
  return createHash("sha256").update(key.trim()).digest("hex");
}

// --- session cookie ---------------------------------------------------------
interface Session {
  uid: string;
  iat: number;
}
export function sessionCookie(user: { id: string }): string {
  const token = seal({ uid: user.id, iat: Date.now() });
  const secure = process.env.NODE_ENV === "production" ? " Secure;" : "";
  return `${COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${MAX_AGE};${secure}`;
}
export function clearSessionCookie(): string {
  const secure = process.env.NODE_ENV === "production" ? " Secure;" : "";
  return `${COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0;${secure}`;
}
function readSession(req: Request): Session | null {
  const cookie = req.headers.get("cookie") || "";
  const m = cookie.match(new RegExp(`(?:^|;\\s*)${COOKIE}=([^;]+)`));
  if (!m) return null;
  const s = unseal<Session>(m[1]);
  return s && typeof s.uid === "string" ? s : null;
}

const USER_COLS = "id, discord_id, discord_username, discord_global_name, discord_avatar, discord_role, created_at";

// --- users ------------------------------------------------------------------
export async function getUserById(id: string): Promise<User | null> {
  const { data } = await admin().from("users").select(USER_COLS).eq("id", id).maybeSingle();
  return (data as any) || null;
}

export async function currentUser(req: Request): Promise<User | null> {
  const s = readSession(req);
  if (!s) return null;
  return getUserById(s.uid);
}

// --- authorization ----------------------------------------------------------

/** Roles allowed into the admin dashboard and its API routes. */
export function isAdminRole(role: Role | null | undefined): boolean {
  return role === "owner" || role === "admin";
}

/**
 * Gate an admin-only route on the caller's account rather than a shared secret.
 *
 * A shared password is one credential for everyone: it cannot say who acted, it
 * cannot be revoked for one person, and it leaks permanently once pasted
 * anywhere. Roles come from the Discord link flow, so access follows the account
 * and disappears the moment the role is downgraded.
 *
 * Returns the user when authorised, otherwise the Response to send back:
 * 401 when nobody is signed in (the client should redirect to /login) and 403
 * when a real account simply lacks the role — collapsing those into one status
 * makes a permissions problem look like a broken session.
 */
export async function requireAdmin(
  req: Request
): Promise<{ user: User; response?: undefined } | { user?: undefined; response: Response }> {
  const user = await currentUser(req);
  if (!user) {
    return {
      response: Response.json({ error: "Not signed in.", type: "unauthenticated" }, { status: 401 }),
    };
  }
  if (!isAdminRole(user.discord_role)) {
    return {
      response: Response.json({ error: "Admin access required.", type: "forbidden" }, { status: 403 }),
    };
  }
  return { user };
}

// Find the account whose login key matches (for login).
export async function getUserByLoginKey(key: string): Promise<User | null> {
  const { data } = await admin().from("users").select(USER_COLS).eq("login_key_hash", hashLoginKey(key)).maybeSingle();
  return (data as any) || null;
}

export interface DiscordProfile {
  discord_id: string;
  discord_username?: string;
  discord_global_name?: string;
  discord_avatar?: string;
  discord_role?: Role;
}

// Create the account if new / refresh Discord fields if it exists, then set a
// fresh login key. Returns the account plus the RAW key (to DM once).
export async function linkDiscordAndIssueKey(p: DiscordProfile): Promise<{ user: User; loginKey: string }> {
  const loginKey = newLoginKey();
  const fields = {
    discord_id: p.discord_id,
    discord_username: p.discord_username ?? null,
    discord_global_name: p.discord_global_name ?? null,
    discord_avatar: p.discord_avatar ?? null,
    discord_role: (p.discord_role as string) ?? "member",
    login_key_hash: hashLoginKey(loginKey),
    updated_at: new Date().toISOString(),
  };

  const existing = await admin().from("users").select("id").eq("discord_id", p.discord_id).maybeSingle();
  let id: string;
  if (existing.data?.id) {
    id = existing.data.id;
    await admin().from("users").update(fields).eq("id", id);
  } else {
    const { data, error } = await admin().from("users").insert(fields).select("id").single();
    if (error) throw error;
    id = data.id;
  }
  const user = (await getUserById(id))!;
  return { user, loginKey };
}

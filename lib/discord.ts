// Server-side helpers for the Discord link flow. Link codes live in Supabase;
// DMs are sent by calling the bot's HTTP endpoint (shared secret).

import { randomBytes } from "node:crypto";
import { admin } from "./supabase";
import { CANONICAL_URL } from "./canonicalHost";
import type { DiscordProfile, Role } from "./auth";

const CODE_TTL_MS = 10 * 60 * 1000; // 10 minutes

// Bot -> site: the bot calls POST /api/discord/code to register a code.
export async function createLinkCode(p: DiscordProfile): Promise<string> {
  // Unambiguous code (no 0/O/1/I), e.g. "QW-7F3K9X".
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let code = "QW-";
  const b = randomBytes(6);
  for (let i = 0; i < 6; i++) code += alphabet[b[i] % alphabet.length];

  await admin().from("discord_link_codes").insert({
    code,
    discord_id: p.discord_id,
    discord_username: p.discord_username ?? null,
    discord_global_name: p.discord_global_name ?? null,
    discord_avatar: p.discord_avatar ?? null,
    discord_role: (p.discord_role as string) ?? "member",
    expires_at: new Date(Date.now() + CODE_TTL_MS).toISOString(),
  });
  return code;
}

// Consume a code (single use): returns the Discord profile or null if invalid/expired.
export async function consumeLinkCode(code: string): Promise<DiscordProfile | null> {
  const clean = code.trim().toUpperCase();
  const { data } = await admin().from("discord_link_codes").select("*").eq("code", clean).maybeSingle();
  if (!data) return null;
  // Delete it regardless (single use).
  await admin().from("discord_link_codes").delete().eq("code", clean);
  if (new Date(data.expires_at).getTime() < Date.now()) return null;
  return {
    discord_id: data.discord_id,
    discord_username: data.discord_username,
    discord_global_name: data.discord_global_name,
    discord_avatar: data.discord_avatar,
    discord_role: (data.discord_role || "member") as Role,
  };
}

// Queue a DM for the bot to send (the bot polls /api/discord/outbox). Clears any
// older pending DM to the same user so only the newest key is delivered.
export async function queueDM(discordId: string, message: string): Promise<void> {
  await admin().from("discord_dm_queue").delete().eq("discord_id", discordId).eq("status", "pending");
  await admin().from("discord_dm_queue").insert({ discord_id: discordId, message, status: "pending" });
}

// --- bot polling helpers (used by /api/discord/outbox) ---------------------
// Atomically CLAIM pending DMs: flip them pending -> sending and return them, so
// two overlapping polls can never grab the same row (no double-sends). Rows stuck
// in "sending" for >2 min (bot crashed mid-send) are reclaimed first.
export async function claimPendingDMs(): Promise<{ id: string; discord_id: string; message: string }[]> {
  const staleCutoff = new Date(Date.now() - 2 * 60 * 1000).toISOString();
  await admin().from("discord_dm_queue").update({ status: "pending" }).eq("status", "sending").lt("updated_at", staleCutoff);

  const { data } = await admin()
    .from("discord_dm_queue")
    .update({ status: "sending", updated_at: new Date().toISOString() })
    .eq("status", "pending")
    .select("id, discord_id, message");
  return (data as any[]) || [];
}
export async function ackDM(id: string, status: "sent" | "dms_closed" | "failed"): Promise<void> {
  await admin().from("discord_dm_queue").update({ status, updated_at: new Date().toISOString() }).eq("id", id);
}
// Latest delivery status for a user's most recent DM (for the UI to poll).
export async function latestDMStatus(discordId: string): Promise<string | null> {
  const { data } = await admin()
    .from("discord_dm_queue")
    .select("status")
    .eq("discord_id", discordId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  return (data as any)?.status ?? null;
}

const LOGIN_MSG = (key: string) =>
  [
    "**Your Syde login key** 🔑",
    "",
    // Says where to go, not just what to do with it. The previous wording read
    // "use this on the site" and named no address, so anyone who had closed the
    // tab had to work out where to return to.
    `Go to <${CANONICAL_URL}/login> and open the **Use a key** tab, then paste this in.`,
    "```",
    key,
    "```",
    "Treat it like a password. Anyone with it can reach your account.",
    "Lost it? Run `/link` again for a fresh one, which retires the old key.",
  ].join("\n");

export function loginKeyDM(key: string): string {
  return LOGIN_MSG(key);
}

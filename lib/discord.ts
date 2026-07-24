// Server-side helpers for the Discord link flow. Link codes live in Supabase;
// DMs are sent by calling the bot's HTTP endpoint (shared secret).

import { randomBytes } from "node:crypto";
import { admin } from "./supabase";
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

// Ask the bot to DM a user. Returns whether it landed (false ~ DMs closed).
export async function botDM(discordId: string, message: string): Promise<{ ok: boolean; reason?: string }> {
  const url = process.env.BOT_URL;
  const secret = process.env.LINK_BOT_SECRET;
  if (!url || !secret) return { ok: false, reason: "bot_not_configured" };
  try {
    const r = await fetch(`${url.replace(/\/$/, "")}/dm`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${secret}` },
      body: JSON.stringify({ discord_id: discordId, message }),
    });
    const j = await r.json().catch(() => ({}));
    return { ok: Boolean(j.ok), reason: j.reason };
  } catch {
    return { ok: false, reason: "bot_unreachable" };
  }
}

const LOGIN_MSG = (key: string) =>
  [
    "**Your Qwen3.8 API login key** 🔑",
    "",
    "Use this on the site to log in. Treat it like a password — anyone with it can access your account.",
    "```",
    key,
    "```",
    "Lost it? Just run `/link` again to get a fresh one (the old key stops working).",
  ].join("\n");

export function loginKeyDM(key: string): string {
  return LOGIN_MSG(key);
}

// Regenerates railway.env.json (gitignored) from .env.local, so real secrets can
// be pasted into a host dashboard without ever passing through a chat or a commit.
import { readFileSync, writeFileSync } from "node:fs";

const env = {};
for (const line of readFileSync(".env.local", "utf8").split("\n")) {
  const t = line.trim();
  if (!t || t.startsWith("#") || !t.includes("=")) continue;
  const i = t.indexOf("=");
  env[t.slice(0, i).trim()] = t.slice(i + 1).trim().replace(/^["']|["']$/g, "");
}

const REQUIRED = ["QWEN_TOKEN", "SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY", "SUPABASE_ANON_KEY",
                  "SUPABASE_PUBLISHABLE_KEY", "ADMIN_SECRET", "LINK_BOT_SECRET"];
const DEFAULTS = { QWEN_SHOW_REASONING: "true", QWEN_FORGET_MEMORIES: "true" };
const OPTIONAL = ["QWEN_CLIENT_VERSION", "QWEN_USER_AGENT", "QWEN_EXTRA_COOKIES", "QWEN_MEDIA_MODEL", "QWEN_TTS_MODEL", "ENABLE_VIDEO_GENERATION",
                  "PUBLIC_KEY_CREATION", "KEY_RL_PER_IP_HOUR",
                  "KEY_RL_PER_IP_DAY", "KEY_BLACKLIST_THRESHOLD", "KEY_RL_GLOBAL_HOUR", "CRON_SECRET",
                  "TOKENROUTER_API_KEY", "TOKENROUTER_BASE",
                  "OPENCODE_ZEN_API_KEY", "OPENCODE_ZEN_BASE", "OPENCODE_ZEN_TIMEOUT_MS",
                  "SOLAR_DISABLED", "SOLAR_BASE", "SOLAR_TIMEOUT_MS", "SOLAR_IDLE_MS", "SOLAR_CITATIONS",
                  "NVIDIA_API_KEY", "NVIDIA_BASE", "NVIDIA_TIMEOUT_MS", "NVIDIA_IDLE_MS",
                  "CHATGLM_DISABLED", "CHATGLM_BASE", "CHATGLM_TIMEOUT_MS", "CHATGLM_IDLE_MS",
                  "CHATGLM_SALT", "CHATGLM_EXP_GROUPS", "CHATGLM_IMAGES_DISABLED",
                  "SOLAR_PROXY", "CHATGLM_PROXY"];

// The Discord bot ships in the same image, so its config belongs in the same
// paste. Copied only when present rather than placeholdered like REQUIRED: a
// bogus DISCORD_TOKEN makes the bot crash-loop, whereas an absent one makes the
// supervisor skip it cleanly and run the site alone. SITE_URL is deliberately
// absent — the supervisor points the bot at the site's own loopback address.
const BOT = ["DISCORD_TOKEN", "DISCORD_GUILD_ID", "WHITELIST_CHANNEL", "PUBLIC_SITE_URL"];

const out = {};
const missing = [];
for (const k of REQUIRED) {
  if (env[k]) out[k] = env[k];
  else { missing.push(k); out[k] = "<<SET ME — not found in .env.local>>"; }
}
for (const [k, d] of Object.entries(DEFAULTS)) out[k] = env[k] ?? d;
for (const k of OPTIONAL) if (env[k]) out[k] = env[k];
for (const k of BOT) if (env[k]) out[k] = env[k];

writeFileSync("railway.env.json", JSON.stringify(out, null, 2) + "\n");
console.log(`wrote railway.env.json — ${Object.keys(out).length} variables`);
if (missing.length) console.log("NEEDS FILLING IN:", missing.join(", "));
if (!env.DISCORD_TOKEN) {
  console.log("NOTE: no DISCORD_TOKEN in .env.local — the deploy will run the site without the link bot.");
} else if (!env.DISCORD_GUILD_ID) {
  console.log("NOTE: no DISCORD_GUILD_ID — /link registers globally and can take an hour to appear.");
}
console.log("PORT is intentionally absent: Railway injects it.");

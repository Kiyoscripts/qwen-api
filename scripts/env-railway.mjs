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
const OPTIONAL = ["QWEN_CLIENT_VERSION", "QWEN_MEDIA_MODEL", "QWEN_TTS_MODEL", "ENABLE_VIDEO_GENERATION",
                  "DEEPSEEK_TOKEN", "DEEPSEEK_CLIENT_VERSION", "PUBLIC_KEY_CREATION", "KEY_RL_PER_IP_HOUR",
                  "KEY_RL_PER_IP_DAY", "KEY_BLACKLIST_THRESHOLD", "KEY_RL_GLOBAL_HOUR", "CRON_SECRET"];

const out = {};
const missing = [];
for (const k of REQUIRED) {
  if (env[k]) out[k] = env[k];
  else { missing.push(k); out[k] = "<<SET ME — not found in .env.local>>"; }
}
for (const [k, d] of Object.entries(DEFAULTS)) out[k] = env[k] ?? d;
for (const k of OPTIONAL) if (env[k]) out[k] = env[k];

writeFileSync("railway.env.json", JSON.stringify(out, null, 2) + "\n");
console.log(`wrote railway.env.json — ${Object.keys(out).length} variables`);
if (missing.length) console.log("NEEDS FILLING IN:", missing.join(", "));
console.log("PORT is intentionally absent: Railway injects it.");

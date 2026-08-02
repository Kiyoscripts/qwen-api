// VENDORED from /Users/manoli/Documents/Qwen38_LinkAPI/index.js so it can run inside
// the deployed web service (Railway has only this repo). Keep in sync with the
// source bot; runtime env: DISCORD_TOKEN, SITE_URL, LINK_BOT_SECRET, WHITELIST_CHANNEL.
//
// Qwen3.8 API — Discord link bot.
//
//  /link           -> asks the site for a one-time code, shows it to the user.
//  DM delivery     -> the bot POLLS the site for login-key DMs to send.
//
// Everything is OUTBOUND (Discord + the website), so the bot needs no public URL,
// no open ports, no tunnel — it can run on your own PC or any free host.

import "dotenv/config";
import { Client, GatewayIntentBits, PermissionsBitField, MessageFlags } from "discord.js";
import { publicSiteUrl, isLoopback } from "./publicUrl.mjs";

const {
  DISCORD_TOKEN,
  SITE_URL,
  LINK_BOT_SECRET,
  WHITELIST_CHANNEL, // optional: /link only works here; other messages get deleted
  DISCORD_GUILD_ID,  // optional: register commands here instead of globally
} = process.env;

for (const [k, v] of Object.entries({ DISCORD_TOKEN, SITE_URL, LINK_BOT_SECRET })) {
  if (!v) { console.error(`Missing env var: ${k}`); process.exit(1); }
}
const SITE = SITE_URL.replace(/\/$/, "");
// Where the bot's own requests go (loopback inside the container) and where it
// sends people are separate concerns; see publicUrl.mjs.
const PUBLIC_SITE = publicSiteUrl(process.env) || SITE;
const auth = { Authorization: `Bearer ${LINK_BOT_SECRET}` };

// ---------------------------------------------------------------------------
// Discord client — GuildMessages lets us auto-delete chatter in the link channel.
// ---------------------------------------------------------------------------
const client = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages] });

// ---------------------------------------------------------------------------
// Slash commands.
//
// Discord only surfaces commands that have been registered with it — listening
// for the interaction is not enough, which is why a bot can sit online showing
// no commands at all. Registration is done on every startup rather than by a
// separate deploy script, so a fresh deploy can never leave the two out of step.
// The call is idempotent: `set` replaces the list with exactly this array.
// ---------------------------------------------------------------------------
const COMMANDS = [
  { name: "link", description: "Get a one-time code to link your Discord to Qwen3.8 API" },
];

async function registerCommands() {
  try {
    if (DISCORD_GUILD_ID) {
      // Guild commands appear the moment they are registered. Global ones can
      // take up to an hour to propagate, which reads exactly like a broken bot.
      await client.application.commands.set(COMMANDS, DISCORD_GUILD_ID);
      console.log(`✓ Registered /link in guild ${DISCORD_GUILD_ID} — available immediately`);
    } else {
      await client.application.commands.set(COMMANDS);
      console.log("✓ Registered /link globally — Discord may take up to an hour to show it");
      console.log("  Set DISCORD_GUILD_ID to your server's id to register instantly instead.");
    }
  } catch (e) {
    // Never fatal: the outbox poll still delivers login keys without commands.
    console.error("✗ Could not register slash commands:", e.message);
    console.error("  The bot's invite link needs the applications.commands scope.");
  }
}

client.once("clientReady", async () => {
  console.log(`✓ Logged in as ${client.user.tag}`);
  // A loopback address in the reply sends people to their own machine, and the
  // bot otherwise looks like it is working perfectly. Say so at boot.
  if (isLoopback(PUBLIC_SITE)) {
    console.error(`✗ Links shown to users would point at ${PUBLIC_SITE}, which only resolves inside this container.`);
    console.error("  Set PUBLIC_SITE_URL to the site's public address (Railway normally supplies RAILWAY_PUBLIC_DOMAIN).");
  } else {
    console.log(`✓ Links shown to users point at ${PUBLIC_SITE}`);
  }
  await registerCommands();
  console.log("✓ Polling the site for login-key DMs…");
  setInterval(pollOutbox, 4000);
});

// /link -> get a code from the site
client.on("interactionCreate", async (i) => {
  if (!i.isChatInputCommand() || i.commandName !== "link") return;

  if (WHITELIST_CHANNEL && i.channelId !== WHITELIST_CHANNEL) {
    return i.reply({ content: `Please use \`/link\` in <#${WHITELIST_CHANNEL}>.`, flags: MessageFlags.Ephemeral });
  }
  await i.deferReply({ flags: MessageFlags.Ephemeral });

  let role = "member";
  try {
    if (i.guild && i.guild.ownerId === i.user.id) role = "owner";
    else if (i.memberPermissions?.has(PermissionsBitField.Flags.Administrator)) role = "admin";
  } catch { /* member */ }

  try {
    const r = await fetch(`${SITE}/api/discord/code`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...auth },
      body: JSON.stringify({
        discord_id: i.user.id,
        username: i.user.username,
        global_name: i.user.globalName || i.user.username,
        avatar: i.user.displayAvatarURL({ extension: "png", size: 128 }),
        role,
      }),
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok || !j.code) throw new Error(j.error || "no code");
    await i.editReply(
      `**Your link code:**  \`${j.code}\`\n` +
      `Go to <${PUBLIC_SITE}/login> → **Link Discord** tab → paste the code.\n` +
      `We'll DM you a login key. (Code expires in 10 minutes.)`
    );
  } catch (e) {
    console.error("link error:", e.message);
    await i.editReply("Couldn't create a code right now — try again in a moment.");
  }
});

// Keep the link channel command-only.
client.on("messageCreate", async (msg) => {
  if (!WHITELIST_CHANNEL || msg.channelId !== WHITELIST_CHANNEL) return;
  if (msg.author.bot) return;
  try {
    await msg.delete();
    const warn = await msg.channel.send(`<@${msg.author.id}> this channel is for \`/link\` only.`);
    setTimeout(() => warn.delete().catch(() => {}), 5000);
  } catch { /* missing Manage Messages, or already gone */ }
});

// ---------------------------------------------------------------------------
// Outbox polling: fetch queued DMs from the site, send them, report the result.
// ---------------------------------------------------------------------------
let lastPollError = "";
let polling = false;
async function pollOutbox() {
  if (polling) return; // don't let a slow poll overlap the next tick
  polling = true;
  try {
    await doPoll();
  } finally {
    polling = false;
  }
}
async function doPoll() {
  let dms;
  try {
    const r = await fetch(`${SITE}/api/discord/outbox`, { headers: auth });
    if (!r.ok) {
      const msg = `outbox poll -> HTTP ${r.status}` +
        (r.status === 401 ? " (LINK_BOT_SECRET doesn't match the site, or site not redeployed)" : "") +
        (r.status === 404 ? " (site missing /api/discord/outbox — redeploy the site)" : "");
      if (msg !== lastPollError) { console.error("✗ " + msg); lastPollError = msg; }
      return;
    }
    lastPollError = "";
    ({ dms } = await r.json());
  } catch (e) {
    if (lastPollError !== e.message) { console.error("✗ outbox poll network error:", e.message); lastPollError = e.message; }
    return;
  }

  if (!dms || dms.length === 0) return;
  console.log(`→ ${dms.length} DM(s) queued to send`);
  for (const dm of dms) {
    let status = "sent";
    try {
      const user = await client.users.fetch(String(dm.discord_id));
      await user.send(String(dm.message));
      console.log(`  ✓ sent login key to ${dm.discord_id}`);
    } catch (e) {
      status = "dms_closed"; // 50007: can't DM this user (DMs off)
      console.log(`  ✗ couldn't DM ${dm.discord_id} — code ${e.code || "?"} (their DMs are likely off)`);
    }
    await fetch(`${SITE}/api/discord/outbox`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...auth },
      body: JSON.stringify({ id: dm.id, status }),
    }).catch(() => {});
  }
}

client.login(DISCORD_TOKEN);

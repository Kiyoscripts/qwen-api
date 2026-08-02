// Run the Next.js site and the vendored Discord link bot as one process group,
// so "the site is running" implies "the bot is running" — in dev and in prod.
//
//   node scripts/supervise.mjs dev     -> next dev   + bot
//   node scripts/supervise.mjs start   -> next start + bot   (Railway)
//
// Design rules, in order of importance:
//  - The WEB is primary. If it exits, the supervisor exits with its code and the
//    bot is torn down. Railway restarts the service; both come back together.
//  - The BOT is auxiliary. It must never be able to take the site down: if it is
//    unconfigured it is skipped, and if it crashes it is restarted with backoff
//    rather than propagated. A link bot falling over is not a reason to 502 the API.
//  - Signals fan out to both children so Ctrl-C / SIGTERM stop everything cleanly.

import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { config as loadEnv } from "dotenv";

// Load env the way Next does, so the bot's config (DISCORD_TOKEN, LINK_BOT_SECRET,
// …) is visible to THIS process and inherited by both children. Real environment
// vars — how Railway injects them in production — always win; these only fill dev.
loadEnv({ path: ".env.local" });
loadEnv({ path: ".env" });

const mode = process.argv[2] === "start" ? "start" : "dev";
const nextBin = "./node_modules/.bin/next";
const PORT = process.env.PORT || "3000";

/** Prefix a child's output so two logs in one terminal stay legible. */
function pipe(child, tag, color) {
  const paint = (line) => `${color}[${tag}]\x1b[0m ${line}`;
  for (const stream of [child.stdout, child.stderr]) {
    let buf = "";
    stream.on("data", (d) => {
      buf += d.toString();
      const lines = buf.split("\n");
      buf = lines.pop() ?? "";
      for (const l of lines) process.stdout.write(paint(l) + "\n");
    });
  }
}

const children = new Set();
let shuttingDown = false;

function stopAll(signal = "SIGTERM") {
  shuttingDown = true;
  for (const c of children) c.kill(signal);
}

// --- web (primary) ---------------------------------------------------------
const web = spawn(nextBin, [mode === "start" ? "start" : "dev", "-p", PORT], {
  env: process.env,
  stdio: ["inherit", "pipe", "pipe"],
});
children.add(web);
pipe(web, "web", "\x1b[36m"); // cyan
web.on("exit", (code, signal) => {
  children.delete(web);
  if (shuttingDown) return;
  // Primary is gone — take the bot with it and surface the code to Railway.
  console.log(`\x1b[36m[web]\x1b[0m exited (code ${code ?? signal}); stopping bot`);
  stopAll();
  process.exit(code ?? 1);
});

// --- bot (auxiliary) -------------------------------------------------------
// Skipped without a token, so an unconfigured deploy runs the site alone rather
// than crash-looping. SITE_URL defaults to the site's own loopback in prod.
function startBot() {
  if (shuttingDown) return;
  if (!process.env.DISCORD_TOKEN) {
    console.log("\x1b[35m[bot]\x1b[0m DISCORD_TOKEN not set — link bot disabled, site runs alone");
    return;
  }
  if (!existsSync("linkbot/index.mjs")) {
    console.log("\x1b[35m[bot]\x1b[0m linkbot/index.mjs missing — skipping");
    return;
  }
  const bot = spawn(process.execPath, ["linkbot/index.mjs"], {
    env: { ...process.env, SITE_URL: process.env.SITE_URL || `http://127.0.0.1:${PORT}` },
    stdio: ["inherit", "pipe", "pipe"],
  });
  children.add(bot);
  pipe(bot, "bot", "\x1b[35m"); // magenta
  bot.on("exit", (code, signal) => {
    children.delete(bot);
    if (shuttingDown) return;
    // Auxiliary: log and restart with a fixed backoff, never propagate.
    console.log(`\x1b[35m[bot]\x1b[0m exited (code ${code ?? signal}); restarting in 10s`);
    setTimeout(startBot, 10_000);
  });
}
startBot();

for (const sig of ["SIGINT", "SIGTERM"]) {
  process.on(sig, () => {
    stopAll(sig);
    setTimeout(() => process.exit(0), 500);
  });
}

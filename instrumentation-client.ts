import { initBotId } from "botid/client/core";

// Attach BotID's client challenge to key creation so only real browser sessions
// (the website's "Generate key" button) can hit it — scripted/curl requests get
// classified as bots and blocked server-side by checkBotId().
initBotId({
  protect: [{ path: "/api/keys", method: "POST" }],
});

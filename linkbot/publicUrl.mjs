// Which URL to show a human.
//
// The address the bot *calls* and the address a user can *open* are not the same
// thing. Bot and site share a container, so the supervisor points the bot at
// http://127.0.0.1:$PORT — correct for its own fetches, and meaningless in a
// Discord message, where it sends people to their own machine.
//
// Precedence, most explicit first:
//   1. PUBLIC_SITE_URL      an operator override, always wins
//   2. RAILWAY_PUBLIC_DOMAIN  injected by Railway; matches the canonical host,
//                             so the deploy configures itself
//   3. SITE_URL             the bot running somewhere the first two do not
//                           exist, e.g. a dev machine aimed at the real site
//
// The canonical host is deliberately not hardcoded here. It already lives in
// lib/canonicalHost.ts, which this file cannot import (that is TypeScript, and
// the bot runs as plain ESM), and a second copy would be free to drift.

/** True for addresses that only resolve on the machine the bot runs on. */
export function isLoopback(url) {
  return /^https?:\/\/(127\.0\.0\.1|localhost|0\.0\.0\.0|\[::1\])(:|\/|$)/i.test(url);
}

/**
 * The site URL to put in front of users.
 *
 * @param env  process.env, or any equivalent map.
 * @returns    the URL without a trailing slash, or "" if nothing is set.
 */
export function publicSiteUrl(env = process.env) {
  const explicit = env.PUBLIC_SITE_URL?.trim();
  const railway = env.RAILWAY_PUBLIC_DOMAIN?.trim();
  const fallback = env.SITE_URL?.trim();

  const chosen =
    explicit ||
    // Railway gives a bare domain, not a URL.
    (railway ? (/^https?:\/\//i.test(railway) ? railway : `https://${railway}`) : "") ||
    fallback ||
    "";

  return chosen.replace(/\/+$/, "");
}

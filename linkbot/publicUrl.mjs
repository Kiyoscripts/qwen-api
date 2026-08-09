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
// The canonical host was deliberately not hardcoded here, to avoid a second
// copy of what lib/canonicalHost.ts already owns. That held until the site
// moved: the bot service still had the old domain in its environment, so every
// /link reply sent people to a host Railway no longer routes, and no amount of
// correct code here could tell. Environment wins over code by design, which is
// the right rule until the value is provably dead.
//
// So the copy exists now, used for exactly two things: rewriting a retired host,
// and standing in when nothing is configured at all. Both are cases where an
// address is known to be wrong, and a wrong address is worse than a duplicated
// constant. When the domain changes again, this list is the thing to update.

const CANONICAL = "https://syde.up.railway.app";

/** Hosts that used to serve the site and no longer resolve. */
const RETIRED = new Set(["qwen38-api-production.up.railway.app"]);

/** Add a scheme if the value is a bare domain. Only RAILWAY_PUBLIC_DOMAIN was
    normalised before, so a bare host in SITE_URL stayed schemeless and slipped
    past the retired-host check below. */
function withScheme(url) {
  return /^https?:\/\//i.test(url) ? url : `https://${url}`;
}

/** The host part of a URL, or "" if it does not parse. */
function hostOf(url) {
  try {
    return new URL(url).host.toLowerCase();
  } catch {
    return "";
  }
}

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

  const url = chosen ? withScheme(chosen.replace(/\/+$/, "")) : "";

  // Nothing configured, or configured to somewhere that is gone. Either way the
  // canonical host is the only address that can actually be opened.
  if (!url) return CANONICAL;
  if (RETIRED.has(hostOf(url))) return CANONICAL;
  return url;
}

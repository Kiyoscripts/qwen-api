// Outbound proxying, for the providers whose upstreams refuse datacenter IPs.
//
// Solar and chatglm.cn's image models both work from a residential connection
// and fail from a cloud one — Solar with a 403 at /api/session, chatglm with a
// draw that returns an empty run. Nothing about the request is wrong, so the
// only fix is to leave the datacenter: route those calls through a residential
// proxy (Webshare and friends) and the upstream sees an acceptable address.
//
// Both the plain fetches and the WebSocket go through the same dispatcher.
// undici tunnels HTTPS and WSS over CONNECT, so one HTTP proxy URL covers
// every call a provider makes, credentials included:
//
//   SOLAR_PROXY=http://user:pass@p.webshare.io:80
//
// A provider falls back to direct egress when its variable is unset, which is
// what a local machine wants — the proxy is only needed where the plain IP is
// refused.

import { ProxyAgent } from "undici";

/** One agent per proxy URL: each holds a connection pool worth reusing. */
const agents = new Map<string, ProxyAgent>();

/**
 * A dispatcher for the given proxy URL, or undefined to go direct.
 *
 * Returns undefined rather than throwing on a malformed URL: a typo in an
 * optional env var should degrade to direct egress (and log), not take the
 * whole provider down at import time.
 */
export function proxyDispatcher(proxyUrl: string | undefined | null): ProxyAgent | undefined {
  const url = (proxyUrl || "").trim();
  if (!url) return undefined;

  const cached = agents.get(url);
  if (cached) return cached;

  try {
    // undici reads any user:pass in the URL and sends Proxy-Authorization, so
    // credentials never need to be split out by hand.
    const agent = new ProxyAgent(url);
    agents.set(url, agent);
    return agent;
  } catch (e: any) {
    console.error(`[egress] ignoring malformed proxy URL: ${e?.message || e}`);
    return undefined;
  }
}

/**
 * Merge a dispatcher into fetch options.
 *
 * `dispatcher` is undici's own extension to RequestInit, which the DOM typings
 * do not describe — hence the cast rather than a wider type.
 */
export function withProxy<T extends Record<string, unknown>>(
  init: T,
  proxyUrl: string | undefined | null
): T {
  const dispatcher = proxyDispatcher(proxyUrl);
  return dispatcher ? ({ ...init, dispatcher } as unknown as T) : init;
}

/**
 * Parse a proxy setting into a list of URLs.
 *
 * Accepts one proxy or many, separated by newlines or commas, in either form:
 *
 *   http://user:pass@host:port     what undici wants
 *   host:port:user:pass            what Webshare's dashboard exports
 *   host:port                      no credentials
 *
 * The middle one is there because it is what a downloaded proxy list actually
 * contains, and re-typing a hundred of them into URL form is how mistakes get
 * made. Anything unparseable is skipped rather than failing the whole list.
 */
export function parseProxyList(raw: string | undefined | null): string[] {
  const out: string[] = [];
  for (const partRaw of (raw || "").split(/[\n,]+/)) {
    const part = partRaw.trim();
    if (!part) continue;

    if (/^[a-z0-9+.-]+:\/\//i.test(part)) {
      out.push(part);
      continue;
    }
    const bits = part.split(":");
    if (bits.length === 4) {
      const [host, port, user, pass] = bits;
      out.push(`http://${encodeURIComponent(user)}:${encodeURIComponent(pass)}@${host}:${port}`);
    } else if (bits.length === 2) {
      out.push(`http://${part}`);
    }
  }
  return out;
}

/**
 * A rotating set of proxies.
 *
 * One proxy is not enough in practice: of a sample of Webshare's pool, a third
 * were refused by Upstage and the rest were fine, so a single fixed address is
 * a coin flip that looks like "proxies don't work". The pool sticks to whichever
 * proxy last succeeded — rotating per request would waste the good ones — and
 * only advances when the caller reports a failure.
 */
export class ProxyPool {
  private readonly urls: string[];
  private i = 0;

  constructor(raw: string | undefined | null) {
    this.urls = parseProxyList(raw);
  }

  get size(): number {
    return this.urls.length;
  }

  /** The proxy in use, or undefined for direct egress. */
  current(): string | undefined {
    return this.urls[this.i];
  }

  /** Give up on the current proxy and move to the next. */
  rotate(): void {
    if (this.urls.length > 1) this.i = (this.i + 1) % this.urls.length;
  }

  /** How many attempts are worth making before concluding it is not the proxy. */
  attempts(max = 5): number {
    return Math.max(1, Math.min(this.urls.length || 1, max));
  }
}

/** Host and port only — safe to log, unlike the credentials in the URL. */
export function proxyLabel(proxyUrl: string | undefined | null): string {
  const url = (proxyUrl || "").trim();
  if (!url) return "direct";
  try {
    const u = new URL(url);
    return `${u.hostname}:${u.port || "80"}`;
  } catch {
    return "invalid";
  }
}

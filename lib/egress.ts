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

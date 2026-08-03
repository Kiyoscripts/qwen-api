// Outbound proxy rotation for chat.qwen.ai calls.
//
// Qwen rate-limits upstream requests per IP. A server behind a single egress IP
// therefore gets throttled as soon as traffic spikes, and the throttling is
// shared across every account the pool proxies. Routing each request through a
// different HTTP proxy IP spreads the load so one burst does not trip the
// limits — this is what the `user:pass@host:port` proxy list in `proxies.txt`
// (or `QWEN_PROXIES`) provides.
//
// Entries are used round-robin. A proxy that fails (network error) or that the
// upstream throttled (429 / 5xx) is parked on a cooldown instead of being hit
// again. If no proxies are configured the module degrades to a plain pass-
// through, so nothing about the API changes until a list is supplied.

import { readFileSync } from "node:fs";
import { ProxyAgent, fetch as undiciFetch, type Response as UndiciResponse } from "undici";

const PROXY_FILE = "proxies.txt";
const COOLDOWN_MS = (() => {
  const n = Number(process.env.QWEN_PROXY_COOLDOWN_MS);
  return Number.isFinite(n) && n > 0 ? n : 60_000;
})();
const ATTEMPTS = (() => {
  const n = Number(process.env.QWEN_PROXY_ATTEMPTS);
  return Number.isFinite(n) && n > 0 ? n : 3;
})();

/** Parse a whitespace/comma separated proxy list into `http(s)://` URIs. */
export function parseProxies(text: string): string[] {
  return [
    ...new Set(
      text
        .split(/[\s,]+/)
        .map((line) => line.trim())
        .filter((line) => line && !line.startsWith("#") && !line.startsWith("//"))
        .map((line) => (/^https?:\/\//i.test(line) ? line : `http://${line}`))
    ),
  ];
}

let cached: string[] | null = null;
function loadProxies(): string[] {
  if (cached) return cached;
  let text = process.env.QWEN_PROXIES || "";
  if (!text) {
    try {
      text = readFileSync(PROXY_FILE, "utf8");
    } catch {
      /* no proxies.txt — caller falls back to a direct request */
      text = "";
    }
  }
  cached = parseProxies(text);
  return cached;
}

let cursor = 0;
let cooldownUntil = new Map<string, number>();
const agents = new Map<string, ProxyAgent>();

function agentFor(proxy: string): ProxyAgent {
  let a = agents.get(proxy);
  if (!a) {
    a = new ProxyAgent({ uri: proxy });
    agents.set(proxy, a);
  }
  return a;
}

function markCooldown(proxy: string) {
  cooldownUntil.set(proxy, Date.now() + COOLDOWN_MS);
}

/** Next usable proxy, round-robin, skipping anything currently on cooldown. */
function pickProxy(now: number): string | null {
  const pool = loadProxies();
  if (!pool.length) return null;
  for (let i = 0; i < pool.length; i++) {
    const idx = (cursor + i) % pool.length;
    const p = pool[idx];
    if ((cooldownUntil.get(p) || 0) <= now) {
      cursor = (idx + 1) % pool.length;
      return p;
    }
  }
  // Every proxy is parked (e.g. the whole list was just rate-limited). Give the
  // rotation another lap rather than hard-failing the request.
  const p = pool[cursor % pool.length];
  cursor = (cursor + 1) % pool.length;
  return p;
}

const RETRYABLE = new Set([429, 500, 502, 503, 504]);

function proxiesConfigured(): boolean {
  return loadProxies().length > 0;
}

/**
 * Drop-in `fetch` replacement that spins each request onto a rotating proxy.
 * Falls back to a direct request when no proxy list is configured, or when the
 * whole pool is exhausted — a proxy outage must never take the API server itself
 * down.
 */
export async function qwenFetch(url: string | URL, init: RequestInit = {}): Promise<UndiciResponse> {
  if (!proxiesConfigured()) return undiciFetch(url, init as never);
  let lastError: unknown;
  for (let attempt = 0; attempt < ATTEMPTS; attempt++) {
    const proxy = pickProxy(Date.now());
    if (!proxy) break;
    const dispatcher = agentFor(proxy);
    try {
      const res = await undiciFetch(url, { ...init, dispatcher } as never);
      if (RETRYABLE.has(res.status)) markCooldown(proxy);
      return res;
    } catch (e) {
      markCooldown(proxy);
      lastError = e;
    }
  }
  // Proxy pool exhausted — last resort is a direct request, so a dead proxy list
  // can't black-hole the API. Rate limits may bite, but a working call beats none.
  try {
    return await undiciFetch(url, init as never);
  } catch (e) {
    throw lastError ?? e;
  }
}
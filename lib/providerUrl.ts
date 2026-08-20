import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { Agent, buildConnector, fetch as undiciFetch } from "undici";

const PRIVATE_PROVIDER_URLS = "ALLOW_PRIVATE_PROVIDER_URLS";

function blockedV4(ip: string) {
  const p = ip.split(".").map(Number);
  return p[0] === 0 || p[0] === 10 || p[0] === 127 || p[0] >= 224 ||
    (p[0] === 169 && p[1] === 254) || (p[0] === 172 && p[1] >= 16 && p[1] <= 31) ||
    (p[0] === 192 && p[1] === 168) || (p[0] === 100 && p[1] >= 64 && p[1] <= 127) ||
    (p[0] === 198 && (p[1] === 18 || p[1] === 19));
}

export function isBlockedProviderAddress(ip: string) {
  if (isIP(ip) === 4) return blockedV4(ip);
  const value = ip.toLowerCase();
  return value === "::" || value === "::1" || value.startsWith("fc") || value.startsWith("fd") ||
    /^fe[89ab]/.test(value) || value.startsWith("ff") ||
    (value.startsWith("::ffff:") && blockedV4(value.slice(7)));
}

export function validateProviderBaseUrl(value: string) {
  let url: URL;
  try { url = new URL(value); } catch { throw new Error("Base URL must be valid."); }
  const privateAllowed = process.env[PRIVATE_PROVIDER_URLS] === "true";
  if (url.protocol !== "https:" && !(privateAllowed && url.protocol === "http:")) throw new Error("Base URL must use HTTPS.");
  if (url.username || url.password || url.search || url.hash) throw new Error("Base URL cannot include credentials, query, or fragment.");
  if (!url.hostname || url.pathname.includes("..")) throw new Error("Base URL is not safe.");
  url.pathname = url.pathname.replace(/\/$/, "");
  return url;
}

export async function assertSafeProviderUrl(value: string) {
  const url = validateProviderBaseUrl(value);
  if (process.env[PRIVATE_PROVIDER_URLS] === "true") return url;
  const addresses = await lookup(url.hostname, { all: true, verbatim: true });
  if (!addresses.length || addresses.some(({ address }) => isBlockedProviderAddress(address))) {
    throw new Error("Provider resolves to a private or reserved network.");
  }
  return url;
}

export async function providerFetch(base: string, path: string, init: RequestInit = {}) {
  const baseUrl = await assertSafeProviderUrl(base);
  const target = new URL(path, `${baseUrl.href}/`);
  if (target.origin !== baseUrl.origin) throw new Error("Provider endpoint must remain on the configured origin.");
  const basePath = baseUrl.pathname.replace(/\/$/, "");
  if (basePath && !target.pathname.startsWith(`${basePath}/`) && target.pathname !== basePath) {
    throw new Error("Provider endpoint must remain under the configured base path.");
  }
  if (process.env[PRIVATE_PROVIDER_URLS] === "true") return fetch(target, { ...init, redirect: "error" });

  // Pin connection resolution to the addresses validated above, closing the DNS-rebinding window.
  const addresses = await lookup(target.hostname, { all: true, verbatim: true });
  if (!addresses.length || addresses.some(({ address }) => isBlockedProviderAddress(address))) throw new Error("Provider destination is unsafe.");
  let cursor = 0;
  const connector = buildConnector({});
  const dispatcher = new Agent({ connect: (options, callback) => {
    const selected = addresses[cursor++ % addresses.length];
    connector({ ...options, hostname: selected.address, host: selected.address, servername: target.hostname }, callback);
  } });
  try {
    const response = await undiciFetch(target, { ...(init as any), redirect: "error", dispatcher }) as unknown as Response;
    if (!response.body) { await dispatcher.close(); return response; }
    const reader = response.body.getReader();
    const body = new ReadableStream({
      async pull(controller) { try { const chunk=await reader.read(); if(chunk.done){controller.close();await dispatcher.close();}else controller.enqueue(chunk.value); } catch(error){controller.error(error);await dispatcher.close();} },
      async cancel(reason) { await reader.cancel(reason).catch(()=>undefined); await dispatcher.close(); },
    });
    return new Response(body, { status: response.status, statusText: response.statusText, headers: response.headers });
  } catch (error) {
    await dispatcher.close();
    throw error;
  }
}

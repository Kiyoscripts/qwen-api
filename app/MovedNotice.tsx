"use client";

import { useEffect, useState } from "react";

/**
 * Tells anyone still on an old deployment that the service has moved.
 *
 * The same build is deployed to more than one host during a migration, so the
 * canonical address cannot be baked in at build time — it has to be decided
 * from the hostname the page was actually served from.
 *
 * Only the UI is affected. API routes never render this layout, so /v1/* keeps
 * answering on the old host and nobody's integration breaks the moment this
 * ships; the notice is for people, not for clients.
 */

export const CANONICAL_HOST = "qwen38-api-production.up.railway.app";
export const CANONICAL_URL = `https://${CANONICAL_HOST}`;

/** Hosts that are legitimately not the canonical one. */
function isAllowedHost(host: string): boolean {
  if (host === CANONICAL_HOST) return true;
  if (host === "localhost" || host === "127.0.0.1" || host === "[::1]") return true;
  // LAN previews (phone testing against the dev server) and *.local mDNS names.
  if (/^192\.168\.\d{1,3}\.\d{1,3}$/.test(host)) return true;
  if (/^10\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(host)) return true;
  if (/^172\.(1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3}$/.test(host)) return true;
  if (host.endsWith(".local")) return true;
  return false;
}

export default function MovedNotice() {
  // `undefined` until mounted: the server has no hostname to check, and
  // rendering anything before hydration would mismatch.
  const [stale, setStale] = useState<boolean | undefined>(undefined);

  useEffect(() => {
    setStale(!isAllowedHost(window.location.hostname));
  }, []);

  if (!stale) return null;

  // Carry the visitor to the same page on the new host, not just its root.
  const here = typeof window === "undefined" ? "" : window.location.pathname + window.location.search;
  const target = CANONICAL_URL + (here === "/" ? "" : here);

  return (
    <div className="moved" role="dialog" aria-modal="true" aria-labelledby="moved-title">
      <div className="moved-card glass">
        <span className="lp-logo" />
        <h1 id="moved-title">Qwen3.8&nbsp;API has moved</h1>
        <p>
          This address is no longer where the service lives. Everything — the API, your keys and
          your account — is now at the new URL.
        </p>
        <a className="g-btn lg" href={target}>
          Go to {CANONICAL_HOST}
        </a>
        <p className="moved-fine">
          Using it from code? Update your <code>baseURL</code> to{" "}
          <code>{CANONICAL_URL}/v1</code>. Keys keep working — only the host changed.
        </p>
      </div>
    </div>
  );
}

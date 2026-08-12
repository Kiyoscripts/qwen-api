// Outbound proxying: the dispatcher plumbing that lets Solar and chatglm.cn
// leave by a residential address.
//
// The end-to-end proof is not here — it was a real run against both upstreams
// through a local CONNECT proxy. What this pins is the wiring that is easy to
// get quietly wrong: an unset variable must mean direct egress rather than a
// broken dispatcher, a bad URL must not take the provider down at import, and
// agents must be reused rather than rebuilt per request.

import { proxyDispatcher, withProxy, proxyLabel } from "../lib/egress.ts";

let passed = 0;
let failed = 0;
function check(name: string, cond: boolean, detail = "") {
  if (cond) {
    passed++;
  } else {
    failed++;
    console.error(`  FAIL: ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

const PROXY = "http://user:pass@127.0.0.1:8899";

// 1. Unset means direct — the common case, and the one that must not break.
{
  check("undefined -> no dispatcher", proxyDispatcher(undefined) === undefined);
  check("empty string -> no dispatcher", proxyDispatcher("") === undefined);
  check("whitespace -> no dispatcher", proxyDispatcher("   ") === undefined);
  const init = { method: "POST" as const };
  check("withProxy leaves init untouched when unset", withProxy(init, "") === init);
}

// 2. Configured means a dispatcher lands in the fetch options.
{
  const init = withProxy({ method: "POST" as const }, PROXY) as Record<string, unknown>;
  check("dispatcher added", Boolean(init.dispatcher), JSON.stringify(Object.keys(init)));
  check("original fields survive", init.method === "POST");
}

// 3. Agents are pooled per URL, not rebuilt per call — each carries a
//    connection pool, and one per request would leak sockets.
{
  check("same URL reuses one agent", proxyDispatcher(PROXY) === proxyDispatcher(PROXY));
  check("different URL gets its own", proxyDispatcher(PROXY) !== proxyDispatcher("http://127.0.0.1:9999"));
}

// 4. A malformed URL degrades to direct rather than throwing. A typo in an
//    optional env var should not take a provider offline.
{
  let threw = false;
  let d: unknown;
  try {
    d = proxyDispatcher("not a url at all");
  } catch {
    threw = true;
  }
  check("malformed URL does not throw", !threw);
  check("malformed URL falls back to direct", d === undefined);
}

// 5. The label is safe to log — credentials must not appear in it.
{
  const label = proxyLabel(PROXY);
  check("label is host:port", label === "127.0.0.1:8899", label);
  check("label hides credentials", !label.includes("user") && !label.includes("pass"), label);
  check("unset label reads 'direct'", proxyLabel("") === "direct");
  check("malformed label reads 'invalid'", proxyLabel("nonsense") === "invalid");
}

console.log(`egress: ${passed} passed, ${failed} failed`);
if (failed) process.exit(1);

// Outbound proxying: the dispatcher plumbing that lets Solar and chatglm.cn
// leave by a residential address.
//
// The end-to-end proof is not here — it was a real run against both upstreams
// through a local CONNECT proxy. What this pins is the wiring that is easy to
// get quietly wrong: an unset variable must mean direct egress rather than a
// broken dispatcher, a bad URL must not take the provider down at import, and
// agents must be reused rather than rebuilt per request.

import { proxyDispatcher, withProxy, proxyLabel, parseProxyList, ProxyPool } from "../lib/egress.ts";

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

// --- proxy lists ------------------------------------------------------------

// 6. Webshare exports host:port:user:pass, so a downloaded list pastes in
//    as-is rather than being hand-converted to URLs a hundred times.
{
  const list = parseProxyList("198.37.109.126:6233:bob:s3cret");
  check("webshare form becomes a URL", list.length === 1, JSON.stringify(list));
  check("host and port survive", list[0].includes("@198.37.109.126:6233"), list[0]);
  check("credentials survive", list[0].includes("bob:s3cret"), list[0]);
}

// 7. Both separators, both forms, mixed together.
{
  const list = parseProxyList(`
    1.1.1.1:80:u:p
    http://user:pass@2.2.2.2:8080,3.3.3.3:3128
  `);
  check("newlines and commas both split", list.length === 3, JSON.stringify(list));
  check("plain URL passes through", list[1] === "http://user:pass@2.2.2.2:8080", list[1]);
  check("host:port gets a scheme", list[2] === "http://3.3.3.3:3128", list[2]);
}

// 8. Credentials needing escaping must not break the URL.
{
  const list = parseProxyList("1.1.1.1:80:user@name:p@ss word");
  check("odd credentials are encoded", list.length === 1 && new URL(list[0]).hostname === "1.1.1.1", JSON.stringify(list));
}

// 9. Junk lines are skipped, not fatal — a stray blank or comment in a pasted
//    list should not cost the whole pool.
{
  const list = parseProxyList("1.1.1.1:80\n\n   \nnonsense\n2.2.2.2:81");
  check("unparseable entries dropped", list.length === 2, JSON.stringify(list));
}

// 10. The pool: sticky until told otherwise, then advances. Upstage refuses a
//     good fraction of any pool, so rotating past a refusal is the whole point.
{
  const pool = new ProxyPool("1.1.1.1:80:u:p\n2.2.2.2:80:u:p\n3.3.3.3:80:u:p");
  check("pool size", pool.size === 3, String(pool.size));
  const first = pool.current();
  check("stays put until rotated", pool.current() === first);
  pool.rotate();
  check("rotate advances", pool.current() !== first, String(pool.current()));
  pool.rotate();
  pool.rotate();
  check("rotation wraps", pool.current() === first, String(pool.current()));
  check("attempts covers the pool", pool.attempts() === 3, String(pool.attempts()));
  check("attempts is capped", new ProxyPool(Array.from({ length: 40 }, (_, i) => `1.1.1.${i}:80`).join("\n")).attempts() === 5);
}

// 11. No pool means direct egress and exactly one attempt — the local case,
//     which must not start looping or proxying.
{
  const pool = new ProxyPool(undefined);
  check("empty pool has no size", pool.size === 0);
  check("empty pool is direct", pool.current() === undefined);
  check("empty pool still gets one attempt", pool.attempts() === 1);
  pool.rotate();
  check("rotating an empty pool is harmless", pool.current() === undefined);
}

// 12. A single proxy must not rotate onto itself and hide a real refusal.
{
  const pool = new ProxyPool("1.1.1.1:80");
  pool.rotate();
  check("single-entry pool stays put", pool.current() === "http://1.1.1.1:80");
  check("single-entry pool tries once", pool.attempts() === 1);
}

console.log(`egress: ${passed} passed, ${failed} failed`);
if (failed) process.exit(1);

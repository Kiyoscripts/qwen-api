// Session cleanup for the DeepSeek proxy. We create a throwaway session per
// request, so a delete that silently fails leaves debris on a real user's
// account — these tests pin the behaviour without touching the live service.

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

type Call = { url: string; method: string; body?: string };

/** Swap in a fake fetch and collect what the client tried. */
function stubFetch(handler: (call: Call) => { status?: number; body?: string }) {
  const calls: Call[] = [];
  (globalThis as any).fetch = async (url: any, init: any = {}) => {
    const call: Call = { url: String(url), method: init.method || "GET", body: init.body };
    calls.push(call);
    const { status = 200, body = '{"code":0}' } = handler(call);
    return new Response(body, { status, headers: { "Content-Type": "application/json" } });
  };
  return calls;
}

const realFetch = globalThis.fetch;
const warnings: string[] = [];
const realWarn = console.warn;
console.warn = (...a: unknown[]) => void warnings.push(a.join(" "));

// Imported after console.warn is captured so module-level state is fresh.
const { deleteSession } = await import("../lib/deepseek.ts");

const isPost = (c: Call) => c.method === "POST" && c.url.endsWith("/chat_session/delete");
const isRest = (c: Call) => c.method === "DELETE" && /\/chat_session\/[^/]+$/.test(c.url);

// 1. The POST shape working is the whole story: one call, no fallback, no noise.
{
  warnings.length = 0;
  const calls = stubFetch(() => ({ body: '{"code":0}' }));
  await deleteSession("tok", "sess-1");
  check("POST shape: exactly one request", calls.length === 1, `got ${calls.length}`);
  check("POST shape: hits /chat_session/delete", calls.length === 1 && isPost(calls[0]));
  check("POST shape: sends the session id", (calls[0]?.body || "").includes("sess-1"));
  check("POST shape: stays quiet", warnings.length === 0, warnings.join(" / "));
}

// 2. A business-level rejection (HTTP 200 but code != 0) must not read as success.
{
  warnings.length = 0;
  const calls = stubFetch((c) => (isPost(c) ? { body: '{"code":40003,"msg":"nope"}' } : { body: '{"code":0}' }));
  await deleteSession("tok", "sess-2");
  check("fallback: tries both shapes", calls.length === 2, `got ${calls.length}`);
  check("fallback: second attempt is the REST form", calls.length === 2 && isRest(calls[1]));
  check("fallback: session id is URL-encoded into the path", (calls[1]?.url || "").endsWith("/sess-2"));
  check("fallback: succeeding quietly", warnings.length === 0, warnings.join(" / "));
}

// 3. Having learned the REST shape works, it should lead next time.
{
  const calls = stubFetch(() => ({ body: '{"code":0}' }));
  await deleteSession("tok", "sess-3");
  check("learned shape: REST is tried first", calls.length === 1 && isRest(calls[0]), calls.map((c) => c.method).join(","));
}

// 4. Both failing is worth a warning naming the session — but never a throw,
//    because cleanup runs on paths that must not fail the user's request.
{
  warnings.length = 0;
  stubFetch(() => ({ status: 500, body: "gateway blew up" }));
  let threw = false;
  try {
    await deleteSession("tok", "sess-4");
  } catch {
    threw = true;
  }
  check("total failure: does not throw", !threw);
  check("total failure: warns", warnings.length === 1, `${warnings.length} warnings`);
  check("total failure: names the session", warnings.join(" ").includes("sess-4"));
  check("total failure: reports both attempts", /post:/.test(warnings.join(" ")) && /rest:/.test(warnings.join(" ")));
}

// 5. A network-level throw is a failure like any other, not a crash.
{
  warnings.length = 0;
  (globalThis as any).fetch = async () => {
    throw new Error("ECONNRESET");
  };
  let threw = false;
  try {
    await deleteSession("tok", "sess-5");
  } catch {
    threw = true;
  }
  check("network error: swallowed", !threw);
  check("network error: surfaced in the log", warnings.join(" ").includes("ECONNRESET"));
}

// 6. Nothing to delete means no request at all.
{
  const calls = stubFetch(() => ({ body: '{"code":0}' }));
  await deleteSession("tok", undefined);
  check("no session id: no request issued", calls.length === 0, `got ${calls.length}`);
}

// 7. A non-JSON 200 (an HTML error page from a WAF, say) must not count as a
//    successful delete just because the status line was 200.
{
  warnings.length = 0;
  stubFetch(() => ({ status: 403, body: "<html>access denied</html>" }));
  await deleteSession("tok", "sess-7");
  check("non-JSON rejection: treated as failure", warnings.length === 1, warnings.join(" / "));
}

globalThis.fetch = realFetch;
console.warn = realWarn;
console.log(`${passed} passed, ${failed} failed`);
if (failed) process.exit(1);

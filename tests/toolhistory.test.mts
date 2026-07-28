// Tool-history budgeting.
//
// The proxy is stateless, so every turn re-sends the whole transcript. In an
// agent session that transcript is mostly tool results, and in a coding agent
// those results are file contents — so the prompt grows without bound and the
// request eventually dies against the 300s ceiling (measured: ~1s per 1k chars,
// 200k chars = timeout or a bare 502).
//
// Two properties matter and pull against each other:
//   1. Long sessions must stay bounded, or they break.
//   2. Ordinary conversations must be untouched — trimming a short chat would
//      silently degrade answers to fix a problem it does not have.
// Everything below is one of those two.

import { preprocessToolMessages } from "../lib/tools.ts";

let passed = 0;
let failed = 0;
function check(name: string, cond: boolean, detail = "") {
  if (cond) passed++;
  else { failed++; console.error(`  FAIL: ${name}${detail ? ` — ${detail}` : ""}`); }
}

const TOOLS = [{
  type: "function",
  function: { name: "read", description: "Read a file", parameters: { type: "object", properties: { path: { type: "string" } } } },
}] as any;

/** An agent transcript: `turns` read calls, each returning `size` bytes. */
function session(turns: number, size: number) {
  const msgs: any[] = [{ role: "user", content: "Refactor the auth module." }];
  for (let i = 1; i <= turns; i++) {
    msgs.push({ role: "assistant", content: "", tool_calls: [
      { id: `c${i}`, type: "function", function: { name: "read", arguments: JSON.stringify({ path: `f${i}.ts` }) } }]});
    msgs.push({ role: "tool", tool_call_id: `c${i}`, name: "read", content: `FILE${i}:` + "x".repeat(size) });
  }
  return msgs;
}

const textOf = (out: any[]) => out.map((m) => (typeof m.content === "string" ? m.content : "")).join("\n");

// --- 1. short sessions are left completely alone ---------------------------
{
  const out = preprocessToolMessages(session(3, 500), TOOLS, undefined);
  const body = textOf(out);
  check("short session: nothing elided", !body.includes("elided="));
  check("short session: nothing truncated", !body.includes("bytes truncated"));
  for (let i = 1; i <= 3; i++) {
    check(`short session: result ${i} intact`, body.includes(`FILE${i}:`));
  }
}

// --- 2. long sessions are bounded ------------------------------------------
{
  const big = preprocessToolMessages(session(30, 40_000), TOOLS, undefined);
  const bigLen = textOf(big).length;
  check("long session stays under the prompt limit", bigLen < 110_000, `${bigLen} chars`);

  // Unbounded growth is the bug; confirm it is actually sublinear now.
  const longer = textOf(preprocessToolMessages(session(60, 40_000), TOOLS, undefined)).length;
  check("doubling the turns does not double the prompt", longer < bigLen * 1.5, `${bigLen} -> ${longer}`);
}

// --- 3. the newest results survive verbatim --------------------------------
// These are what the model is reasoning about right now; eliding them would
// break the current step rather than just forgetting history.
{
  const body = textOf(preprocessToolMessages(session(20, 40_000), TOOLS, undefined));
  check("newest result kept", body.includes("FILE20:"));
  check("second newest kept", body.includes("FILE19:"));
  check("oldest result elided", !body.includes("FILE1:"));
  check("elision is marked, not silent", body.includes("elided="));
}

// --- 4. one huge result cannot dominate the budget -------------------------
{
  const msgs: any[] = [
    { role: "user", content: "read it" },
    { role: "assistant", content: "", tool_calls: [{ id: "c1", type: "function", function: { name: "read", arguments: "{}" } }] },
    { role: "tool", tool_call_id: "c1", name: "read", content: "HEAD:" + "y".repeat(200_000) },
  ];
  const body = textOf(preprocessToolMessages(msgs, TOOLS, undefined));
  check("single huge result is clamped", body.length < 20_000, `${body.length} chars`);
  check("clamp keeps the head", body.includes("HEAD:"));
  check("clamp is marked", body.includes("bytes truncated"));
}

// --- 5. structure is preserved ---------------------------------------------
// The transcript still has to read as a tool exchange, or the model loses the
// thread of what it already did.
{
  const out = preprocessToolMessages(session(20, 40_000), TOOLS, undefined);
  // The appended protocol section documents the convention using the same tags,
  // so count only the conversation itself or its examples inflate the totals.
  const body = textOf(out.slice(0, -1));
  check("every call is still rendered", (body.match(/<tool_call>/g) || []).length === 20,
    String((body.match(/<tool_call>/g) || []).length));
  const responses = (body.match(/<tool_response/g) || []).length;
  check("every response still accounted for", responses === 20, `${responses} of 20`);
  check("elided stubs name their tool", /<tool_response name="read" elided="\d+ bytes" \/>/.test(body));
  check("tool protocol section still appended", out[out.length - 1].role === "system");
}

// --- 6. non-tool conversations are untouched -------------------------------
{
  const plain = [
    { role: "system", content: "Be terse." },
    { role: "user", content: "hello" },
    { role: "assistant", content: "hi" },
  ];
  const out = preprocessToolMessages(plain, TOOLS, undefined);
  check("plain messages pass through unchanged", out.slice(0, 3).every((m, i) => m.content === plain[i].content));
}

console.log(`toolhistory: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);

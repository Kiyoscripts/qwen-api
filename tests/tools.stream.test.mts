// Streaming-granularity checks. The hold states (fence, bare-JSON, split
// sentinels) must not turn ordinary output into one buffered blob.

import { ToolStream, extractToolCalls } from "../lib/tools";

const TOOLS = [
  { type: "function", function: { name: "get_weather", parameters: { type: "object", properties: { city: { type: "string" } }, required: ["city"] } } },
];

let pass = 0, fail = 0;
const notes: string[] = [];

/** Feed `raw` in n-char chunks; return the emitted pieces. */
function run(raw: string, n = 4) {
  const s = new ToolStream(TOOLS);
  const pieces: string[] = [];
  for (let i = 0; i < raw.length; i += n) {
    const out = s.push(raw.slice(i, i + n));
    if (out) pieces.push(out);
  }
  const fin = s.end();
  if (fin.text) pieces.push(fin.text);
  return { pieces, calls: fin.toolCalls, text: pieces.join("") };
}

function check(name: string, cond: boolean, detail = "") {
  if (cond) pass++;
  else { fail++; notes.push(`✗ ${name}${detail ? "\n    " + detail : ""}`); }
}

// 1. Prose must arrive in many pieces, not one.
{
  const raw = "The weather in Paris is mild today, around 18 degrees, with light cloud cover expected.";
  const r = run(raw);
  check("prose streams incrementally", r.pieces.length > 5, `pieces=${r.pieces.length}`);
  check("prose round-trips exactly", r.text === raw, JSON.stringify(r.text));
}

// 2. A language-tagged code fence must stream too (this is what the early
//    release in the fence state exists for).
{
  const raw = "Here:\n```python\ndef f(x):\n    return {'a': x}\n```\nDone.";
  const r = run(raw);
  check("tagged code fence streams", r.pieces.length > 5, `pieces=${r.pieces.length}`);
  check("tagged code fence round-trips", r.text === raw, JSON.stringify(r.text));
  check("tagged code fence makes no calls", r.calls.length === 0);
}

// 3. An untagged fence holding non-JSON must be released, not swallowed.
{
  const raw = "```\nplain text block\n```\nafter";
  const r = run(raw);
  check("untagged non-JSON fence round-trips", r.text === raw, JSON.stringify(r.text));
  check("untagged fence makes no calls", r.calls.length === 0);
}

// 4. Worst case: one character at a time, tags split maximally.
{
  const raw = `Checking.<tool_call>{"name":"get_weather","arguments":{"city":"Paris"}}</tool_call>`;
  const r = run(raw, 1);
  check("1-char chunks find the call", r.calls.length === 1 && r.calls[0].function.name === "get_weather");
  check("1-char chunks leak no tag", !r.text.includes("<tool") && !r.text.includes("tool_call"), JSON.stringify(r.text));
  check("1-char chunks keep the prose", r.text.trim() === "Checking.", JSON.stringify(r.text));
}

// 5. Chunk boundary landing exactly inside every sentinel.
{
  const raw = `a<tool_call>{"name":"get_weather","arguments":{"city":"P"}}</tool_call>b`;
  let ok = true;
  for (let n = 1; n <= raw.length; n++) {
    const r = run(raw, n);
    if (r.calls.length !== 1 || r.text.replace(/\s/g, "") !== "ab") { ok = false; notes.push(`   split n=${n}: text=${JSON.stringify(r.text)} calls=${r.calls.length}`); break; }
  }
  check("every chunk boundary behaves", ok);
}

// 6. Text before a call is emitted before the call resolves (not withheld).
{
  const s = new ToolStream(TOOLS);
  const early = s.push("Let me look that up. ");
  check("pre-call text emits immediately", early.trim() === "Let me look that up.", JSON.stringify(early));
}

// 7. No tools declared -> nothing is ever treated as a call.
{
  const empty = extractToolCalls(`<tool_call>{"name":"get_weather","arguments":{}}</tool_call>`, []);
  check("empty registry makes no calls", empty.toolCalls.length === 0);
  check("empty registry preserves text", (empty.content || "").includes("get_weather"));
}

// 8. Long prose containing braces mid-reply is never held.
{
  const raw = "Use the shape {\"city\": \"Paris\"} in your request body when calling the endpoint.";
  const r = run(raw);
  check("mid-prose JSON is not swallowed", r.text === raw, JSON.stringify(r.text));
  check("mid-prose JSON makes no calls", r.calls.length === 0);
}

console.log(notes.join("\n"));
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

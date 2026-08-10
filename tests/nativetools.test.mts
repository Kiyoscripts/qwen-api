// Models that ignore the injected protocol and emit their own tool grammar.
//
// The proxy asks for <tool_call>{json}</tool_call>. Qwen speaks that natively,
// so it costs nothing there. Kimi K3 does not: it emits Moonshot's token
// grammar, and the reply reached the caller as raw markup, so a harness saw
// prose where it expected tool_calls and the run stalled. Reported from
// OpenCode; the sample below is the output from that report.

import { extractToolCalls } from "../lib/tools.ts";

let passed = 0, failed = 0;
function check(name: string, cond: boolean, detail = "") {
  if (cond) passed++;
  else { failed++; console.error(`  FAIL: ${name}${detail ? ` — ${detail}` : ""}`); }
}

const TOOLS = [
  { type: "function" as const, function: { name: "read", description: "Read a file",
      parameters: { type: "object", properties: { filePath: { type: "string" } }, required: ["filePath"] } } },
  { type: "function" as const, function: { name: "glob", description: "Match files",
      parameters: { type: "object", properties: { pattern: { type: "string" } }, required: ["pattern"] } } },
];

// Verbatim from the report, two calls in one envelope.
const REPORTED =
  '<|open|>tools<|sep|><|open|>call tool="read" index="1"<|sep|><|open|>argument key="filePath" ' +
  'type="string"<|sep|>/run/media/brotherguns/BROTHERGUNS1/rainporting<|close|>argument<|sep|>' +
  '<|close|>call<|sep|><|open|>call tool="glob" index="2"<|sep|><|open|>argument key="pattern" ' +
  'type="string"<|sep|>**/manifest.json<|close|>argument<|sep|><|close|>call<|sep|><|close|>tools<|sep|>';

{
  const { content, toolCalls } = extractToolCalls(REPORTED, TOOLS);
  check("both calls are recovered", toolCalls.length === 2, String(toolCalls.length));
  check("first call is read", toolCalls[0]?.function.name === "read", toolCalls[0]?.function.name);
  check("second call is glob", toolCalls[1]?.function.name === "glob", toolCalls[1]?.function.name);
  check("path argument survives verbatim",
    JSON.parse(toolCalls[0]?.function.arguments ?? "{}").filePath === "/run/media/brotherguns/BROTHERGUNS1/rainporting",
    toolCalls[0]?.function.arguments);
  check("glob pattern survives, including **",
    JSON.parse(toolCalls[1]?.function.arguments ?? "{}").pattern === "**/manifest.json",
    toolCalls[1]?.function.arguments);
  // The whole point: none of the markup should reach the caller.
  check("no markup leaks into the reply", !(content ?? "").includes("<|"), JSON.stringify(content));
}

// Arguments carry a declared type, and it should be honoured.
{
  const typed = [{ type: "function" as const, function: { name: "wait",
    parameters: { type: "object", properties: { ms: { type: "number" }, loud: { type: "boolean" } } } } }];
  const raw = '<|open|>tools<|sep|><|open|>call tool="wait" index="1"<|sep|>' +
    '<|open|>argument key="ms" type="number"<|sep|>250<|close|>argument<|sep|>' +
    '<|open|>argument key="loud" type="boolean"<|sep|>true<|close|>argument<|sep|>' +
    '<|close|>call<|sep|><|close|>tools<|sep|>';
  const { toolCalls } = extractToolCalls(raw, typed);
  const args = JSON.parse(toolCalls[0]?.function.arguments ?? "{}");
  check("number is a number", args.ms === 250, typeof args.ms);
  check("boolean is a boolean", args.loud === true, typeof args.loud);
}

// A name the caller never offered cannot be answered, so it must not become a
// call. Same rule the XML path already applies.
{
  const raw = '<|open|>tools<|sep|><|open|>call tool="rm_rf" index="1"<|sep|>' +
    '<|open|>argument key="path" type="string"<|sep|>/<|close|>argument<|sep|>' +
    '<|close|>call<|sep|><|close|>tools<|sep|>';
  const { toolCalls } = extractToolCalls(raw, TOOLS);
  check("an unregistered tool is refused", toolCalls.length === 0, String(toolCalls.length));
}

// Ordinary prose must be untouched: this fallback only fires on the grammar.
{
  const { content, toolCalls } = extractToolCalls("Here is an answer with no tools in it.", TOOLS);
  check("plain text passes through", content === "Here is an answer with no tools in it.", String(content));
  check("plain text yields no calls", toolCalls.length === 0);
}

// The protocol we actually ask for still works, unchanged.
{
  const xml = '<tool_call>{"name":"read","arguments":{"filePath":"/tmp/a"}}</tool_call>';
  const { toolCalls } = extractToolCalls(xml, TOOLS);
  check("the injected protocol still parses", toolCalls.length === 1 && toolCalls[0].function.name === "read");
}

console.log(`nativetools: ${passed} passed, ${failed} failed`);
if (failed) process.exit(1);

// Streaming splits at arbitrary boundaries, including mid-sentinel. The parser
// must not leak half of "<|open|>" as prose while it waits for the rest.
{
  const { ToolStream } = await import("../lib/tools.ts");
  for (const size of [1, 3, 7, 29]) {
    const s = new ToolStream(TOOLS);
    let shown = "";
    for (let i = 0; i < REPORTED.length; i += size) shown += s.push(REPORTED.slice(i, i + size));
    const fin = s.end();
    const all = shown + fin.text;
    check(`chunked by ${size}: both calls recovered`, fin.toolCalls.length === 2, String(fin.toolCalls.length));
    check(`chunked by ${size}: no markup shown`, !all.includes("<|"), JSON.stringify(all.slice(0, 60)));
  }
}

console.log(`nativetools (with streaming): ${passed} passed, ${failed} failed`);
if (failed) process.exit(1);

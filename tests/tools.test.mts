// Behavioural test for the emulated tool-call parser.
// Run: node tooltest.mjs   (from the repo root, after `npx tsc` of lib/tools.ts
// via the tsx loader — see run-tooltest.sh)

import { ToolStream, extractToolCalls } from "../lib/tools";

const TOOLS = [
  {
    type: "function",
    function: {
      name: "get_weather",
      description: "Get weather",
      parameters: {
        type: "object",
        properties: {
          city: { type: "string" },
          days: { type: "integer" },
          metric: { type: "boolean" },
          tags: { type: "array", items: { type: "string" } },
        },
        required: ["city"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "calculate",
      description: "Do math",
      parameters: { type: "object", properties: { expression: { type: "string" } }, required: ["expression"] },
    },
  },
];

let pass = 0, fail = 0;
const failures = [];

function check(name, raw, expect) {
  // 1) buffered
  const buffered = extractToolCalls(raw, TOOLS);
  // 2) streamed, split into awkward 3-char chunks to force split tags
  const s = new ToolStream(TOOLS);
  let streamedText = "";
  for (let i = 0; i < raw.length; i += 3) streamedText += s.push(raw.slice(i, i + 3));
  const fin = s.end();
  streamedText += fin.text;
  const streamed = { content: streamedText.trim() || null, toolCalls: fin.toolCalls };

  for (const [mode, got] of [["buffered", buffered], ["streamed", streamed]]) {
    const calls = got.toolCalls.map((t) => ({ name: t.function.name, args: JSON.parse(t.function.arguments || "{}") }));
    const ok =
      JSON.stringify(calls) === JSON.stringify(expect.calls) &&
      (expect.text === undefined || (got.content || "").trim() === expect.text);
    if (ok) pass++;
    else {
      fail++;
      failures.push(
        `✗ ${name} [${mode}]\n    want calls ${JSON.stringify(expect.calls)}\n     got calls ${JSON.stringify(calls)}` +
          (expect.text !== undefined ? `\n    want text ${JSON.stringify(expect.text)}\n     got text ${JSON.stringify((got.content || "").trim())}` : "")
      );
    }
  }
}

const W = (args) => ({ name: "get_weather", args });

// ---- the happy path ----
check("canonical", `<tool_call>\n{"name": "get_weather", "arguments": {"city": "Paris"}}\n</tool_call>`,
  { calls: [W({ city: "Paris" })], text: "" });

check("prose then call", `Let me check.\n<tool_call>\n{"name":"get_weather","arguments":{"city":"Paris"}}\n</tool_call>`,
  { calls: [W({ city: "Paris" })], text: "Let me check." });

check("two parallel calls",
  `<tool_call>{"name":"get_weather","arguments":{"city":"Paris"}}</tool_call>\n<tool_call>{"name":"calculate","arguments":{"expression":"1+1"}}</tool_call>`,
  { calls: [W({ city: "Paris" }), { name: "calculate", args: { expression: "1+1" } }] });

// ---- malformations Qwen actually emits ----
check("unterminated block", `<tool_call>\n{"name":"get_weather","arguments":{"city":"Paris"}}`,
  { calls: [W({ city: "Paris" })] });

check("trailing comma", `<tool_call>{"name":"get_weather","arguments":{"city":"Paris",}}</tool_call>`,
  { calls: [W({ city: "Paris" })] });

check("single quotes", `<tool_call>{'name':'get_weather','arguments':{'city':'Paris'}}</tool_call>`,
  { calls: [W({ city: "Paris" })] });

check("python literals", `<tool_call>{"name":"get_weather","arguments":{"city":"Paris","metric":True}}</tool_call>`,
  { calls: [W({ city: "Paris", metric: true })] });

check("smart quotes", `<tool_call>{\u201cname\u201d:\u201cget_weather\u201d,\u201carguments\u201d:{\u201ccity\u201d:\u201cParis\u201d}}</tool_call>`,
  { calls: [W({ city: "Paris" })] });

check("double-encoded arguments", `<tool_call>{"name":"get_weather","arguments":"{\\"city\\":\\"Paris\\"}"}</tool_call>`,
  { calls: [W({ city: "Paris" })] });

check("flat args (no arguments key)", `<tool_call>{"name":"get_weather","city":"Paris"}</tool_call>`,
  { calls: [W({ city: "Paris" })] });

check("parameters instead of arguments", `<tool_call>{"name":"get_weather","parameters":{"city":"Paris"}}</tool_call>`,
  { calls: [W({ city: "Paris" })] });

check("tag with attributes", `<tool_call name="get_weather">{"name":"get_weather","arguments":{"city":"Paris"}}</tool_call>`,
  { calls: [W({ city: "Paris" })] });

check("two objects in one block",
  `<tool_call>\n{"name":"get_weather","arguments":{"city":"Paris"}}\n{"name":"calculate","arguments":{"expression":"2+2"}}\n</tool_call>`,
  { calls: [W({ city: "Paris" }), { name: "calculate", args: { expression: "2+2" } }] });

check("missing close, then more text",
  `<tool_call>{"name":"get_weather","arguments":{"city":"Paris"}}\nDone.`,
  { calls: [W({ city: "Paris" })] });

// ---- schema coercion ----
check("stringified number", `<tool_call>{"name":"get_weather","arguments":{"city":"Paris","days":"3"}}</tool_call>`,
  { calls: [W({ city: "Paris", days: 3 })] });

check("stringified boolean", `<tool_call>{"name":"get_weather","arguments":{"city":"Paris","metric":"false"}}</tool_call>`,
  { calls: [W({ city: "Paris", metric: false })] });

check("scalar for array", `<tool_call>{"name":"get_weather","arguments":{"city":"Paris","tags":"hot"}}</tool_call>`,
  { calls: [W({ city: "Paris", tags: ["hot"] })] });

// ---- name repair ----
check("camelCase name", `<tool_call>{"name":"getWeather","arguments":{"city":"Paris"}}</tool_call>`,
  { calls: [W({ city: "Paris" })] });

check("namespaced name", `<tool_call>{"name":"functions.get_weather","arguments":{"city":"Paris"}}</tool_call>`,
  { calls: [W({ city: "Paris" })] });

// ---- FALSE POSITIVES: these must NOT become tool calls ----
check("user asked for JSON with a name field",
  `{"name": "Alice", "age": 30}`,
  { calls: [], text: `{"name": "Alice", "age": 30}` });

check("model copies the literal placeholder",
  `<tool_call>{"name": "the_function_name", "arguments": {"arg1": "value"}}</tool_call>`,
  { calls: [] });

check("hallucinated tool",
  `<tool_call>{"name":"send_email","arguments":{"to":"a@b.c"}}</tool_call>`,
  { calls: [] });

check("fenced example is explanation, not a call",
  "Here is how it works:\n```json\n{\"name\": \"get_weather\", \"arguments\": {\"city\": \"X\"}}\n```\nThat is the format.",
  { calls: [] });

check("plain prose untouched", `The weather in Paris is nice today.`,
  { calls: [], text: `The weather in Paris is nice today.` });

check("code block with braces streams as text",
  "Here:\n```js\nconst o = {name: 'x'};\n```\ndone",
  { calls: [] });

// ---- JSON fallback (model ignored the XML protocol entirely) ----
check("bare json tool_calls envelope",
  `{"tool_calls":[{"name":"get_weather","arguments":{"city":"Paris"}}]}`,
  { calls: [W({ city: "Paris" })] });

check("fenced json envelope",
  "```json\n{\"tool_calls\":[{\"name\":\"get_weather\",\"arguments\":{\"city\":\"Rome\"}}]}\n```",
  { calls: [W({ city: "Rome" })] });

console.log(failures.join("\n\n"));
console.log(`\n${pass} passed, ${fail} failed  (each case checked buffered + streamed)`);
process.exit(fail ? 1 : 0);

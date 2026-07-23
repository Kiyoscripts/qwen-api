// Emulated OpenAI-style function/tool calling for the Qwen backend.
//
// chat.qwen.ai has no native tool API, but Qwen3 models are trained on the
// Hermes/Qwen `<tool_call>` convention, so we:
//   1. Teach the protocol via an injected system section listing the tools.
//   2. Flatten prior assistant tool_calls + tool results back into that same
//      text convention so multi-turn tool loops work.
//   3. Parse the reply back into OpenAI `tool_calls`.
//
// Parsing accepts BOTH shapes for robustness:
//   - XML:  <tool_call>{"name": "...", "arguments": {...}}</tool_call>   (primary)
//   - JSON: a ```json {"tool_calls":[...]} ``` block or a bare {name,arguments}
//
// It's best-effort (no emulated layer is perfect) but degrades gracefully:
// anything we can't parse as a call is returned as ordinary assistant text.
//
// Tool-calling method credit: Discord user .thereid.

import { randomUUID } from "node:crypto";

export interface OAITool {
  type?: string;
  function?: { name?: string; description?: string; parameters?: unknown };
}

export interface OAIToolCall {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
}

// Tools are active unless the caller opted out with tool_choice:"none".
export function hasTools(body: any): boolean {
  return Array.isArray(body?.tools) && body.tools.length > 0 && body?.tool_choice !== "none";
}

function toolChoiceName(toolChoice: any): string | null {
  if (toolChoice && typeof toolChoice === "object" && toolChoice.function?.name) return toolChoice.function.name;
  return null;
}

function newId(): string {
  return "call_" + randomUUID().replace(/-/g, "").slice(0, 24);
}

// System text that teaches the model the calling protocol + the tool schemas.
export function toolSystemPrompt(tools: OAITool[], toolChoice: any): string {
  const defs = tools
    .filter((t) => t?.function?.name)
    .map((t) =>
      JSON.stringify({
        name: t.function!.name,
        description: t.function!.description || "",
        parameters: t.function!.parameters || { type: "object", properties: {} },
      })
    );

  const lines = [
    "# Tool use",
    "",
    "You have access to functions. Their signatures are provided inside <tools></tools>:",
    "<tools>",
    ...defs,
    "</tools>",
    "",
    "When a function is needed, emit one <tool_call> block per call — each a single JSON",
    'object with "name" and "arguments":',
    "<tool_call>",
    '{"name": "the_function_name", "arguments": {"arg1": "value"}}',
    "</tool_call>",
    "",
    "Rules:",
    '- "arguments" must be a JSON object that matches the function\'s parameters.',
    "- You may emit several <tool_call> blocks to call functions in parallel.",
    "- Emit the block(s) and nothing else when calling a tool — no prose around them.",
    "- Tool results are returned to you inside <tool_response></tool_response>; use them to answer.",
  ];

  const forced = toolChoiceName(toolChoice);
  if (toolChoice === "required") lines.push("- You MUST call a function now, not answer directly.");
  if (forced) lines.push(`- You MUST call the "${forced}" function now, not answer directly.`);

  return lines.join("\n");
}

// Render one OpenAI tool_call back into the `<tool_call>` text convention.
function renderCall(tc: any): string {
  const name = tc?.function?.name ?? tc?.name ?? "";
  let args = tc?.function?.arguments ?? tc?.arguments ?? {};
  if (typeof args !== "string") {
    args = JSON.stringify(args ?? {});
  } else {
    try {
      JSON.parse(args); // already JSON — embed as-is
    } catch {
      args = JSON.stringify(args); // not JSON — quote it
    }
  }
  return `<tool_call>\n{"name": ${JSON.stringify(name)}, "arguments": ${args}}\n</tool_call>`;
}

// Convert an OpenAI message list (which may contain assistant tool_calls and
// role:"tool" results) into plain role+text messages the prompt builder handles,
// then append the tool-protocol system section. The caller's own system prompt is
// preserved — the tool section is added, never substituted.
export function preprocessToolMessages(messages: any[], tools: OAITool[], toolChoice: any): any[] {
  const out: any[] = [];
  for (const m of messages) {
    if (m?.role === "assistant" && Array.isArray(m.tool_calls) && m.tool_calls.length) {
      const calls = m.tool_calls.map(renderCall).join("\n");
      const text = typeof m.content === "string" ? m.content : "";
      out.push({ role: "assistant", content: (text ? text + "\n" : "") + calls });
    } else if (m?.role === "tool") {
      const body = typeof m.content === "string" ? m.content : JSON.stringify(m.content ?? "");
      const nameHint = m.name ? ` name="${m.name}"` : "";
      out.push({ role: "user", content: `<tool_response${nameHint}>\n${body}\n</tool_response>` });
    } else {
      out.push(m);
    }
  }
  // Tool protocol goes last in the system group (after any user system prompt).
  out.push({ role: "system", content: toolSystemPrompt(tools, toolChoice) });
  return out;
}

// Turn one parsed JSON object into a tool call, accepting a few key spellings.
function callFromObject(obj: any): OAIToolCall | null {
  const name = obj?.name || obj?.function || obj?.tool;
  if (!name || typeof name !== "string") return null;
  const args = obj?.arguments ?? obj?.parameters ?? obj?.args ?? {};
  return {
    id: newId(),
    type: "function",
    function: { name, arguments: typeof args === "string" ? args : JSON.stringify(args) },
  };
}

function parseJsonLoose(s: string): any | null {
  let t = s.trim().replace(/^```(?:json|xml)?\s*/i, "").replace(/\s*```$/, "").trim();
  const first = t.indexOf("{");
  const last = t.lastIndexOf("}");
  if (first !== -1 && last !== -1 && last > first) t = t.slice(first, last + 1);
  try {
    return JSON.parse(t);
  } catch {
    return null;
  }
}

// Extract tool calls from a completed reply. Returns the leftover assistant text
// (null when the reply was only tool calls) plus any parsed calls.
export function parseToolCalls(raw: string): { content: string | null; toolCalls: OAIToolCall[] } {
  if (!raw) return { content: "", toolCalls: [] };

  const toolCalls: OAIToolCall[] = [];
  const matched: string[] = [];

  // 1) Primary: <tool_call>{...}</tool_call> blocks (Qwen-native).
  const re = /<tool_call>\s*([\s\S]*?)\s*<\/tool_call>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(raw)) !== null) {
    const obj = parseJsonLoose(m[1]);
    const call = obj && callFromObject(obj);
    if (call) {
      toolCalls.push(call);
      matched.push(m[0]);
    }
  }

  // 1b) Tolerate a single unterminated <tool_call> … EOF.
  if (toolCalls.length === 0) {
    const open = raw.indexOf("<tool_call>");
    if (open !== -1) {
      const inner = raw.slice(open + "<tool_call>".length).replace(/<\/tool_call>\s*$/, "");
      const obj = parseJsonLoose(inner);
      const call = obj && callFromObject(obj);
      if (call) {
        toolCalls.push(call);
        matched.push(raw.slice(open));
      }
    }
  }

  // 2) JSON fallback: ```json {"tool_calls":[...]} ``` or a bare object.
  if (toolCalls.length === 0) {
    const candidates: string[] = [];
    const fence = /```(?:json)?\s*([\s\S]*?)```/gi;
    while ((m = fence.exec(raw)) !== null) candidates.push(m[0]);
    const trimmed = raw.trim();
    if (trimmed.startsWith("{") && trimmed.endsWith("}")) candidates.push(trimmed);

    for (const c of candidates) {
      const obj = parseJsonLoose(c);
      if (!obj) continue;
      let list: any[] | null = null;
      if (Array.isArray(obj.tool_calls)) list = obj.tool_calls;
      else if (obj.tool_call) list = [obj.tool_call];
      else if (obj.name) list = [obj];
      if (!list) continue;
      for (const item of list) {
        const call = callFromObject(item);
        if (call) toolCalls.push(call);
      }
      if (toolCalls.length) {
        matched.push(c);
        break;
      }
    }
  }

  let stripped = raw;
  for (const frag of matched) stripped = stripped.replace(frag, "");
  const content = stripped.trim();
  return { content: toolCalls.length ? (content || null) : content, toolCalls };
}

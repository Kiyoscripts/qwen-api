// Prompt-based tool calling.
//
// chat.qwen.ai ignores OpenAI-style `tools` sent in the request — the model only
// has Qwen's own built-ins. So we implement function calling at the proxy layer:
// the tool schemas are injected into the prompt, the model is instructed to emit
// a strict JSON envelope when it wants to call one, and we parse that back into
// OpenAI `tool_calls`. Clients use the normal OpenAI tool-calling flow.

import { randomUUID } from "node:crypto";

export interface OpenAITool {
  type?: string;
  function?: { name: string; description?: string; parameters?: unknown };
}
export interface ParsedToolCall {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
}

export function toolsEnabled(tools: unknown, toolChoice: unknown): boolean {
  if (!Array.isArray(tools) || tools.length === 0) return false;
  if (toolChoice === "none") return false;
  return true;
}

// Build the system preamble describing the available tools + output contract.
export function buildToolPreamble(tools: OpenAITool[], toolChoice?: unknown): string {
  const specs = tools
    .filter((t) => t?.function?.name)
    .map((t) => {
      const f = t.function!;
      return `- ${f.name}: ${f.description || "(no description)"}\n  parameters (JSON Schema): ${JSON.stringify(f.parameters ?? { type: "object", properties: {} })}`;
    })
    .join("\n");

  let forced = "";
  if (toolChoice === "required") {
    forced = "\nYou MUST call one of the tools. Do not answer directly.";
  } else if (toolChoice && typeof toolChoice === "object") {
    const name = (toolChoice as any)?.function?.name;
    if (name) forced = `\nYou MUST call the tool "${name}". Do not answer directly.`;
  }

  return [
    "You have access to the following tools:",
    specs,
    "",
    "When you need to use a tool, reply with ONLY a JSON object in a fenced code block, exactly like this and nothing else:",
    "```json",
    '{"tool_calls":[{"name":"<tool name>","arguments":{ ...arguments matching the schema... }}]}',
    "```",
    "Rules:",
    '- Output the JSON block ALONE — no explanation, no prose before or after.',
    "- Only use tools listed above, and only with arguments valid for their schema.",
    "- If you do NOT need a tool, just answer the user normally in plain text (no JSON block).",
    "- Once tool results are provided to you, use them to answer the user in plain text.",
    forced,
  ]
    .filter(Boolean)
    .join("\n");
}

// Convert OpenAI tool-flow messages into plain text the model can read, since
// Qwen only accepts simple user/assistant/system turns.
export function normalizeToolMessages(messages: any[]): any[] {
  return messages.map((m) => {
    if (m?.role === "tool") {
      const name = m.name || m.tool_call_id || "tool";
      const content = typeof m.content === "string" ? m.content : JSON.stringify(m.content ?? "");
      return { role: "user", content: `Tool result from ${name}:\n${content}` };
    }
    if (m?.role === "assistant" && Array.isArray(m.tool_calls) && m.tool_calls.length) {
      const calls = m.tool_calls
        .map((c: any) => `${c?.function?.name}(${c?.function?.arguments || "{}"})`)
        .join(", ");
      const text = typeof m.content === "string" && m.content ? m.content + "\n" : "";
      return { role: "assistant", content: `${text}[called tool: ${calls}]` };
    }
    return m;
  });
}

// Try to extract tool calls from the model's output. Returns null if none.
export function parseToolCalls(text: string): { calls: ParsedToolCall[] } | null {
  if (!text) return null;

  const candidates: string[] = [];
  // Fenced ```json ... ``` blocks first.
  const fenceRe = /```(?:json)?\s*([\s\S]*?)```/gi;
  let m: RegExpExecArray | null;
  while ((m = fenceRe.exec(text))) candidates.push(m[1].trim());
  // Otherwise the whole trimmed body, if it looks like a JSON object.
  const trimmed = text.trim();
  if (trimmed.startsWith("{") && trimmed.endsWith("}")) candidates.push(trimmed);

  for (const c of candidates) {
    let obj: any;
    try {
      obj = JSON.parse(c);
    } catch {
      continue;
    }
    // Accept {tool_calls:[...]} or a single {tool_call:{...}} / {name,arguments}.
    let raw: any[] | null = null;
    if (Array.isArray(obj?.tool_calls)) raw = obj.tool_calls;
    else if (obj?.tool_call) raw = [obj.tool_call];
    else if (obj?.name && obj?.arguments !== undefined) raw = [obj];

    if (!raw || raw.length === 0) continue;
    const calls = raw
      .filter((c: any) => typeof c?.name === "string" && c.name)
      .map((c: any) => ({
        id: "call_" + randomUUID().replace(/-/g, "").slice(0, 24),
        type: "function" as const,
        function: {
          name: c.name,
          arguments: typeof c.arguments === "string" ? c.arguments : JSON.stringify(c.arguments ?? {}),
        },
      }));
    if (calls.length) return { calls };
  }
  return null;
}

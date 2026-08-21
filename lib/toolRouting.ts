import { applyToolPolicy, buildRegistry, type OAITool, type OAIToolCall } from "./tools";

const INTENT_OPEN = "<qwen_tool_intent>";
const INTENT_CLOSE = "</qwen_tool_intent>";

export function hasToolResults(messages: any[]): boolean {
  return messages.some((message) => message?.role === "tool") ||
    messages.some((message) => message?.role === "assistant" && Array.isArray(message?.tool_calls) && message.tool_calls.length > 0);
}

export function compactToolIntentPrompt(tools: OAITool[], toolChoice: any): string {
  const definitions = tools.flatMap((tool) => {
    const name = tool?.function?.name;
    if (!name) return [];
    return [JSON.stringify({ name, description: tool.function?.description || "" })];
  });
  const forced = typeof toolChoice === "object" ? toolChoice?.function?.name : null;
  return [
    "# Tool intent decision",
    "Decide whether the latest user request genuinely requires one of the available client tools.",
    "Available tools (names and descriptions only):",
    ...definitions,
    "If no tool is needed, answer the user normally and do not emit an intent tag.",
    `If a tool is needed, output exactly ${INTENT_OPEN}{\"required\":true}${INTENT_CLOSE} and nothing else.`,
    "Do not invent tool results or tool arguments. Another model will select the call after this decision.",
    toolChoice === "required" ? "The client requires a tool call, so emit the intent tag." : "",
    forced ? `The client requires the ${JSON.stringify(forced)} tool, so emit the intent tag.` : "",
  ].filter(Boolean).join("\n");
}

export function parseToolIntent(text: string): { required: boolean; answer: string } {
  const trimmed = text.trim();
  const marker = `${INTENT_OPEN}{"required":true}${INTENT_CLOSE}`;
  return trimmed === marker ? { required: true, answer: "" } : { required: false, answer: text };
}

function validArguments(value: unknown): value is string {
  if (typeof value !== "string") return false;
  try { return !!JSON.parse(value) && typeof JSON.parse(value) === "object" && !Array.isArray(JSON.parse(value)); }
  catch { return false; }
}

export function validateNativeToolCalls(raw: unknown, tools: OAITool[], body: any): OAIToolCall[] {
  if (!Array.isArray(raw)) return [];
  const registry = buildRegistry(tools);
  const calls: OAIToolCall[] = [];
  for (const item of raw) {
    const name = item?.function?.name;
    if (typeof name !== "string" || !registry.names.includes(name) || !validArguments(item?.function?.arguments)) return [];
    calls.push({
      id: typeof item.id === "string" && item.id ? item.id : `call_router_${calls.length}`,
      type: "function",
      function: { name, arguments: item.function.arguments },
    });
  }
  if (!calls.length) return [];
  return applyToolPolicy(calls, body, registry);
}

export function routerMessages(messages: any[]): any[] {
  return messages.filter((message) => message?.role !== "tool").map((message) => ({ role: message.role, content: message.content }));
}

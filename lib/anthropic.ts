// Translation between Anthropic's Messages API shape and the OpenAI chat shape our
// backend already speaks. Lets Anthropic SDK clients hit /v1/messages unchanged.

// Anthropic SDKs default to claude-* model names; map those (and unknowns) to our
// flagship so it works out of the box. Real Qwen ids pass through.
export function mapModel(model?: string): string {
  if (!model || /^claude/i.test(model)) return "qwen3.8-max";
  return model;
}

export function stopReason(finish?: string): string {
  switch (finish) {
    case "length": return "max_tokens";
    case "tool_calls": return "tool_use";
    case "stop": return "end_turn";
    default: return "end_turn";
  }
}

// Anthropic request -> OpenAI request.
export function anthropicToOpenAI(body: any): any {
  const messages: any[] = [];

  // Top-level system (string or blocks) -> a system message.
  if (body.system) {
    const sys = typeof body.system === "string"
      ? body.system
      : Array.isArray(body.system) ? body.system.map((b: any) => b?.text || "").join("\n") : "";
    if (sys) messages.push({ role: "system", content: sys });
  }

  for (const m of body.messages || []) {
    if (typeof m.content === "string") {
      messages.push({ role: m.role, content: m.content });
      continue;
    }
    const parts: any[] = [];      // text/image parts
    const toolCalls: any[] = [];  // assistant tool_use
    const toolResults: any[] = []; // user tool_result -> role:"tool"
    for (const blk of m.content || []) {
      if (blk.type === "text") parts.push({ type: "text", text: blk.text || "" });
      else if (blk.type === "image" && blk.source) {
        const url = blk.source.type === "base64"
          ? `data:${blk.source.media_type};base64,${blk.source.data}`
          : blk.source.url;
        if (url) parts.push({ type: "image_url", image_url: { url } });
      } else if (blk.type === "tool_use") {
        toolCalls.push({ id: blk.id, type: "function", function: { name: blk.name, arguments: JSON.stringify(blk.input || {}) } });
      } else if (blk.type === "tool_result") {
        const content = typeof blk.content === "string"
          ? blk.content
          : Array.isArray(blk.content) ? blk.content.map((c: any) => c?.text || "").join("\n") : JSON.stringify(blk.content ?? "");
        toolResults.push({ role: "tool", tool_call_id: blk.tool_use_id, content });
      }
    }

    if (m.role === "assistant") {
      const text = parts.filter((p) => p.type === "text").map((p) => p.text).join("");
      const msg: any = { role: "assistant", content: text || null };
      if (toolCalls.length) msg.tool_calls = toolCalls;
      messages.push(msg);
    } else {
      // tool results become their own role:"tool" messages, before any user text.
      if (toolResults.length) messages.push(...toolResults);
      if (parts.length) {
        const onlyText = parts.length === 1 && parts[0].type === "text";
        messages.push({ role: "user", content: onlyText ? parts[0].text : parts });
      }
    }
  }

  const out: any = { model: mapModel(body.model), messages, stream: body.stream === true };
  if (typeof body.temperature === "number") out.temperature = body.temperature;

  if (Array.isArray(body.tools) && body.tools.length) {
    out.tools = body.tools.map((t: any) => ({
      type: "function",
      function: { name: t.name, description: t.description || "", parameters: t.input_schema || { type: "object", properties: {} } },
    }));
  }
  if (body.tool_choice) {
    const tc = body.tool_choice;
    out.tool_choice = tc.type === "any" ? "required"
      : tc.type === "tool" ? { type: "function", function: { name: tc.name } }
      : tc.type === "none" ? "none" : "auto";
  }
  return out;
}

// OpenAI (non-stream) response -> Anthropic message.
export function openAIToAnthropic(oai: any, model: string): any {
  const choice = oai?.choices?.[0] || {};
  const msg = choice.message || {};
  const content: any[] = [];
  if (msg.content) content.push({ type: "text", text: msg.content });
  for (const tc of msg.tool_calls || []) {
    let input: any = {};
    try { input = JSON.parse(tc.function?.arguments || "{}"); } catch { input = {}; }
    content.push({ type: "tool_use", id: tc.id, name: tc.function?.name, input });
  }
  return {
    id: (oai?.id || "msg").replace(/^chatcmpl-/, "msg_"),
    type: "message",
    role: "assistant",
    model,
    content,
    stop_reason: msg.tool_calls?.length ? "tool_use" : stopReason(choice.finish_reason),
    stop_sequence: null,
    usage: {
      input_tokens: oai?.usage?.prompt_tokens || 0,
      output_tokens: oai?.usage?.completion_tokens || 0,
    },
  };
}

export function anthropicError(oai: any, status: number): any {
  const type = status === 401 ? "authentication_error" : status === 404 ? "not_found_error" : status === 429 ? "rate_limit_error" : "api_error";
  return { type: "error", error: { type, message: oai?.error?.message || "Request failed." } };
}

import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { POST as chatCompletions } from "../chat/completions/route";
import { anthropicToOpenAI, openAIToAnthropic, anthropicError, mapModel, stopReason } from "@/lib/anthropic";

export const runtime = "nodejs";
export const maxDuration = 300;

// Anthropic Messages API (POST /v1/messages). Translates the request to our OpenAI
// chat shape, runs it through the existing completions handler in-process, then
// translates the result (streaming or not) back to Anthropic's format. Auth is the
// Anthropic `x-api-key` header (or a Bearer token — both are accepted).
export async function POST(req: NextRequest) {
  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ type: "error", error: { type: "invalid_request_error", message: "Invalid JSON." } }, { status: 400 });
  }

  const wantStream = body.stream === true;
  const model = mapModel(body.model);
  const openaiBody = anthropicToOpenAI(body);

  // Forward the caller's key to the internal completions handler.
  const headers = new Headers({ "content-type": "application/json" });
  const xkey = req.headers.get("x-api-key");
  const authz = req.headers.get("authorization");
  if (authz) headers.set("authorization", authz);
  if (xkey) headers.set("x-api-key", xkey);

  const internal = new NextRequest(new URL("/api/v1/chat/completions", req.nextUrl.origin), {
    method: "POST",
    headers,
    body: JSON.stringify(openaiBody),
  });

  const res = await chatCompletions(internal);

  // --- non-streaming ---
  if (!wantStream || !res.ok || !res.body || !/text\/event-stream/i.test(res.headers.get("content-type") || "")) {
    const oai = await res.json().catch(() => null);
    if (!res.ok) return NextResponse.json(anthropicError(oai, res.status), { status: res.status });
    return NextResponse.json(openAIToAnthropic(oai, model));
  }

  // --- streaming: OpenAI SSE -> Anthropic SSE events ---
  const encoder = new TextEncoder();
  const msgId = "msg_" + randomUUID().replace(/-/g, "").slice(0, 24);

  const stream = new ReadableStream({
    async start(controller) {
      const send = (event: string, data: unknown) =>
        controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));

      send("message_start", {
        type: "message_start",
        message: { id: msgId, type: "message", role: "assistant", model, content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 0, output_tokens: 0 } },
      });

      let textOpen = false;
      let stop = "end_turn";
      const toolCalls: any[] = [];
      const reader = res.body!.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          let idx: number;
          while ((idx = buffer.indexOf("\n")) !== -1) {
            const line = buffer.slice(0, idx).trim();
            buffer = buffer.slice(idx + 1);
            if (!line.startsWith("data:")) continue;
            const data = line.slice(5).trim();
            if (data === "[DONE]") continue;
            let d: any;
            try { d = JSON.parse(data); } catch { continue; }
            const delta = d.choices?.[0]?.delta || {};
            const finish = d.choices?.[0]?.finish_reason;
            if (delta.content) {
              if (!textOpen) { send("content_block_start", { type: "content_block_start", index: 0, content_block: { type: "text", text: "" } }); textOpen = true; }
              send("content_block_delta", { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: delta.content } });
            }
            if (Array.isArray(delta.tool_calls)) for (const tc of delta.tool_calls) toolCalls.push(tc);
            if (finish) stop = stopReason(finish);
          }
        }
      } catch { /* upstream ended */ }

      if (textOpen) send("content_block_stop", { type: "content_block_stop", index: 0 });

      const base = textOpen ? 1 : 0;
      toolCalls.forEach((tc, i) => {
        const index = base + i;
        send("content_block_start", { type: "content_block_start", index, content_block: { type: "tool_use", id: tc.id, name: tc.function?.name, input: {} } });
        send("content_block_delta", { type: "content_block_delta", index, delta: { type: "input_json_delta", partial_json: tc.function?.arguments || "{}" } });
        send("content_block_stop", { type: "content_block_stop", index });
      });
      if (toolCalls.length) stop = "tool_use";

      send("message_delta", { type: "message_delta", delta: { stop_reason: stop, stop_sequence: null }, usage: { output_tokens: 0 } });
      send("message_stop", { type: "message_stop" });
      controller.close();
    },
  });

  return new Response(stream, { headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", Connection: "keep-alive" } });
}

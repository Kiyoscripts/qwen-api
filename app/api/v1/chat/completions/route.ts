import { NextRequest, NextResponse } from "next/server";
import {
  buildMessage,
  createChat,
  deleteChat,
  forgetAllMemories,
  imageUrlsIn,
  openCompletion,
  qwenDeltas,
  resolveModel,
  showReasoning,
  uploadImages,
  QwenError,
  type OpenAIMessage,
} from "@/lib/qwen";
import { pickToken } from "@/lib/tokens";
import { extractApiKey, validateApiKey, logUsage } from "@/lib/supabase";
import { toolsEnabled, buildToolPreamble, normalizeToolMessages, parseToolCalls } from "@/lib/tools";
import { randomUUID } from "node:crypto";

export const runtime = "nodejs";
export const maxDuration = 300;

const DEFAULT_MODEL = "qwen3.8-max-preview";

function err(message: string, status: number, type = "invalid_request_error") {
  return NextResponse.json({ error: { message, type } }, { status });
}

export async function POST(req: NextRequest) {
  const key = extractApiKey(req.headers);
  if (!key) return err("Missing API key. Send 'Authorization: Bearer <key>'.", 401);
  const record = await validateApiKey(key);
  if (!record) return err("Invalid or revoked API key.", 401);

  let body: any;
  try {
    body = await req.json();
  } catch {
    return err("Request body must be valid JSON.", 400);
  }
  const messages: OpenAIMessage[] = Array.isArray(body.messages) ? body.messages : [];
  if (messages.length === 0) return err("'messages' must be a non-empty array.", 400);
  const wantStream = body.stream === true;
  const modelId = typeof body.model === "string" && body.model ? body.model : DEFAULT_MODEL;

  let pooled;
  try {
    pooled = await pickToken();
  } catch (e: any) {
    return err(e.message, 503, "no_token");
  }
  const token = pooled.token;

  const model = await resolveModel(token, modelId);
  if (!model) return err(`Model '${modelId}' is not available.`, 404, "model_not_found");

  const hadImage = imageUrlsIn(messages[messages.length - 1]).length > 0;
  let files;
  try {
    files = await uploadImages(token, imageUrlsIn(messages[messages.length - 1]));
  } catch (e: any) {
    return err(`Image upload failed: ${e.message}`, 400);
  }

  // Tool calling: Qwen ignores `tools`, so we do it via prompt + response parsing.
  const useTools = toolsEnabled(body.tools, body.tool_choice);
  const promptMessages: OpenAIMessage[] = useTools
    ? ([{ role: "system", content: buildToolPreamble(body.tools, body.tool_choice) }, ...normalizeToolMessages(messages)] as OpenAIMessage[])
    : messages;

  let chatId: string | undefined;
  let qwenRes: Response;
  try {
    chatId = await createChat(token, modelId, "t2t");
    const qwenMessages = [buildMessage(promptMessages, { model: modelId, chatType: "t2t", files, thinking: model.thinking })];
    // Always stream from Qwen (it returns SSE); we buffer it for non-streaming clients.
    qwenRes = await openCompletion(token, chatId, { model: modelId, messages: qwenMessages, stream: true });
  } catch (e: any) {
    await deleteChat(token, chatId);
    const status = e instanceof QwenError ? e.status : 502;
    logUsage(record.id, modelId, hadImage, wantStream, status);
    return err(e.message || "Upstream error", status, "upstream_error");
  }

  const id = "chatcmpl-" + randomUUID();
  const created = Math.floor(Date.now() / 1000);
  const cleanup = async () => {
    await Promise.all([deleteChat(token, chatId), forgetAllMemories(token)]);
  };
  const withReasoning = showReasoning();

  if (wantStream) {
    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      async start(controller) {
        const send = (obj: unknown) => controller.enqueue(encoder.encode(`data: ${JSON.stringify(obj)}\n\n`));
        send({ id, object: "chat.completion.chunk", created, model: modelId, choices: [{ index: 0, delta: { role: "assistant" }, finish_reason: null }] });
        let finish = "stop";
        try {
          if (useTools) {
            // A tool call is only valid once complete, so buffer then emit.
            let buffered = "";
            for await (const { phase, text } of qwenDeltas(qwenRes)) {
              if (phase === "think") {
                if (withReasoning) send({ id, object: "chat.completion.chunk", created, model: modelId, choices: [{ index: 0, delta: { reasoning_content: text }, finish_reason: null }] });
              } else buffered += text;
            }
            const parsed = parseToolCalls(buffered);
            if (parsed) {
              finish = "tool_calls";
              send({
                id, object: "chat.completion.chunk", created, model: modelId,
                choices: [{ index: 0, delta: { tool_calls: parsed.calls.map((c, i) => ({ index: i, ...c })) }, finish_reason: null }],
              });
            } else if (buffered) {
              send({ id, object: "chat.completion.chunk", created, model: modelId, choices: [{ index: 0, delta: { content: buffered }, finish_reason: null }] });
            }
          } else {
            for await (const { phase, text } of qwenDeltas(qwenRes)) {
              const delta =
                phase === "think"
                  ? withReasoning
                    ? { reasoning_content: text }
                    : null
                  : { content: text };
              if (delta) send({ id, object: "chat.completion.chunk", created, model: modelId, choices: [{ index: 0, delta, finish_reason: null }] });
            }
          }
        } catch (e: any) {
          send({ id, object: "chat.completion.chunk", created, model: modelId, choices: [{ index: 0, delta: { content: `\n[error: ${e.message}]` }, finish_reason: null }] });
        }
        send({ id, object: "chat.completion.chunk", created, model: modelId, choices: [{ index: 0, delta: {}, finish_reason: finish }] });
        controller.enqueue(encoder.encode("data: [DONE]\n\n"));
        controller.close();
        await cleanup();
        logUsage(record.id, modelId, hadImage, true, 200);
      },
    });
    return new Response(stream, { headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", Connection: "keep-alive" } });
  }

  let content = "";
  let reasoning = "";
  try {
    for await (const { phase, text } of qwenDeltas(qwenRes)) {
      if (phase === "think") reasoning += text;
      else content += text;
    }
  } catch (e: any) {
    await cleanup();
    const status = e instanceof QwenError ? e.status : 502;
    logUsage(record.id, modelId, hadImage, false, status);
    return err(e.message, status, "upstream_error");
  }
  await cleanup();
  logUsage(record.id, modelId, hadImage, false, 200);

  const parsed = useTools ? parseToolCalls(content) : null;
  const message: Record<string, unknown> = parsed
    ? { role: "assistant", content: null, tool_calls: parsed.calls }
    : { role: "assistant", content };
  if (withReasoning && reasoning) message.reasoning_content = reasoning;

  return NextResponse.json({
    id,
    object: "chat.completion",
    created,
    model: modelId,
    choices: [{ index: 0, message, finish_reason: parsed ? "tool_calls" : "stop" }],
    usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
  });
}

import { NextRequest, NextResponse } from "next/server";
import {
  ALLOWED_MODEL,
  buildQwenMessages,
  createChat,
  deleteChat,
  forgetAllMemories,
  imageUrlsIn,
  openQwenStream,
  qwenDeltas,
  showReasoning,
  uploadImages,
  QwenError,
  type OpenAIMessage,
} from "@/lib/qwen";
import { extractApiKey, validateApiKey, logUsage } from "@/lib/supabase";
import { randomUUID } from "node:crypto";

export const runtime = "nodejs";
export const maxDuration = 300;

function err(message: string, status: number, type = "invalid_request_error") {
  return NextResponse.json({ error: { message, type } }, { status });
}

export async function POST(req: NextRequest) {
  // --- auth ---
  const key = extractApiKey(req.headers);
  if (!key) return err("Missing API key. Send 'Authorization: Bearer <key>'.", 401);
  const record = await validateApiKey(key);
  if (!record) return err("Invalid or revoked API key.", 401);

  // --- parse ---
  let body: any;
  try {
    body = await req.json();
  } catch {
    return err("Request body must be valid JSON.", 400);
  }
  if (body.model && body.model !== ALLOWED_MODEL) {
    return err(`Model '${body.model}' is not available. This API only serves '${ALLOWED_MODEL}'.`, 404, "model_not_found");
  }
  const messages: OpenAIMessage[] = Array.isArray(body.messages) ? body.messages : [];
  if (messages.length === 0) return err("'messages' must be a non-empty array.", 400);
  const wantStream = body.stream === true;

  // --- vision: upload images on the latest user turn ---
  let files;
  const hadImage = imageUrlsIn(messages[messages.length - 1]).length > 0;
  try {
    files = await uploadImages(imageUrlsIn(messages[messages.length - 1]));
  } catch (e: any) {
    return err(`Image upload failed: ${e.message}`, 400);
  }

  // --- open the Qwen stream (throwaway chat) ---
  let chatId: string | undefined;
  let qwenRes: Response;
  try {
    chatId = await createChat();
    qwenRes = await openQwenStream(chatId, buildQwenMessages(messages, files));
  } catch (e: any) {
    await deleteChat(chatId);
    const status = e instanceof QwenError ? e.status : 502;
    logUsage(record.id, ALLOWED_MODEL, hadImage, wantStream, status);
    return err(e.message || "Upstream error", status, "upstream_error");
  }

  const id = "chatcmpl-" + randomUUID();
  const created = Math.floor(Date.now() / 1000);

  // Always clean up the shared Qwen account after the answer is done.
  const cleanup = async () => {
    await Promise.all([deleteChat(chatId), forgetAllMemories()]);
  };

  const withReasoning = showReasoning();

  if (wantStream) {
    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      async start(controller) {
        const send = (obj: unknown) => controller.enqueue(encoder.encode(`data: ${JSON.stringify(obj)}\n\n`));
        send({ id, object: "chat.completion.chunk", created, model: ALLOWED_MODEL, choices: [{ index: 0, delta: { role: "assistant" }, finish_reason: null }] });
        try {
          for await (const { phase, text } of qwenDeltas(qwenRes)) {
            // Reasoning goes to reasoning_content; the answer goes to content.
            const delta =
              phase === "think"
                ? withReasoning
                  ? { reasoning_content: text }
                  : null
                : { content: text };
            if (delta) send({ id, object: "chat.completion.chunk", created, model: ALLOWED_MODEL, choices: [{ index: 0, delta, finish_reason: null }] });
          }
        } catch (e: any) {
          send({ id, object: "chat.completion.chunk", created, model: ALLOWED_MODEL, choices: [{ index: 0, delta: { content: `\n[error: ${e.message}]` }, finish_reason: null }] });
        }
        send({ id, object: "chat.completion.chunk", created, model: ALLOWED_MODEL, choices: [{ index: 0, delta: {}, finish_reason: "stop" }] });
        controller.enqueue(encoder.encode("data: [DONE]\n\n"));
        controller.close();
        await cleanup();
        logUsage(record.id, ALLOWED_MODEL, hadImage, true, 200);
      },
    });
    return new Response(stream, {
      headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", Connection: "keep-alive" },
    });
  }

  // --- non-streaming ---
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
    logUsage(record.id, ALLOWED_MODEL, hadImage, false, status);
    return err(e.message, status, "upstream_error");
  }
  await cleanup();
  logUsage(record.id, ALLOWED_MODEL, hadImage, false, 200);

  const message: Record<string, unknown> = { role: "assistant", content };
  if (withReasoning && reasoning) message.reasoning_content = reasoning;

  return NextResponse.json({
    id,
    object: "chat.completion",
    created,
    model: ALLOWED_MODEL,
    choices: [{ index: 0, message, finish_reason: "stop" }],
    usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
  });
}

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
import { withTokenFailover } from "@/lib/tokens";
import { extractApiKey, validateApiKey, logUsage } from "@/lib/supabase";
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

  // Tool / function calling is not supported: chat.qwen.ai ignores custom tool
  // schemas, and emulating it in the prompt proved unreliable. Fail loudly rather
  // than silently returning prose to a caller that is waiting for tool_calls.
  if (Array.isArray(body.tools) && body.tools.length > 0 && body.tool_choice !== "none") {
    return err(
      "Tool/function calling is not supported by this API. Remove 'tools' (or send tool_choice: \"none\").",
      400,
      "tools_not_supported"
    );
  }
  const wantStream = body.stream === true;
  const modelId = typeof body.model === "string" && body.model ? body.model : DEFAULT_MODEL;

  const hadImage = imageUrlsIn(messages[messages.length - 1]).length > 0;

  // Run the whole setup under token failover: if an account is out of quota,
  // rate-limited or expired, transparently retry on a different pooled account.
  let token: string;
  let chatId: string | undefined;
  let qwenRes: Response;
  try {
    const { token: usedToken, result } = await withTokenFailover(async (candidate) => {
      const model = await resolveModel(candidate, modelId);
      if (!model) throw new QwenError(`Model '${modelId}' is not available.`, 404);
      const files = await uploadImages(candidate, imageUrlsIn(messages[messages.length - 1]));

      let cid: string | undefined;
      try {
        cid = await createChat(candidate, modelId, "t2t");
        const qwenMessages = [buildMessage(messages, { model: modelId, chatType: "t2t", files, thinking: model.thinking })];
        // Always stream from Qwen (it returns SSE); we buffer it for non-streaming clients.
        const res = await openCompletion(candidate, cid, { model: modelId, messages: qwenMessages, stream: true });
        return { chatId: cid, res };
      } catch (e) {
        // Don't leave an orphan chat behind on the account we're abandoning.
        await deleteChat(candidate, cid);
        throw e;
      }
    });
    token = usedToken;
    chatId = result.chatId;
    qwenRes = result.res;
  } catch (e: any) {
    const status = e instanceof QwenError ? e.status : 502;
    logUsage(record.id, modelId, hadImage, wantStream, status);
    return err(e.message || "Upstream error", status, status === 404 ? "model_not_found" : "upstream_error");
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
        try {
          for await (const { phase, text } of qwenDeltas(qwenRes)) {
            const delta =
              phase === "think"
                ? withReasoning
                  ? { reasoning_content: text }
                  : null
                : { content: text };
            if (delta) send({ id, object: "chat.completion.chunk", created, model: modelId, choices: [{ index: 0, delta, finish_reason: null }] });
          }
        } catch (e: any) {
          send({ id, object: "chat.completion.chunk", created, model: modelId, choices: [{ index: 0, delta: { content: `\n[error: ${e.message}]` }, finish_reason: null }] });
        }
        send({ id, object: "chat.completion.chunk", created, model: modelId, choices: [{ index: 0, delta: {}, finish_reason: "stop" }] });
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

  const message: Record<string, unknown> = { role: "assistant", content };
  if (withReasoning && reasoning) message.reasoning_content = reasoning;

  return NextResponse.json({
    id,
    object: "chat.completion",
    created,
    model: modelId,
    choices: [{ index: 0, message, finish_reason: "stop" }],
    usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
  });
}

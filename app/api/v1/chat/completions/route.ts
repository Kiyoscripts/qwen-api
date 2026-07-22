import { NextRequest, NextResponse } from "next/server";
import {
  buildMessage,
  createChat,
  deleteChat,
  forgetAllMemories,
  imageUrlsIn,
  messageText,
  openCompletion,
  pollTask,
  qwenDeltas,
  resolveModel,
  showReasoning,
  uploadImages,
  QwenError,
  type OpenAIMessage,
} from "@/lib/qwen";
import { withTokenFailover } from "@/lib/tokens";
import { virtualModel, generateImage, startVideo, type VirtualModel } from "@/lib/media";
import {
  isDeepSeekModel,
  resolveDeepSeekModel,
  createSession,
  deleteSession,
  openCompletion as openDeepSeekCompletion,
  deepseekDeltas,
  collapseMessages,
  uploadImages as uploadDeepSeekImages,
  DeepSeekError,
} from "@/lib/deepseek";
import { extractApiKey, validateApiKey, logUsage, getDeepSeekToken, noteDeepSeekTokenError } from "@/lib/supabase";
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

  // DeepSeek models are served by a separate reverse-engineered backend
  // (chat.deepseek.com) rather than the Qwen account pool.
  if (isDeepSeekModel(modelId)) {
    return handleDeepSeek({ messages, modelId, wantStream, hadImage, thinking: body.thinking === true, recordId: record.id });
  }

  // Image / video generation models: generate a result and return it as markdown
  // media, so picking e.g. `qwen-image-3.0` in a chat just produces an image.
  const vm = virtualModel(modelId);
  if (vm) {
    return handleMedia({ vm, messages, wantStream, size: typeof body.size === "string" ? body.size : undefined, recordId: record.id });
  }

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

// --- DeepSeek (chat.deepseek.com) -------------------------------------------
// Stateless like the Qwen path: create a throwaway session, send the collapsed
// history as one prompt, stream, then delete the session. DeepThink reasoning is
// exposed as `reasoning_content`. Images route to the dedicated "vision" model.
async function handleDeepSeek(args: {
  messages: OpenAIMessage[];
  modelId: string;
  wantStream: boolean;
  hadImage: boolean;
  thinking: boolean;
  recordId: string;
}) {
  const { messages, modelId, wantStream, hadImage, thinking, recordId } = args;

  const model = resolveDeepSeekModel(modelId);
  if (!model) {
    logUsage(recordId, modelId, hadImage, wantStream, 404);
    return err(`Model '${modelId}' is not available.`, 404, "model_not_found");
  }

  // "Bring your own token": each key runs on its owner's own DeepSeek account.
  // Fall back to an owner-wide DEEPSEEK_TOKEN only if the env has one set.
  const token = (await getDeepSeekToken(recordId)) || process.env.DEEPSEEK_TOKEN || null;
  if (!token) {
    logUsage(recordId, modelId, hadImage, wantStream, 402);
    return err(
      "No DeepSeek account linked to this API key. Link your DeepSeek token at /link to use the deepseek-* models.",
      402,
      "deepseek_not_linked"
    );
  }

  // Only the vision model accepts images, so an image forces model_type "vision".
  const imageUrls = imageUrlsIn(messages[messages.length - 1]);
  const modelType = imageUrls.length > 0 ? "vision" : model.modelType;
  const prompt = collapseMessages(messages);

  let sessionId: string | undefined;
  let dsRes: Response;
  try {
    // Uploads + waits for each image to finish parsing (status SUCCESS) before use.
    const refFileIds = imageUrls.length > 0 ? await uploadDeepSeekImages(token, imageUrls) : [];
    sessionId = await createSession(token);
    dsRes = await openDeepSeekCompletion(token, { sessionId, modelType, prompt, refFileIds, thinking });
  } catch (e: any) {
    await deleteSession(token, sessionId);
    const status = e instanceof DeepSeekError ? e.status : 502;
    if (status === 401) noteDeepSeekTokenError(recordId, e.message || "token rejected");
    logUsage(recordId, modelId, hadImage, wantStream, status);
    return err(e.message || "Upstream error", status, "upstream_error");
  }

  const id = "chatcmpl-" + randomUUID();
  const created = Math.floor(Date.now() / 1000);
  const cleanup = () => deleteSession(token, sessionId);

  if (wantStream) {
    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      async start(controller) {
        const send = (obj: unknown) => controller.enqueue(encoder.encode(`data: ${JSON.stringify(obj)}\n\n`));
        send({ id, object: "chat.completion.chunk", created, model: modelId, choices: [{ index: 0, delta: { role: "assistant" }, finish_reason: null }] });
        try {
          for await (const { kind, text } of deepseekDeltas(dsRes)) {
            const delta = kind === "thinking" ? { reasoning_content: text } : { content: text };
            send({ id, object: "chat.completion.chunk", created, model: modelId, choices: [{ index: 0, delta, finish_reason: null }] });
          }
        } catch (e: any) {
          send({ id, object: "chat.completion.chunk", created, model: modelId, choices: [{ index: 0, delta: { content: `\n[error: ${e.message}]` }, finish_reason: null }] });
        }
        send({ id, object: "chat.completion.chunk", created, model: modelId, choices: [{ index: 0, delta: {}, finish_reason: "stop" }] });
        controller.enqueue(encoder.encode("data: [DONE]\n\n"));
        controller.close();
        await cleanup();
        logUsage(recordId, modelId, hadImage, true, 200);
      },
    });
    return new Response(stream, { headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", Connection: "keep-alive" } });
  }

  let content = "";
  let reasoning = "";
  try {
    for await (const { kind, text } of deepseekDeltas(dsRes)) {
      if (kind === "thinking") reasoning += text;
      else content += text;
    }
  } catch (e: any) {
    await cleanup();
    const status = e instanceof DeepSeekError ? e.status : 502;
    logUsage(recordId, modelId, hadImage, false, status);
    return err(e.message, status, "upstream_error");
  }
  await cleanup();
  logUsage(recordId, modelId, hadImage, false, 200);

  const message: Record<string, unknown> = { role: "assistant", content };
  if (reasoning) message.reasoning_content = reasoning;

  return NextResponse.json({
    id,
    object: "chat.completion",
    created,
    model: modelId,
    choices: [{ index: 0, message, finish_reason: "stop" }],
    usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
  });
}

// --- Image / video generation models ----------------------------------------
// Turns the model choice into a media generation and returns the result as a
// markdown image, e.g. `![prompt](url)`. The chat UI renders these (and video
// URLs) inline. Reference images on the last turn switch image gen -> editing.
async function handleMedia(args: {
  vm: VirtualModel;
  messages: OpenAIMessage[];
  wantStream: boolean;
  size?: string;
  recordId: string;
}) {
  const { vm, messages, wantStream, size, recordId } = args;
  const last = messages[messages.length - 1];
  const prompt = messageText(last).trim();
  const images = imageUrlsIn(last);
  const hadImage = images.length > 0;

  if (!prompt && !hadImage) return err("A prompt is required to generate media.", 400);

  let markdown: string;
  try {
    if (vm.kind === "image") {
      const { result: url } = await withTokenFailover((token) =>
        generateImage(token, { prompt, images, imageModelId: vm.imageModelId, size })
      );
      markdown = `![${(prompt || "edited image").slice(0, 80)}](${url})`;
    } else {
      // Video: start the task, then poll (bounded by this function's duration).
      const { token, result } = await withTokenFailover((t) => startVideo(t, prompt));
      const url = await pollTask(token, result.taskId, 280_000);
      void Promise.all([deleteChat(token, result.chatId), forgetAllMemories(token)]);
      markdown = `![video](${url})`;
    }
  } catch (e: any) {
    const status = e instanceof QwenError ? e.status : 502;
    logUsage(recordId, vm.id, hadImage, wantStream, status);
    return err(e.message || "Media generation failed", status, "upstream_error");
  }
  logUsage(recordId, vm.id, hadImage, wantStream, 200);

  const id = "chatcmpl-" + randomUUID();
  const created = Math.floor(Date.now() / 1000);

  if (wantStream) {
    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      start(controller) {
        const send = (o: unknown) => controller.enqueue(encoder.encode(`data: ${JSON.stringify(o)}\n\n`));
        send({ id, object: "chat.completion.chunk", created, model: vm.id, choices: [{ index: 0, delta: { role: "assistant" }, finish_reason: null }] });
        send({ id, object: "chat.completion.chunk", created, model: vm.id, choices: [{ index: 0, delta: { content: markdown }, finish_reason: null }] });
        send({ id, object: "chat.completion.chunk", created, model: vm.id, choices: [{ index: 0, delta: {}, finish_reason: "stop" }] });
        controller.enqueue(encoder.encode("data: [DONE]\n\n"));
        controller.close();
      },
    });
    return new Response(stream, { headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", Connection: "keep-alive" } });
  }

  return NextResponse.json({
    id,
    object: "chat.completion",
    created,
    model: vm.id,
    choices: [{ index: 0, message: { role: "assistant", content: markdown }, finish_reason: "stop" }],
    usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
  });
}

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
import { resolveWatermark, buildMediaUrl } from "@/lib/watermark";
import { hasTools, preprocessToolMessages, parseToolCalls, type OAIToolCall } from "@/lib/tools";
import { customModel, systemPromptFor } from "@/lib/customModels";
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

// These models require feature_config.thinking_enabled = true — they can't run in
// "Fast" (non-thinking) mode, so `enable_thinking: false` is ignored for them.
const REQUIRE_THINKING = new Set(["qwen3.8-max-preview"]);

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

  // Tool / function calling is emulated at the proxy: the schemas are injected into
  // the prompt (Qwen-native <tool_call> convention) and parsed back into OpenAI
  // tool_calls. See lib/tools.ts.
  const toolsOn = hasTools(body);
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
    return handleMedia({
      vm,
      messages,
      wantStream,
      size: typeof body.size === "string" ? body.size : undefined,
      watermark: resolveWatermark(body.watermark),
      origin: req.nextUrl.origin,
      recordId: record.id,
    });
  }

  // Custom slugs (e.g. unlocked-qwen-3.8-max-preview) run on a real Qwen model with
  // a baked-in system prompt. `modelId` stays the requested slug for responses and
  // logging; `backendModel` is what actually gets called.
  const cm = customModel(modelId);
  const backendModel = cm?.baseModel || modelId;

  // With tools on, flatten the OpenAI tool-flow (assistant tool_calls, role:"tool"
  // results) into text and append the tool-protocol system section.
  let effMessages: any[] = toolsOn ? preprocessToolMessages(messages, body.tools, body.tool_choice) : messages;
  // The persona goes first so the caller's own system prompt layers on top of it.
  if (cm) {
    const persona = systemPromptFor(cm);
    if (persona) effMessages = [{ role: "system", content: persona }, ...effMessages];
  }

  // Run the whole setup under token failover: if an account is out of quota,
  // rate-limited or expired, transparently retry on a different pooled account.
  let token: string;
  let chatId: string | undefined;
  let qwenRes: Response;
  try {
    const { token: usedToken, result } = await withTokenFailover(async (candidate) => {
      const model = await resolveModel(candidate, backendModel);
      if (!model) throw new QwenError(`Model '${modelId}' is not available.`, 404);
      const files = await uploadImages(candidate, imageUrlsIn(messages[messages.length - 1]));

      let cid: string | undefined;
      try {
        cid = await createChat(candidate, backendModel, "t2t");
        // Think (default) vs Fast: callers can pass `enable_thinking: false` to skip
        // reasoning on models that support it. Models in REQUIRE_THINKING stay on.
        const thinking = REQUIRE_THINKING.has(backendModel)
          ? true
          : model.thinking && body.enable_thinking !== false;
        const qwenMessages = [buildMessage(effMessages, { model: backendModel, chatType: "t2t", files, thinking })];
        // Always stream from Qwen (it returns SSE); we buffer it for non-streaming clients.
        const res = await openCompletion(candidate, cid, { model: backendModel, messages: qwenMessages, stream: true });
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

  // Tool calls can only be recognized once the full reply is in hand, so when tools
  // are active we buffer, parse, and emit tool_calls (streamed or not).
  if (toolsOn) {
    let raw = "";
    let reasoning = "";
    try {
      for await (const { phase, text } of qwenDeltas(qwenRes)) {
        if (phase === "think") reasoning += text;
        else raw += text;
      }
    } catch (e: any) {
      await cleanup();
      const status = e instanceof QwenError ? e.status : 502;
      logUsage(record.id, modelId, hadImage, wantStream, status);
      return err(e.message, status, "upstream_error");
    }
    await cleanup();
    logUsage(record.id, modelId, hadImage, wantStream, 200);

    const { content: toolContent, toolCalls } = parseToolCalls(raw);
    const finish = toolCalls.length ? "tool_calls" : "stop";
    const message: Record<string, unknown> = {
      role: "assistant",
      content: toolCalls.length ? toolContent : raw,
    };
    if (toolCalls.length) message.tool_calls = toolCalls;
    if (withReasoning && reasoning) message.reasoning_content = reasoning;

    const streamDelta = (tcs: OAIToolCall[]) =>
      tcs.map((tc, i) => ({ index: i, id: tc.id, type: "function", function: tc.function }));

    if (wantStream) {
      const encoder = new TextEncoder();
      const stream = new ReadableStream({
        start(controller) {
          const send = (obj: unknown) => controller.enqueue(encoder.encode(`data: ${JSON.stringify(obj)}\n\n`));
          send({ id, object: "chat.completion.chunk", created, model: modelId, choices: [{ index: 0, delta: { role: "assistant" }, finish_reason: null }] });
          if (toolCalls.length) {
            send({ id, object: "chat.completion.chunk", created, model: modelId, choices: [{ index: 0, delta: { tool_calls: streamDelta(toolCalls) }, finish_reason: null }] });
          } else if (raw) {
            send({ id, object: "chat.completion.chunk", created, model: modelId, choices: [{ index: 0, delta: { content: raw }, finish_reason: null }] });
          }
          send({ id, object: "chat.completion.chunk", created, model: modelId, choices: [{ index: 0, delta: {}, finish_reason: finish }] });
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
      model: modelId,
      choices: [{ index: 0, message, finish_reason: finish }],
      usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
    });
  }

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
  watermark: string | null;
  origin: string;
  recordId: string;
}) {
  const { vm, messages, wantStream, size, watermark, origin, recordId } = args;
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
      const shown = watermark ? buildMediaUrl(origin, url, watermark) : url;
      markdown = `![${(prompt || "edited image").slice(0, 80)}](${shown})`;
    } else {
      // Video: start the task (with optional aspect ratio + reference images), then
      // poll (bounded by this function's duration).
      const { token, result } = await withTokenFailover((t) => startVideo(t, prompt, { size, images }));
      const url = await pollTask(token, result.taskId, 280_000);
      void Promise.all([deleteChat(token, result.chatId), forgetAllMemories(token)]);
      // Video is returned unwatermarked; Markdown.tsx proxies the raw CDN URL.
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

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
  type StreamStatus,
  resolveModel,
  showReasoning,
  uploadImages,
  QwenError,
  type OpenAIMessage,
} from "@/lib/qwen";
import { withTokenFailover } from "@/lib/tokens";
import { virtualModel, generateImage, startVideo, type VirtualModel } from "@/lib/media";
import { resolveWatermark, buildMediaUrl } from "@/lib/watermark";
import { hasTools, preprocessToolMessages, buildRegistry, ToolStream, extractToolCalls, applyToolPolicy, type OAIToolCall } from "@/lib/tools";
import { customModel, systemPromptFor } from "@/lib/customModels";
import {
  isOneCompilerModel,
  resolveOneCompilerModel,
  openCompletion as openOneCompilerCompletion,
  oneCompilerDeltas,
  OneCompilerError,
} from "@/lib/onecompiler";
import { withOneCompilerFailover } from "@/lib/onecompilerTokens";
import { logUsage } from "@/lib/supabase";
import { authenticate } from "@/lib/apiAuth";
import { publicOrigin } from "@/lib/canonicalHost";
import { randomUUID } from "node:crypto";

export const runtime = "nodejs";
export const maxDuration = 300;

const DEFAULT_MODEL = "qwen3.8-max-preview";

// These models require feature_config.thinking_enabled = true — they can't run in
// "Fast" (non-thinking) mode, so `enable_thinking: false` is ignored for them.
const REQUIRE_THINKING = new Set(["qwen3.8-max-preview"]);

/**
 * finish_reason for a Qwen stream, logging the ones that were severed.
 *
 * The elapsed time is the diagnostic: truncations clustering just under
 * maxDuration mean the function ceiling is the binding constraint (raise it, or
 * shorten the reasoning), while a spread of shorter times means the upstream is
 * dropping us and no amount of extra duration would help.
 */
function finishFor(st: StreamStatus, createdSec: number, modelId: string): "stop" | "length" {
  if (st.complete) return "stop";
  const secs = Math.max(0, Math.round(Date.now() / 1000 - createdSec));
  console.warn(`[truncated] model=${modelId} after ~${secs}s of ${maxDuration}s`);
  return "length";
}

/**
 * SSE keepalive.
 *
 * Proxies hang up on a connection that goes quiet — Railway closes after five
 * minutes with no data, and CDNs are often stricter. A reply can legitimately
 * produce nothing for a long stretch: a reasoning phase while
 * QWEN_SHOW_REASONING is off forwards no tokens at all, and a <tool_call> block
 * is deliberately withheld from the text stream while it accumulates. Both look
 * identical to an idle socket from outside.
 *
 * A comment line is the SSE no-op — every client ignores lines starting with
 * ":" — so it keeps the connection alive without appearing in the response.
 */
function keepAlive(controller: ReadableStreamDefaultController, encoder: TextEncoder) {
  let last = Date.now();
  let stopped = false;
  const id = setInterval(() => {
    if (stopped || Date.now() - last < 15_000) return;
    try {
      controller.enqueue(encoder.encode(": keepalive\n\n"));
      last = Date.now();
    } catch {
      stopped = true;
      clearInterval(id);
    }
  }, 5_000);
  return {
    touch() { last = Date.now(); },
    stop() { stopped = true; clearInterval(id); },
  };
}

function err(message: string, status: number, type = "invalid_request_error") {
  return NextResponse.json({ error: { message, type } }, { status });
}

// Tool calls in an OpenAI streaming chunk. Shared by every provider path so a
// client sees the same shape regardless of which backend answered.
const streamDelta = (tcs: OAIToolCall[]) =>
  tcs.map((tc, i) => ({ index: i, id: tc.id, type: "function", function: tc.function }));

export async function POST(req: NextRequest) {
  // Either a key, or the session cookie when the request comes from our own UI.
  const record = await authenticate(req);
  if (!record) return err("Missing or invalid API key. Send 'Authorization: Bearer <key>'.", 401);

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

  // OneCompiler's free-tier models, served from their own account pool rather
  // than the Qwen one. Exact registry match, so an unknown id falls through to
  // the Qwen path below.
  if (isOneCompilerModel(modelId)) {
    return handleOneCompiler({ messages, modelId, wantStream, hadImage, recordId: record.id, body });
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
      origin: publicOrigin(req),
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

  // Tools + streaming: stream text token-by-token while pulling out tool calls as
  // they complete. ToolStream is the same machine the buffered path uses, so both
  // agree on what counts as a call; only the tool JSON is withheld from the text.
  if (toolsOn && wantStream) {
    const encoder = new TextEncoder();
    const registry = buildRegistry(body.tools);

    const stream = new ReadableStream({
      async start(controller) {
        const hb = keepAlive(controller, encoder);
        const send = (delta: any, finish: string | null = null) => {
          hb.touch();
          controller.enqueue(encoder.encode(`data: ${JSON.stringify({ id, object: "chat.completion.chunk", created, model: modelId, choices: [{ index: 0, delta, finish_reason: finish }] })}\n\n`));
        };
        send({ role: "assistant" });

        const parser = new ToolStream(registry);
        let toolCalls: OAIToolCall[] = [];
        const st: StreamStatus = { complete: false };

        try {
          for await (const { phase, text } of qwenDeltas(qwenRes, st)) {
            if (phase === "think") { if (withReasoning && text) send({ reasoning_content: text }); continue; }
            const out = parser.push(text);
            if (out) send({ content: out });
          }
          const fin = parser.end();
          if (fin.text) send({ content: fin.text });
          // Enforce what the request asked for — a named tool_choice,
          // parallel_tool_calls:false, strict schemas — before the client sees it.
          toolCalls = applyToolPolicy(fin.toolCalls, body, registry);
        } catch (e: any) {
          // Salvage whatever the parser already resolved before the stream broke.
          try { toolCalls = applyToolPolicy(parser.end().toolCalls, body, registry); } catch { /* nothing to salvage */ }
          send({ content: `\n[error: ${e.message}]` });
        }
        await cleanup();
        logUsage(record.id, modelId, hadImage, true, 200);
        hb.stop();
        if (toolCalls.length) send({ tool_calls: streamDelta(toolCalls) });
        // "length" is how OpenAI reports a reply that ran out of room, so every
        // client already knows to treat it as resumable rather than finished.
        send({}, toolCalls.length ? "tool_calls" : finishFor(st, created, modelId));
        controller.enqueue(encoder.encode("data: [DONE]\n\n"));
        controller.close();
      },
    });
    return new Response(stream, { headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", Connection: "keep-alive" } });
  }

  // Tools without streaming: buffer the whole reply, parse, return JSON.
  if (toolsOn) {
    let raw = "";
    let reasoning = "";
    const st: StreamStatus = { complete: false };
    try {
      for await (const { phase, text } of qwenDeltas(qwenRes, st)) {
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

    const { content: toolContent, toolCalls: parsed } = extractToolCalls(raw, body.tools);
    const toolCalls = applyToolPolicy(parsed, body, buildRegistry(body.tools));
    const message: Record<string, unknown> = { role: "assistant", content: toolCalls.length ? toolContent : raw };
    if (toolCalls.length) message.tool_calls = toolCalls;
    if (withReasoning && reasoning) message.reasoning_content = reasoning;

    return NextResponse.json({
      id,
      object: "chat.completion",
      created,
      model: modelId,
      choices: [{ index: 0, message, finish_reason: toolCalls.length ? "tool_calls" : finishFor(st, created, modelId) }],
      usage: st.usage ?? { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
    });
  }

  if (wantStream) {
    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      async start(controller) {
        const hb = keepAlive(controller, encoder);
        const send = (obj: unknown) => { hb.touch(); controller.enqueue(encoder.encode(`data: ${JSON.stringify(obj)}\n\n`)); };
        send({ id, object: "chat.completion.chunk", created, model: modelId, choices: [{ index: 0, delta: { role: "assistant" }, finish_reason: null }] });
        const st: StreamStatus = { complete: false };
        try {
          for await (const { phase, text } of qwenDeltas(qwenRes, st)) {
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
        // "length" is OpenAI's signal for a reply that ran out of room, so clients
        // already treat it as resumable rather than finished.
        hb.stop();
        send({ id, object: "chat.completion.chunk", created, model: modelId, choices: [{ index: 0, delta: {}, finish_reason: finishFor(st, created, modelId) }] });
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
  const st: StreamStatus = { complete: false };
  try {
    for await (const { phase, text } of qwenDeltas(qwenRes, st)) {
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
    choices: [{ index: 0, message, finish_reason: finishFor(st, created, modelId) }],
    usage: st.usage ?? { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
  });
}

// --- OneCompiler (onecompiler.com/chat) -------------------------------------
// The simplest of the paths: the upstream keeps no server-side state and accepts
// real roles, so there is no session to create, no history to collapse and
// nothing to clean up. The response body is raw text rather than SSE, and these
// models expose no reasoning channel, so every delta is answer content.
async function handleOneCompiler(args: {
  messages: OpenAIMessage[];
  modelId: string;
  wantStream: boolean;
  hadImage: boolean;
  recordId: string;
  body: any;
}) {
  const { messages, modelId, wantStream, hadImage, recordId, body } = args;

  const model = resolveOneCompilerModel(modelId);
  if (!model) {
    logUsage(recordId, modelId, hadImage, wantStream, 404);
    return err(`Model '${modelId}' is not available.`, 404, "model_not_found");
  }

  // The endpoint takes text only — there is no attachment field to put an image
  // in, so say so rather than dropping it silently from the turn.
  if (hadImage) {
    logUsage(recordId, modelId, hadImage, wantStream, 400);
    return err(`Model '${modelId}' does not accept image input.`, 400);
  }

  // Tool calling is emulated exactly as on the Qwen path: the schemas are injected
  // into the prompt and the model's <tool_call> blocks are parsed back into
  // OpenAI tool_calls. Nothing about it is Qwen-specific — it is prompt plus
  // parser — so the same machinery works here, and using the same one means both
  // providers agree on what counts as a call.
  const toolsOn = hasTools(body);
  const effMessages: OpenAIMessage[] = toolsOn
    ? (preprocessToolMessages(messages, body.tools, body.tool_choice) as OpenAIMessage[])
    : messages;

  // Run through the pool: a capped account must not fail the request while other
  // accounts still have allowance left. Failover happens at stream OPEN, before
  // any bytes reach the client — once we are streaming it is too late to switch.
  let ocRes: Response;
  try {
    ({ result: ocRes } = await withOneCompilerFailover((token) =>
      openOneCompilerCompletion({ model: modelId, messages: effMessages, token })
    ));
  } catch (e: any) {
    const status = e instanceof OneCompilerError ? e.status : 502;
    logUsage(recordId, modelId, hadImage, wantStream, status);
    return err(e.message || "Upstream error", status, "upstream_error");
  }

  const id = "chatcmpl-" + randomUUID();
  const created = Math.floor(Date.now() / 1000);

  if (wantStream) {
    const encoder = new TextEncoder();
    let hb: ReturnType<typeof keepAlive> | null = null;
    const registry = toolsOn ? buildRegistry(body.tools) : null;
    const stream = new ReadableStream({
      async start(controller) {
        hb = keepAlive(controller, encoder);
        const send = (delta: any, finish: string | null = null) => {
          hb!.touch();
          controller.enqueue(
            encoder.encode(
              `data: ${JSON.stringify({ id, object: "chat.completion.chunk", created, model: modelId, choices: [{ index: 0, delta, finish_reason: finish }] })}\n\n`
            )
          );
        };
        try {
          send({ role: "assistant" });

          // The parser withholds a <tool_call> block from the text stream while it
          // accumulates, so a half-written call never reaches the client as prose.
          const parser = registry ? new ToolStream(registry) : null;
          let toolCalls: OAIToolCall[] = [];

          try {
            for await (const { text } of oneCompilerDeltas(ocRes)) {
              if (parser) {
                const out = parser.push(text);
                if (out) send({ content: out });
              } else {
                send({ content: text });
              }
            }
            if (parser) {
              const fin = parser.end();
              if (fin.text) send({ content: fin.text });
              toolCalls = applyToolPolicy(fin.toolCalls, body, registry!);
            }
          } catch (e: any) {
            // Salvage whatever the parser already resolved before the stream broke.
            if (parser) {
              try { toolCalls = applyToolPolicy(parser.end().toolCalls, body, registry!); } catch { /* nothing to salvage */ }
            }
            send({ content: `\n[error: ${e.message}]` });
          }

          hb.stop();
          if (toolCalls.length) send({ tool_calls: streamDelta(toolCalls) });
          send({}, toolCalls.length ? "tool_calls" : "stop");
          controller.enqueue(encoder.encode("data: [DONE]\n\n"));
          controller.close();
          logUsage(recordId, modelId, hadImage, true, 200);
        } catch {
          // Consumer went away mid-stream; nobody left to tell.
          logUsage(recordId, modelId, hadImage, true, 499);
        } finally {
          hb.stop();
          await ocRes.body?.cancel().catch(() => {});
        }
      },
      async cancel() {
        hb?.stop();
        await ocRes.body?.cancel().catch(() => {});
      },
    });
    return new Response(stream, { headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", Connection: "keep-alive" } });
  }

  let content = "";
  try {
    for await (const { text } of oneCompilerDeltas(ocRes)) content += text;
  } catch (e: any) {
    const status = e instanceof OneCompilerError ? e.status : 502;
    logUsage(recordId, modelId, hadImage, false, status);
    return err(e.message, status, "upstream_error");
  }
  logUsage(recordId, modelId, hadImage, false, 200);

  // Buffered path: same parser, so both agree on what counts as a call.
  const { content: toolContent, toolCalls: parsed } = toolsOn
    ? extractToolCalls(content, body.tools)
    : { content: null, toolCalls: [] as OAIToolCall[] };
  const toolCalls = toolsOn ? applyToolPolicy(parsed, body, buildRegistry(body.tools)) : [];

  const message: Record<string, unknown> = {
    role: "assistant",
    content: toolCalls.length ? toolContent : content,
  };
  if (toolCalls.length) message.tool_calls = toolCalls;

  return NextResponse.json({
    id,
    object: "chat.completion",
    created,
    model: modelId,
    choices: [{ index: 0, message, finish_reason: toolCalls.length ? "tool_calls" : "stop" }],
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
      // Video: start the task (with optional aspect ratio + reference images,
      // which switch it to image-to-video), then poll.
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
        // No keepalive here: this branch has the whole reply already and closes
        // in the same tick, so the connection is never idle.
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

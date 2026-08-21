import { NextRequest, NextResponse } from "next/server";
import { apiError } from "@/lib/apiErrors";
import { modelEnabled, capabilityEnabled, getSetting } from "@/lib/settings";
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
import { withTokenFailover, tokenById } from "@/lib/tokens";
import { findSession, saveSession, forgetSession } from "@/lib/qwenSessions";
import { virtualModel, generateImage, startVideo, toRatio, type VirtualModel } from "@/lib/media";
import { resolveWatermark, buildMediaUrl } from "@/lib/watermark";
import { hasTools, preprocessToolMessages, buildRegistry, ToolStream, extractToolCalls, applyToolPolicy, type OAIToolCall } from "@/lib/tools";
import { compactToolIntentPrompt, hasToolResults, parseToolIntent, routerMessages, validateNativeToolCalls } from "@/lib/toolRouting";
import { customModel, systemPromptFor } from "@/lib/customModels";
import {
  isOneCompilerModel,
  resolveOneCompilerModel,
  openCompletion as openOneCompilerCompletion,
  oneCompilerDeltas,
  OneCompilerError,
} from "@/lib/onecompiler";
import { withOneCompilerFailover } from "@/lib/onecompilerTokens";
import {
  isTokenRouterModel,
  resolveTokenRouterModel,
  openCompletion as openTokenRouterCompletion,
  tokenRouterDeltas,
  tokenRouterText,
  TokenRouterError,
} from "@/lib/tokenrouter";
import {
  isOpenCodeZenModel,
  resolveOpenCodeZenModel,
  openCompletion as openOpenCodeZenCompletion,
  openCodeZenDeltas,
  OpenCodeZenError,
} from "@/lib/opencodezen";
import {
  isChatGLMModel,
  resolveChatGLMModel,
  chatglmImageModel,
  openCompletion as openChatGLMCompletion,
  chatglmRun,
  emptyChatGLMSummary,
  toChatGLMMessages,
  resolveChatMode,
  uploadImage as chatglmUploadImage,
  generateImage as chatglmGenerateImage,
  ChatGLMError,
} from "@/lib/chatglm";
import {
  isNvidiaModel,
  resolveNvidiaModel,
  openCompletion as openNvidiaCompletion,
  nvidiaDeltas,
  NvidiaError,
} from "@/lib/nvidia";
import {
  isSolarModel,
  resolveSolarModel,
  openCompletion as openSolarCompletion,
  solarDeltas,
  emptySummary,
  SolarError,
} from "@/lib/solar";
import { pickReasoningEffort, defaultEffort } from "@/lib/reasoningEffort";
import { logUsage as persistUsage } from "@/lib/supabase";
import { authenticate, modelAllowed } from "@/lib/apiAuth";
import { CustomProviderError, customModel as customProviderModel, proxyCustomChat } from "@/lib/customProviders";
import { publicOrigin } from "@/lib/canonicalHost";
import { randomUUID } from "node:crypto";
import { injectSystemPrompts, type ScopedPrompt } from "@/lib/systemPromptInjection";

export const runtime = "nodejs";
export const maxDuration = 300;

const DEFAULT_MODEL = "qwen3.8-max";

/**
 * Prompt ceiling, in characters of assembled message text.
 *
 * ~100k characters is where measured behaviour stops being "slow" and starts
 * being "fails unpredictably": 80k took 82s and succeeded, 200k either burned
 * the full 300s or returned a bare 502. Set below that so the refusal is
 * deterministic rather than a coin flip.
 */
// Upstream latency scales at roughly a second per 1k characters against a 300s
// ceiling, so this is a time budget expressed in characters, not a context
// limit: the flagship window is a million tokens.
//
// It sat at 110k, which turned out to refuse a coding harness on its first
// message. Claude Code sends its system prompt, every tool schema and any
// CLAUDE.md before the user has typed anything, so "hello" arrived already over
// the line and the session was unusable rather than slow. 180k keeps roughly a
// hundred seconds of headroom under the ceiling while letting that baseline
// through, which is the right trade: a slow answer beats a refused one.
const PROMPT_CHAR_LIMIT = 180_000;

// These models require feature_config.thinking_enabled = true — they can't run in
// "Fast" (non-thinking) mode, so `enable_thinking: false` is ignored for them.
//
// The released qwen3.8-max is deliberately NOT here: unlike the preview it
// offers both Fast and Think, so honouring enable_thinking is what the caller
// asked for. Listing it would silently force reasoning on every request.
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

function usageProvider(model:string) {
  if (isOneCompilerModel(model)) return "onecompiler";
  if (isTokenRouterModel(model)) return "tokenrouter";
  if (isOpenCodeZenModel(model)) return "opencodezen";
  if (isChatGLMModel(model)) return "chatglm";
  if (isNvidiaModel(model)) return "nvidia";
  if (isSolarModel(model)) return "solar";
  return "qwen";
}
function logUsage(apiKeyId:string, model:string, hadImage:boolean, streamed:boolean, status:number, details:Parameters<typeof persistUsage>[5]={}) {
  return persistUsage(apiKeyId, model, hadImage, streamed, status, { provider: usageProvider(model), ...details });
}

function err(message: string, status: number, type = "invalid_request_error", req?: Request) {
  const code = type === "model_not_found" ? "model_not_found" : type === "service_unavailable" ? "service_unavailable" : type === "upstream_error" ? "provider_unavailable" : status === 401 ? "invalid_api_key" : status === 403 ? "model_not_allowed" : "invalid_request";
  return apiError(req, message, status, code, type);
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
  let messages: OpenAIMessage[] = Array.isArray(body.messages) ? body.messages : [];
  if (messages.length === 0) return err("'messages' must be a non-empty array.", 400);

  // Tool / function calling is emulated at the proxy: the schemas are injected into
  // the prompt (Qwen-native <tool_call> convention) and parsed back into OpenAI
  // tool_calls. See lib/tools.ts.
  const toolsOn = hasTools(body);
  const wantStream = body.stream === true;
  const promptInjection = await getSetting("prompt_injection");
  try {
    if (promptInjection.enabled) messages = injectSystemPrompts(messages, [{ scope: "global", content: promptInjection.global_prompt }], promptInjection) as OpenAIMessage[];
    else if (!promptInjection.allow_client_system_prompts) messages = injectSystemPrompts(messages, [], promptInjection) as OpenAIMessage[];
  } catch (error: any) { return err(error.message || "Invalid system prompt configuration.", 400, "invalid_prompt_configuration", req); }
  body = { ...body, messages };
  const requestedModelId = typeof body.model === "string" && body.model ? body.model : DEFAULT_MODEL;
  const toolFollowUp = toolsOn && hasToolResults(messages);
  const toolRouting = toolsOn && !toolFollowUp ? await getSetting("tool_routing") : { enabled: false, model: "" };
  const modelId = requestedModelId;
  const capability = await capabilityEnabled("chat");
  if (!capability.enabled) return err(capability.message, 503, "service_unavailable");
  if (!(await modelEnabled(requestedModelId))) return err("The requested model is disabled.", 404, "model_not_found");
  if (!modelAllowed(record, requestedModelId)) return err("This API key is not permitted to use the requested model.", 403);


  const hadImage = imageUrlsIn(messages[messages.length - 1]).length > 0;

  const configuredProviderModel = await customProviderModel(modelId);
  if (configuredProviderModel) {
    const scopedPrompts: ScopedPrompt[] = [];
    if (configuredProviderModel.provider_system_prompt_enabled) scopedPrompts.push({ scope: "provider", content: configuredProviderModel.provider_system_prompt || "" });
    if (configuredProviderModel.model_system_prompt_enabled) scopedPrompts.push({ scope: "model", content: configuredProviderModel.model_system_prompt || "" });
    try { messages = injectSystemPrompts(messages, scopedPrompts, { ...promptInjection, enabled: true, allow_client_system_prompts: true }) as OpenAIMessage[]; body = { ...body, messages }; }
    catch (error: any) { return err(error.message || "Invalid provider system prompt.", 400, "invalid_prompt_configuration", req); }
    if (hadImage) return err("This custom provider model supports text input only.", 400);
    const started = Date.now();
    const requestId = req.headers.get("x-request-id") || undefined;
    try {
      const { response, attempts } = await proxyCustomChat(configuredProviderModel, body, req.signal);
      const headers = new Headers({ "content-type": response.headers.get("content-type") || (wantStream ? "text/event-stream" : "application/json") });
      if (requestId) headers.set("X-Request-ID", requestId);
      if (!wantStream) {
        await logUsage(record.id, modelId, false, false, response.status, { provider: configuredProviderModel.provider_slug, providerAttempts: attempts, latencyMs: Date.now() - started, requestId });
        return new Response(response.body, { status: response.status, headers });
      }
      if (!response.body) throw new CustomProviderError("Provider returned an empty stream.", 502, "invalid_response", attempts);
      const reader = response.body.getReader();
      let finalized = false;
      const finalize = async (status:number, category?:string) => { if (finalized) return; finalized = true; await logUsage(record.id, modelId, false, true, status, { provider: configuredProviderModel.provider_slug, providerAttempts: attempts, latencyMs: Date.now() - started, requestId, failureCategory: category }); };
      const stream = new ReadableStream({
        async pull(controller) { try { const chunk = await reader.read(); if (chunk.done) { await finalize(200); controller.close(); } else controller.enqueue(chunk.value); } catch { await finalize(502, "stream_error"); controller.error(new Error("Provider stream failed.")); } },
        async cancel(reason) { await finalize(499, "client_cancelled"); await reader.cancel(reason).catch(() => undefined); },
      });
      return new Response(stream, { status: response.status, headers });
    } catch (error) {
      const providerError = error instanceof CustomProviderError ? error : new CustomProviderError("Custom provider is unavailable.", 503, "provider_error");
      await logUsage(record.id, modelId, false, wantStream, providerError.status, { provider: configuredProviderModel.provider_slug, providerAttempts: providerError.attempts, latencyMs: Date.now() - started, requestId, failureCategory: providerError.category });
      return err(providerError.status >= 500 ? "Custom provider is unavailable." : providerError.message, providerError.status, "upstream_error", req);
    }
  }

  // OneCompiler's free-tier models, served from their own account pool rather
  // than the Qwen one. Exact registry match, so an unknown id falls through to
  // the Qwen path below.
  if (isOneCompilerModel(modelId)) {
    return handleOneCompiler({ messages, modelId, wantStream, hadImage, recordId: record.id, body });
  }

  // TokenRouter's free Kimi K3. Gated on configuration inside isTokenRouterModel,
  // so with no key set the id is simply unknown and falls through as before.
  if (isTokenRouterModel(modelId)) {
    return handleTokenRouter({ messages, modelId, wantStream, hadImage, recordId: record.id, body });
  }

  // OpenCode Zen free tier (Big Pickle and friends). Same gate: no key means the
  // id is unknown and falls through rather than advertising a dead model.
  if (isOpenCodeZenModel(modelId)) {
    return handleOpenCodeZen({ messages, modelId, wantStream, hadImage, recordId: record.id, body });
  }

  // chatglm.cn — GLM-5.2 with its Fast/Standard/Deep modes and vision, plus the
  // two image models. Checked before NVIDIA because it now owns z-ai/glm-5.2.
  if (isChatGLMModel(modelId)) {
    return handleChatGLM({
      messages,
      modelId,
      wantStream,
      hadImage,
      recordId: record.id,
      body,
      watermark: resolveWatermark(body.watermark),
      origin: publicOrigin(req),
    });
  }

  // NVIDIA NIM (Muse Glimmer). Gated on NVIDIA_API_KEY inside
  // isNvidiaModel, so an unconfigured deploy never routes here.
  if (isNvidiaModel(modelId)) {
    return handleNvidia({ messages, modelId, wantStream, hadImage, recordId: record.id, body });
  }

  // Upstage's Solar Chat (Solar Pro 4). A public site with no key to hold, so
  // the gate is availability rather than configuration.
  if (isSolarModel(modelId)) {
    return handleSolar({ messages, modelId, wantStream, hadImage, recordId: record.id, body });
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

  // Existing tool results are flattened for Qwen synthesis. For a new tool-bearing
  // turn, Qwen sees only compact names/descriptions and decides whether routing is
  // necessary; schemas remain private until the native router is actually called.
  let effMessages: any[] = toolFollowUp
    ? preprocessToolMessages(messages, body.tools, "none")
    : toolsOn
      ? [{ role: "system", content: compactToolIntentPrompt(body.tools, body.tool_choice) }, ...messages]
      : messages;
  // The persona goes first so the caller's own system prompt layers on top of it.
  if (cm) {
    const persona = systemPromptFor(cm);
    if (persona) effMessages = [{ role: "system", content: persona }, ...effMessages];
  }

  // Upstream latency scales with prompt size — measured at roughly a second per
  // 1k characters against a 300s ceiling — and past ~100k characters the request
  // does not fail cleanly: it either burns the full 300s or comes back as an
  // opaque 502. Neither tells the caller anything, and an agent mid-loop just
  // sees its turn die. Refuse early with a status that names the problem.
  const promptChars = effMessages.reduce((n: number, m: any) => n + messageText(m).length, 0);
  if (promptChars > PROMPT_CHAR_LIMIT) {
    // Logged because the caller usually never sees our message. Claude Code
    // replaces a 413 with its own "max 32MB" wording, which names a limit that
    // is not ours and a cause that may not be true, so the only place the real
    // size is recorded is here.
    console.warn(
      `[413] ${modelId}: ${promptChars} chars over ${PROMPT_CHAR_LIMIT}` +
        `, ${effMessages.length} messages, tools=${toolsOn ? body.tools?.length ?? 0 : "off"}`
    );
    logUsage(record.id, modelId, hadImage, wantStream, 413);
    return err(
      `Request too large: ~${Math.round(promptChars / 1000)}k characters of prompt, limit is ~${Math.round(PROMPT_CHAR_LIMIT / 1000)}k. ` +
        `Tool results dominate long agent sessions — start a new session, or have the client send fewer/smaller tool outputs.`,
      413,
      "context_length_exceeded"
    );
  }

  // Run the whole setup under token failover: if an account is out of quota,
  // rate-limited or expired, transparently retry on a different pooled account.
  let token: string;
  let chatId: string | undefined;
  let entryId: string | null = null;
  let qwenRes!: Awaited<ReturnType<typeof openCompletion>>;

  // Is this a continuation of a thread Qwen already holds? If so the request
  // carries only the new turn, and Qwen supplies the history from its own copy —
  // which is what stops a large system prompt being re-sent on every turn.
  const prior = toolsOn ? null : findSession(effMessages, backendModel);
  let resumed = false;
  if (prior) {
    // A thread lives on one account, so the continuation must go to that account
    // or not at all — hence no failover here.
    const pinned = await tokenById(prior.entryId);
    if (pinned) {
      try {
        const model = await resolveModel(pinned, backendModel);
        if (!model) throw new QwenError("model gone", 404);
        const last = effMessages[effMessages.length - 1];
        const files = await uploadImages(pinned, imageUrlsIn(last));
        const thinking = REQUIRE_THINKING.has(backendModel)
          ? true
          : model.thinking && body.enable_thinking !== false;
        const msg: any = buildMessage([last], { model: backendModel, chatType: "t2t", files, thinking });
        msg.parentId = prior.responseId;
        qwenRes = await openCompletion(pinned, prior.chatId, {
          model: backendModel, messages: [msg], stream: true, parentId: prior.responseId,
        });
        token = pinned;
        chatId = prior.chatId;
        entryId = prior.entryId;
        resumed = true;
      } catch {
        // The thread is gone, the account is gone, or Qwen refused the parent.
        // Nothing is lost: fall through and send the transcript in full.
        forgetSession(prior);
      }
    }
    if (!resumed) forgetSession(prior);
  }

  try {
    if (!resumed) {
    const { token: usedToken, entryId: usedEntry, result } = await withTokenFailover(async (candidate) => {
      const model = await resolveModel(candidate, backendModel);
      if (!model)
        throw new QwenError(
          // Usually a model that existed when the caller wrote their config and
          // has since been withdrawn upstream, so point at the live list rather
          // than only reporting the miss.
          `Model '${modelId}' is not available. GET /v1/models lists what this key can reach.`,
          404
        );
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
    entryId = usedEntry;
    chatId = result.chatId;
    qwenRes = result.res;
    }
  } catch (e: any) {
    const status = e instanceof QwenError ? e.status : 502;
    logUsage(record.id, modelId, hadImage, wantStream, status);
    return err(e.message || "Upstream error", status, status === 404 ? "model_not_found" : "upstream_error");
  }

  const id = "chatcmpl-" + randomUUID();
  const created = Math.floor(Date.now() / 1000);
  /**
   * The chat is left standing.
   *
   * Qwen's copy of the thread IS the history — we keep none of our own — so
   * deleting the chat destroys the only record and forces the next turn to
   * re-send the whole transcript, system prompt and all. Nothing here can know
   * whether a follow-up is coming, and guessing wrong is expensive in one
   * direction and free in the other: a kept chat that is never resumed costs a
   * row on the account, while a deleted one that is resumed costs the entire
   * conversation being sent again.
   *
   * Memories are still cleared. Those are Qwen's cross-conversation notes about
   * the "user", which would otherwise leak between unrelated API callers sharing
   * a pooled account — the thread is per chat, but memories are per account.
   */
  const cleanup = async () => {
    // A chat is only worth keeping if it can be resumed. Tool turns never are:
    // resume is skipped for them, so each request opens a fresh chat that is
    // never read again. Keeping those is cost with no benefit, and harness
    // traffic is almost entirely tool turns, so it is the bulk of them.
    if (toolsOn) await Promise.all([deleteChat(token, chatId), forgetAllMemories(token)]);
    else await forgetAllMemories(token);
  };
  /** Remember this thread so the next turn can carry just its new message. */
  const remember = (assistantText: string, st: StreamStatus) => {
    if (toolsOn || !st.responseId || !chatId || !entryId) return;
    saveSession(effMessages, assistantText, backendModel, {
      chatId, responseId: st.responseId, entryId,
    });
  };
  const withReasoning = showReasoning();

  // Qwen intent markers must never leak into a client stream, so the first decision is buffered.
  if (toolsOn && wantStream) {
    let raw = "";
    const st: StreamStatus = { complete: false };
    try {
      for await (const { phase, text } of qwenDeltas(qwenRes, st)) if (phase !== "think") raw += text;
    } catch (e: any) {
      await cleanup();
      logUsage(record.id, modelId, hadImage, true, e instanceof QwenError ? e.status : 502);
      return err(e.message || "Upstream error", e instanceof QwenError ? e.status : 502, "upstream_error");
    }
    await cleanup();
    const intent = !toolFollowUp ? parseToolIntent(raw) : { required: false, answer: raw };
    if (intent.required) return routeNativeToolCall({ req, body, messages, requestedModelId, routerModelId: toolRouting.model, recordId: record.id, wantStream: true });
    logUsage(record.id, modelId, hadImage, true, 200);
    const parsed = toolFollowUp ? extractToolCalls(raw, body.tools) : { content: intent.answer, toolCalls: [] };
    const calls = applyToolPolicy(parsed.toolCalls, body, buildRegistry(body.tools));
    const chunks = [
      { id, object: "chat.completion.chunk", created, model: modelId, choices: [{ index: 0, delta: { role: "assistant" }, finish_reason: null }] },
      { id, object: "chat.completion.chunk", created, model: modelId, choices: [{ index: 0, delta: calls.length ? { tool_calls: streamDelta(calls) } : { content: intent.answer }, finish_reason: null }] },
      { id, object: "chat.completion.chunk", created, model: modelId, choices: [{ index: 0, delta: {}, finish_reason: calls.length ? "tool_calls" : finishFor(st, created, modelId) }] },
    ];
    return new Response(chunks.map((chunk) => `data: ${JSON.stringify(chunk)}\n\n`).join("") + "data: [DONE]\n\n", { headers: { "content-type": "text/event-stream; charset=utf-8" } });
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

    const intent = !toolFollowUp ? parseToolIntent(raw) : { required: false, answer: raw };
    if (intent.required) {
      return routeNativeToolCall({ req, body, messages, requestedModelId, routerModelId: toolRouting.model, recordId: record.id, wantStream });
    }
    const { content: toolContent, toolCalls: parsed } = toolFollowUp ? extractToolCalls(raw, body.tools) : { content: intent.answer, toolCalls: [] };
    const toolCalls = applyToolPolicy(parsed, body, buildRegistry(body.tools));
    const message: Record<string, unknown> = { role: "assistant", content: toolCalls.length ? toolContent : intent.answer };
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
        // Accumulated only to key the resumable thread: the next request's
        // transcript ends with exactly this answer.
        let streamed = "";
        try {
          for await (const { phase, text } of qwenDeltas(qwenRes, st)) {
            if (phase !== "think") streamed += text;
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
        remember(streamed, st);
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
  remember(content, st);
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

/**
 * TokenRouter (Kimi K3, free tier).
 *
 * The upstream is OpenAI-compatible, so roles survive intact and there is no
 * conversation to flatten. Tool calling still goes through the same emulated
 * path as every other provider: uniform behaviour matters more here than using
 * whatever native support this gateway may or may not have, and it means a
 * client cannot tell which backend answered.
 *
 * There is no account pool to fail over to — one key, best-effort capacity — so
 * upstream failures are surfaced with their own status. A 429 in particular is
 * passed through rather than flattened to 502, because that is the expected
 * steady state on a free tier and a caller that can back off should be told.
 */
async function handleTokenRouter(args: {
  messages: OpenAIMessage[];
  modelId: string;
  wantStream: boolean;
  hadImage: boolean;
  recordId: string;
  body: any;
}) {
  const { messages, modelId, wantStream, hadImage, recordId, body } = args;

  const model = resolveTokenRouterModel(modelId);
  if (!model) {
    logUsage(recordId, modelId, hadImage, wantStream, 404);
    return err(`Model '${modelId}' is not available.`, 404, "model_not_found");
  }

  // Text only: there is no attachment path here, so say so rather than dropping
  // the image silently and answering about nothing.
  if (hadImage) {
    logUsage(recordId, modelId, hadImage, wantStream, 400);
    return err(`Model '${modelId}' does not accept image input.`, 400);
  }

  const toolsOn = hasTools(body);
  const effMessages: OpenAIMessage[] = toolsOn
    ? (preprocessToolMessages(messages, body.tools, body.tool_choice) as OpenAIMessage[])
    : messages;

  let effort: string | null = null;
  try {
    effort = pickReasoningEffort(body, model.reasoningEffort);
  } catch (msg: any) {
    logUsage(recordId, modelId, hadImage, wantStream, 400);
    return err(typeof msg === "string" ? msg : "Invalid reasoning_effort.", 400);
  }
  if (!effort && model.reasoningEffort?.length) effort = defaultEffort(model.reasoningEffort) ?? null;

  let trRes: Response;
  try {
    trRes = await openTokenRouterCompletion({
      model: modelId,
      messages: effMessages,
      stream: wantStream,
      temperature: typeof body.temperature === "number" ? body.temperature : undefined,
      max_tokens: typeof body.max_tokens === "number" ? body.max_tokens : undefined,
      reasoningEffort: effort || undefined,
    });
  } catch (e: any) {
    const status = e instanceof TokenRouterError ? e.status : 502;
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

          const parser = registry ? new ToolStream(registry) : null;
          let toolCalls: OAIToolCall[] = [];

          try {
            for await (const { text } of tokenRouterDeltas(trRes)) {
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
            // Salvage whatever the parser resolved before the stream broke.
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
          logUsage(recordId, modelId, hadImage, true, 499);
        } finally {
          hb.stop();
          await trRes.body?.cancel().catch(() => {});
        }
      },
      async cancel() {
        hb?.stop();
        await trRes.body?.cancel().catch(() => {});
      },
    });
    return new Response(stream, { headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", Connection: "keep-alive" } });
  }

  // Buffered: the upstream already answers in OpenAI shape, so the reply is read
  // straight out of it rather than being reassembled from deltas.
  let content = "";
  try {
    const json: any = await trRes.json();
    if (json?.error) throw new TokenRouterError(json.error.message || "Upstream error", 502);
    content = tokenRouterText(json);
  } catch (e: any) {
    const status = e instanceof TokenRouterError ? e.status : 502;
    logUsage(recordId, modelId, hadImage, false, status);
    return err(e.message || "Upstream error", status, "upstream_error");
  }
  logUsage(recordId, modelId, hadImage, false, 200);

  const { content: toolContent, toolCalls: parsed } = toolsOn
    ? extractToolCalls(content, body.tools)
    : { content, toolCalls: [] as OAIToolCall[] };
  const toolCalls = toolsOn ? applyToolPolicy(parsed, body, buildRegistry(body.tools)) : [];

  return NextResponse.json({
    id,
    object: "chat.completion",
    created,
    model: modelId,
    choices: [
      {
        index: 0,
        message: { role: "assistant", content: toolCalls.length ? null : toolContent, ...(toolCalls.length ? { tool_calls: toolCalls } : {}) },
        finish_reason: toolCalls.length ? "tool_calls" : "stop",
      },
    ],
    usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
  });
}

// --- OpenCode Zen (Big Pickle + free promo models) --------------------------
//
// OpenAI-compatible chat/completions gateway. Public ids are namespaced
// `opencode/<zen-id>`; the upstream call rewrites to the bare Zen id. Big
// Pickle streams reasoning_content before content — both are forwarded when
// QWEN_SHOW_REASONING is on so agent clients that surface thinking can use it.
async function handleOpenCodeZen(args: {
  messages: OpenAIMessage[];
  modelId: string;
  wantStream: boolean;
  hadImage: boolean;
  recordId: string;
  body: any;
}) {
  const { messages, modelId, wantStream, hadImage, recordId, body } = args;

  const model = resolveOpenCodeZenModel(modelId);
  if (!model) {
    logUsage(recordId, modelId, hadImage, wantStream, 404);
    return err(`Model '${modelId}' is not available.`, 404, "model_not_found");
  }

  // Free Zen chat models are text-only on this path.
  if (hadImage) {
    logUsage(recordId, modelId, hadImage, wantStream, 400);
    return err(`Model '${modelId}' does not accept image input.`, 400);
  }

  const toolsOn = hasTools(body);
  const effMessages: OpenAIMessage[] = toolsOn
    ? (preprocessToolMessages(messages, body.tools, body.tool_choice) as OpenAIMessage[])
    : messages;

  // Upstream always streams (fast headers + progressive tokens). reasoning_effort
  // defaults to "none" when supported so models answer quickly; pass an explicit
  // level (or enable_thinking:true) for deeper thought.
  let effort: string | null = null;
  try {
    effort = pickReasoningEffort(body, model.reasoningEffort);
  } catch (msg: any) {
    logUsage(recordId, modelId, hadImage, wantStream, 400);
    return err(typeof msg === "string" ? msg : "Invalid reasoning_effort.", 400);
  }

  let zenRes: Response;
  try {
    zenRes = await openOpenCodeZenCompletion({
      model: modelId,
      messages: effMessages,
      stream: wantStream,
      temperature: typeof body.temperature === "number" ? body.temperature : undefined,
      max_tokens: typeof body.max_tokens === "number" ? body.max_tokens : undefined,
      reasoningEffort: effort || undefined,
      enableThinking: typeof body.enable_thinking === "boolean" ? body.enable_thinking : undefined,
    });
  } catch (e: any) {
    const status = e instanceof OpenCodeZenError ? e.status : 502;
    logUsage(recordId, modelId, hadImage, wantStream, status);
    return err(e.message || "Upstream error", status, "upstream_error");
  }

  const id = "chatcmpl-" + randomUUID();
  const created = Math.floor(Date.now() / 1000);
  const withReasoning = showReasoning();

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

          const parser = registry ? new ToolStream(registry) : null;
          let toolCalls: OAIToolCall[] = [];

          try {
            for await (const d of openCodeZenDeltas(zenRes)) {
              if (d.kind === "reasoning") {
                if (withReasoning && d.text) send({ reasoning_content: d.text });
                continue;
              }
              if (parser) {
                const out = parser.push(d.text);
                if (out) send({ content: out });
              } else {
                send({ content: d.text });
              }
            }
            if (parser) {
              const fin = parser.end();
              if (fin.text) send({ content: fin.text });
              toolCalls = applyToolPolicy(fin.toolCalls, body, registry!);
            }
          } catch (e: any) {
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
          logUsage(recordId, modelId, hadImage, true, 499);
        } finally {
          hb.stop();
          await zenRes.body?.cancel().catch(() => {});
        }
      },
      async cancel() {
        hb?.stop();
        await zenRes.body?.cancel().catch(() => {});
      },
    });
    return new Response(stream, { headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", Connection: "keep-alive" } });
  }

  // Non-stream client: Zen already streams to us; reassemble into one JSON body.
  let content = "";
  let reasoning = "";
  try {
    for await (const d of openCodeZenDeltas(zenRes)) {
      if (d.kind === "reasoning") reasoning += d.text;
      else content += d.text;
    }
  } catch (e: any) {
    const status = e instanceof OpenCodeZenError ? e.status : 502;
    logUsage(recordId, modelId, hadImage, false, status);
    return err(e.message || "Upstream error", status, "upstream_error");
  } finally {
    await zenRes.body?.cancel().catch(() => {});
  }
  logUsage(recordId, modelId, hadImage, false, 200);

  const { content: toolContent, toolCalls: parsed } = toolsOn
    ? extractToolCalls(content, body.tools)
    : { content, toolCalls: [] as OAIToolCall[] };
  const toolCalls = toolsOn ? applyToolPolicy(parsed, body, buildRegistry(body.tools)) : [];

  const message: Record<string, unknown> = {
    role: "assistant",
    content: toolCalls.length ? toolContent : content,
  };
  if (toolCalls.length) message.tool_calls = toolCalls;
  if (withReasoning && reasoning) message.reasoning_content = reasoning;

  return NextResponse.json({
    id,
    object: "chat.completion",
    created,
    model: modelId,
    choices: [
      {
        index: 0,
        message,
        finish_reason: toolCalls.length ? "tool_calls" : "stop",
      },
    ],
    usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
  });
}

// --- Solar Chat (Upstage) ---------------------------------------------------
//
// A WebSocket upstream rather than an HTTP one, so this path holds a live
// socket for the length of the reply instead of a Response body. `run.cancel()`
// takes the place of cancelling that body, and must run on every exit — a
// client that hangs up mid-answer would otherwise leave the socket open until
// the idle timeout fires.
//
// Two things Solar gives us that the other providers do not: real token counts,
// which are reported instead of the usual zeros, and search citations, which
// lib/solar.ts appends as a source list so the answer's [n] markers resolve.
async function handleSolar(args: {
  messages: OpenAIMessage[];
  modelId: string;
  wantStream: boolean;
  hadImage: boolean;
  recordId: string;
  body: any;
}) {
  const { messages, modelId, wantStream, hadImage, recordId, body } = args;

  const model = resolveSolarModel(modelId);
  if (!model) {
    logUsage(recordId, modelId, hadImage, wantStream, 404);
    return err(`Model '${modelId}' is not available.`, 404, "model_not_found");
  }

  // Not a soft limitation: the upstream rejects a multimodal content array at
  // the protocol level, so there is nothing to degrade to.
  if (hadImage) {
    logUsage(recordId, modelId, hadImage, wantStream, 400);
    return err(`Model '${modelId}' does not accept image input.`, 400);
  }

  const toolsOn = hasTools(body);
  const effMessages: OpenAIMessage[] = toolsOn
    ? (preprocessToolMessages(messages, body.tools, body.tool_choice) as OpenAIMessage[])
    : messages;

  // Instant (none) unless asked otherwise: `reasoning_effort` for the full
  // ladder, `enable_thinking: true` for the composer's Think mode.
  let effort: string | null = null;
  try {
    effort = pickReasoningEffort(body, model.reasoningEffort);
  } catch (msg: any) {
    logUsage(recordId, modelId, hadImage, wantStream, 400);
    return err(typeof msg === "string" ? msg : "Invalid reasoning_effort.", 400);
  }

  let run: Awaited<ReturnType<typeof openSolarCompletion>>;
  try {
    run = await openSolarCompletion({
      model: modelId,
      messages: effMessages,
      reasoningEffort: effort || undefined,
      enableThinking: typeof body.enable_thinking === "boolean" ? body.enable_thinking : undefined,
    });
  } catch (e: any) {
    const status = e instanceof SolarError ? e.status : 502;
    logUsage(recordId, modelId, hadImage, wantStream, status);
    return err(e.message || "Upstream error", status, status === 400 ? "invalid_request_error" : "upstream_error");
  }

  const id = "chatcmpl-" + randomUUID();
  const created = Math.floor(Date.now() / 1000);
  const withReasoning = showReasoning();
  const summary = emptySummary();
  const zeroUsage = { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 };

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

          const parser = registry ? new ToolStream(registry) : null;
          let toolCalls: OAIToolCall[] = [];

          try {
            for await (const d of solarDeltas(run.frames, summary)) {
              if (d.kind === "reasoning") {
                if (withReasoning && d.text) send({ reasoning_content: d.text });
                continue;
              }
              if (parser) {
                const out = parser.push(d.text);
                if (out) send({ content: out });
              } else {
                send({ content: d.text });
              }
            }
            if (parser) {
              const fin = parser.end();
              if (fin.text) send({ content: fin.text });
              toolCalls = applyToolPolicy(fin.toolCalls, body, registry!);
            }
          } catch (e: any) {
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
          logUsage(recordId, modelId, hadImage, true, 499);
        } finally {
          hb.stop();
          run.cancel();
        }
      },
      cancel() {
        hb?.stop();
        run.cancel();
      },
    });
    return new Response(stream, { headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", Connection: "keep-alive" } });
  }

  // Non-stream client: Solar only streams, so reassemble into one JSON body.
  let content = "";
  let reasoning = "";
  try {
    for await (const d of solarDeltas(run.frames, summary)) {
      if (d.kind === "reasoning") reasoning += d.text;
      else content += d.text;
    }
  } catch (e: any) {
    const status = e instanceof SolarError ? e.status : 502;
    logUsage(recordId, modelId, hadImage, false, status);
    return err(e.message || "Upstream error", status, "upstream_error");
  } finally {
    run.cancel();
  }
  logUsage(recordId, modelId, hadImage, false, 200);

  const { content: toolContent, toolCalls: parsed } = toolsOn
    ? extractToolCalls(content, body.tools)
    : { content, toolCalls: [] as OAIToolCall[] };
  const toolCalls = toolsOn ? applyToolPolicy(parsed, body, buildRegistry(body.tools)) : [];

  const message: Record<string, unknown> = {
    role: "assistant",
    content: toolCalls.length ? toolContent : content,
  };
  if (toolCalls.length) message.tool_calls = toolCalls;
  if (withReasoning && reasoning) message.reasoning_content = reasoning;

  return NextResponse.json({
    id,
    object: "chat.completion",
    created,
    model: modelId,
    choices: [
      {
        index: 0,
        message,
        finish_reason: toolCalls.length ? "tool_calls" : "stop",
      },
    ],
    usage: summary.usage ?? zeroUsage,
  });
}

// --- chatglm.cn (GLM-5.2 + the GLM image models) ----------------------------
//
// Two shapes behind one entry point: the text model streams like any other
// provider, while the image models generate a picture and hand back markdown
// media — the same contract handleMedia uses for the Qwen image models, so a
// client that can render one renders the other.
//
// Vision is real here, unlike on the NIM-backed GLM: image parts are uploaded
// to chatglm.cn first and the returned handles ride along in the message. The
// upstream takes bytes, not links, so a remote URL is fetched and re-uploaded.
async function handleChatGLM(args: {
  messages: OpenAIMessage[];
  modelId: string;
  wantStream: boolean;
  hadImage: boolean;
  recordId: string;
  body: any;
  watermark: string | null;
  origin: string;
}) {
  const { messages, modelId, wantStream, hadImage, recordId, body, watermark, origin } = args;

  const model = resolveChatGLMModel(modelId);
  if (!model) {
    logUsage(recordId, modelId, hadImage, wantStream, 404);
    return err(`Model '${modelId}' is not available.`, 404, "model_not_found");
  }
  if (hadImage && !model.vision) {
    logUsage(recordId, modelId, hadImage, wantStream, 400);
    return err(`Model '${modelId}' does not accept image input.`, 400);
  }

  // Upload every referenced image once, keyed by the URL the message used, so
  // toChatGLMMessages can swap each part for its upstream handle.
  const uploads = new Map<string, { image_url: string; file_id?: string }>();
  if (model.vision) {
    const urls = new Set<string>();
    for (const m of messages) for (const u of imageUrlsIn(m)) urls.add(u);
    try {
      await Promise.all(
        [...urls].map(async (u) => uploads.set(u, await chatglmUploadImage(u)))
      );
    } catch (e: any) {
      const status = e instanceof ChatGLMError ? e.status : 502;
      logUsage(recordId, modelId, hadImage, wantStream, status);
      return err(e.message || "Image upload failed", status, "upstream_error");
    }
  }

  // --- image models: generate, then return markdown media ---
  if (chatglmImageModel(modelId)) {
    let glmMessages;
    try {
      glmMessages = toChatGLMMessages(messages, uploads);
    } catch (e: any) {
      logUsage(recordId, modelId, hadImage, wantStream, 400);
      return err(e.message || "Invalid request", 400);
    }
    const prompt = messageText(messages[messages.length - 1]).trim();

    let out;
    try {
      out = await chatglmGenerateImage({
        model: modelId,
        messages: glmMessages,
        aspectRatio: toRatio(typeof body.size === "string" ? body.size : undefined),
      });
    } catch (e: any) {
      const status = e instanceof ChatGLMError ? e.status : 502;
      logUsage(recordId, modelId, hadImage, wantStream, status);
      return err(e.message || "Image generation failed", status, "upstream_error");
    }
    logUsage(recordId, modelId, hadImage, wantStream, 200);

    // rm_label_watermark strips chatglm's own corner label upstream, so the
    // proxy's watermark is the only one on the result.
    const alt = (out.prompt || prompt || "image").slice(0, 80).replace(/[\[\]]/g, "");
    const markdown = out.images
      .map((u) => `![${alt}](${watermark ? buildMediaUrl(origin, u, watermark) : u})`)
      .join("\n\n");

    return mediaReply({ markdown, modelId, wantStream });
  }

  // --- text model ---
  let effort: string | null = null;
  try {
    effort = pickReasoningEffort(body, model.reasoningEffort);
  } catch (msg: any) {
    logUsage(recordId, modelId, hadImage, wantStream, 400);
    return err(typeof msg === "string" ? msg : "Invalid reasoning_effort.", 400);
  }

  const toolsOn = hasTools(body);
  const effMessages: OpenAIMessage[] = toolsOn
    ? (preprocessToolMessages(messages, body.tools, body.tool_choice) as OpenAIMessage[])
    : messages;

  // Opened eagerly so a refusal is a clean HTTP status rather than an error
  // mid-stream; chatglmRun reuses this response as its first attempt and only
  // opens another if this one comes back carrying nothing.
  const glmOpts = {
    model: modelId,
    messages: toChatGLMMessages(effMessages, uploads, { languageRule: true }),
    chatMode: resolveChatMode({
      reasoningEffort: effort || undefined,
      enableThinking: typeof body.enable_thinking === "boolean" ? body.enable_thinking : undefined,
    }),
    networking: body.is_networking === true,
  };

  let glmRes: Response;
  try {
    glmRes = await openChatGLMCompletion(glmOpts);
  } catch (e: any) {
    const status = e instanceof ChatGLMError ? e.status : 502;
    logUsage(recordId, modelId, hadImage, wantStream, status);
    return err(e.message || "Upstream error", status, status === 400 ? "invalid_request_error" : "upstream_error");
  }

  const id = "chatcmpl-" + randomUUID();
  const created = Math.floor(Date.now() / 1000);
  const withReasoning = showReasoning();
  const summary = emptyChatGLMSummary();

  // An image the text model decided to draw mid-answer still has to reach the
  // caller, so it is folded into the text as markdown like the image models'.
  const asMarkdown = (u: string) => `\n\n![image](${watermark ? buildMediaUrl(origin, u, watermark) : u})\n\n`;

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
          const parser = registry ? new ToolStream(registry) : null;
          let toolCalls: OAIToolCall[] = [];
          try {
            for await (const d of chatglmRun(glmOpts, summary, glmRes)) {
              if (d.kind === "reasoning") {
                if (withReasoning && d.text) send({ reasoning_content: d.text });
                continue;
              }
              const text = d.kind === "image" ? asMarkdown(d.text) : d.text;
              if (parser && d.kind !== "image") {
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
          logUsage(recordId, modelId, hadImage, true, 499);
        } finally {
          hb.stop();
          await glmRes.body?.cancel().catch(() => {});
        }
      },
      async cancel() {
        hb?.stop();
        await glmRes.body?.cancel().catch(() => {});
      },
    });
    return new Response(stream, { headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", Connection: "keep-alive" } });
  }

  let content = "";
  let reasoning = "";
  try {
    for await (const d of chatglmRun(glmOpts, summary, glmRes)) {
      if (d.kind === "reasoning") reasoning += d.text;
      else if (d.kind === "image") content += asMarkdown(d.text);
      else content += d.text;
    }
  } catch (e: any) {
    const status = e instanceof ChatGLMError ? e.status : 502;
    logUsage(recordId, modelId, hadImage, false, status);
    return err(e.message || "Upstream error", status, "upstream_error");
  } finally {
    await glmRes.body?.cancel().catch(() => {});
  }
  logUsage(recordId, modelId, hadImage, false, 200);

  const { content: toolContent, toolCalls: parsed } = toolsOn
    ? extractToolCalls(content, body.tools)
    : { content, toolCalls: [] as OAIToolCall[] };
  const toolCalls = toolsOn ? applyToolPolicy(parsed, body, buildRegistry(body.tools)) : [];

  const message: Record<string, unknown> = {
    role: "assistant",
    content: toolCalls.length ? toolContent : content,
  };
  if (toolCalls.length) message.tool_calls = toolCalls;
  if (withReasoning && reasoning) message.reasoning_content = reasoning;

  return NextResponse.json({
    id,
    object: "chat.completion",
    created,
    model: modelId,
    choices: [{ index: 0, message, finish_reason: toolCalls.length ? "tool_calls" : "stop" }],
    usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
  });
}

/** A finished media answer, in both the streamed and buffered shapes. */
function mediaReply(args: { markdown: string; modelId: string; wantStream: boolean }) {
  const { markdown, modelId, wantStream } = args;
  const id = "chatcmpl-" + randomUUID();
  const created = Math.floor(Date.now() / 1000);

  if (wantStream) {
    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      start(controller) {
        const send = (o: unknown) => controller.enqueue(encoder.encode(`data: ${JSON.stringify(o)}\n\n`));
        const chunk = (delta: any, finish: string | null = null) => ({
          id, object: "chat.completion.chunk", created, model: modelId,
          choices: [{ index: 0, delta, finish_reason: finish }],
        });
        send(chunk({ role: "assistant" }));
        send(chunk({ content: markdown }));
        send(chunk({}, "stop"));
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
    choices: [{ index: 0, message: { role: "assistant", content: markdown }, finish_reason: "stop" }],
    usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
  });
}

// --- NVIDIA NIM (Muse Glimmer) ----------------------------------------------
//
// A plain OpenAI-compatible upstream, so this is the Zen path with one
// difference: reasoning is a two-state switch sent as chat_template_kwargs
// rather than a reasoning_effort level, which means `enable_thinking` is the
// only knob and no effort list is advertised. See lib/nvidia.ts for why the key
// is `enable_thinking` and not `thinking`.
async function handleNvidia(args: {
  messages: OpenAIMessage[];
  modelId: string;
  wantStream: boolean;
  hadImage: boolean;
  recordId: string;
  body: any;
}) {
  const { messages, modelId, wantStream, hadImage, recordId, body } = args;

  const model = resolveNvidiaModel(modelId);
  if (!model) {
    logUsage(recordId, modelId, hadImage, wantStream, 404);
    return err(`Model '${modelId}' is not available.`, 404, "model_not_found");
  }

  // The models exposed here are text-only.
  if (hadImage) {
    logUsage(recordId, modelId, hadImage, wantStream, 400);
    return err(`Model '${modelId}' does not accept image input.`, 400);
  }

  const toolsOn = hasTools(body);
  const effMessages: OpenAIMessage[] = toolsOn
    ? (preprocessToolMessages(messages, body.tools, body.tool_choice) as OpenAIMessage[])
    : messages;

  let nvRes: Response;
  try {
    nvRes = await openNvidiaCompletion({
      model: modelId,
      messages: effMessages,
      stream: wantStream,
      temperature: typeof body.temperature === "number" ? body.temperature : undefined,
      max_tokens: typeof body.max_tokens === "number" ? body.max_tokens : undefined,
      top_p: typeof body.top_p === "number" ? body.top_p : undefined,
      enableThinking: typeof body.enable_thinking === "boolean" ? body.enable_thinking : undefined,
    });
  } catch (e: any) {
    const status = e instanceof NvidiaError ? e.status : 502;
    logUsage(recordId, modelId, hadImage, wantStream, status);
    return err(e.message || "Upstream error", status, "upstream_error");
  }

  const id = "chatcmpl-" + randomUUID();
  const created = Math.floor(Date.now() / 1000);
  const withReasoning = showReasoning();

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

          const parser = registry ? new ToolStream(registry) : null;
          let toolCalls: OAIToolCall[] = [];

          try {
            for await (const d of nvidiaDeltas(nvRes)) {
              if (d.kind === "reasoning") {
                if (withReasoning && d.text) send({ reasoning_content: d.text });
                continue;
              }
              if (parser) {
                const out = parser.push(d.text);
                if (out) send({ content: out });
              } else {
                send({ content: d.text });
              }
            }
            if (parser) {
              const fin = parser.end();
              if (fin.text) send({ content: fin.text });
              toolCalls = applyToolPolicy(fin.toolCalls, body, registry!);
            }
          } catch (e: any) {
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
          logUsage(recordId, modelId, hadImage, true, 499);
        } finally {
          hb.stop();
          await nvRes.body?.cancel().catch(() => {});
        }
      },
      async cancel() {
        hb?.stop();
        await nvRes.body?.cancel().catch(() => {});
      },
    });
    return new Response(stream, { headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", Connection: "keep-alive" } });
  }

  // Non-stream client: upstream always streams to us, so reassemble it here.
  // Buffering our own stream is what keeps a cold model from hanging the
  // request past the point NVIDIA would have returned a body at all.
  let content = "";
  let reasoning = "";
  try {
    for await (const d of nvidiaDeltas(nvRes)) {
      if (d.kind === "reasoning") reasoning += d.text;
      else content += d.text;
    }
  } catch (e: any) {
    const status = e instanceof NvidiaError ? e.status : 502;
    logUsage(recordId, modelId, hadImage, false, status);
    return err(e.message || "Upstream error", status, "upstream_error");
  } finally {
    await nvRes.body?.cancel().catch(() => {});
  }
  logUsage(recordId, modelId, hadImage, false, 200);

  const { content: toolContent, toolCalls: parsed } = toolsOn
    ? extractToolCalls(content, body.tools)
    : { content, toolCalls: [] as OAIToolCall[] };
  const toolCalls = toolsOn ? applyToolPolicy(parsed, body, buildRegistry(body.tools)) : [];

  const message: Record<string, unknown> = {
    role: "assistant",
    content: toolCalls.length ? toolContent : content,
  };
  if (toolCalls.length) message.tool_calls = toolCalls;
  if (withReasoning && reasoning) message.reasoning_content = reasoning;

  return NextResponse.json({
    id,
    object: "chat.completion",
    created,
    model: modelId,
    choices: [
      {
        index: 0,
        message,
        finish_reason: toolCalls.length ? "tool_calls" : "stop",
      },
    ],
    usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
  });
}

async function routeNativeToolCall(args: {
  req: NextRequest; body: any; messages: OpenAIMessage[]; requestedModelId: string;
  routerModelId: string; recordId: string; wantStream: boolean;
}) {
  const { req, body, messages, requestedModelId, routerModelId, recordId, wantStream } = args;
  if (!routerModelId || !(await modelEnabled(routerModelId))) return err("The configured tool-routing model is unavailable.", 503, "tool_router_unavailable", req);
  const router = await customProviderModel(routerModelId);
  if (!router) return err("The configured tool-routing model is unavailable.", 503, "tool_router_unavailable", req);
  try {
    const routedBody = { ...body, model: routerModelId, stream: false, messages: routerMessages(messages) };
    const { response } = await proxyCustomChat(router, routedBody, req.signal);
    const payload = await response.json();
    const calls = validateNativeToolCalls(payload?.choices?.[0]?.message?.tool_calls, body.tools, body);
    if (!calls.length) return err("The tool router returned no valid tool call.", 502, "invalid_tool_call", req);
    await logUsage(recordId, requestedModelId, false, wantStream, 200, { provider: router.provider_slug, requestId: req.headers.get("x-request-id") || undefined });
    const id = "chatcmpl-" + randomUUID();
    const created = Math.floor(Date.now() / 1000);
    if (!wantStream) return NextResponse.json({ id, object: "chat.completion", created, model: requestedModelId, choices: [{ index: 0, message: { role: "assistant", content: null, tool_calls: calls }, finish_reason: "tool_calls" }] });
    const chunks = [
      { id, object: "chat.completion.chunk", created, model: requestedModelId, choices: [{ index: 0, delta: { role: "assistant", tool_calls: streamDelta(calls) }, finish_reason: null }] },
      { id, object: "chat.completion.chunk", created, model: requestedModelId, choices: [{ index: 0, delta: {}, finish_reason: "tool_calls" }] },
    ];
    return new Response(chunks.map((chunk) => `data: ${JSON.stringify(chunk)}\\n\\n`).join("") + "data: [DONE]\\n\\n", { headers: { "content-type": "text/event-stream; charset=utf-8" } });
  } catch (error) {
    const status = error instanceof CustomProviderError ? error.status : 502;
    return err("The tool router is unavailable.", status >= 500 ? status : 502, "tool_router_unavailable", req);
  }
}

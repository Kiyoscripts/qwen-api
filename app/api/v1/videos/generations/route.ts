import { NextRequest, NextResponse } from "next/server";
import {
  buildMessage,
  createChat,
  deleteChat,
  forgetAllMemories,
  extractWanxTaskId,
  openCompletion,
  pollTask,
  resolveModel,
  QwenError,
} from "@/lib/qwen";
import { pickToken } from "@/lib/tokens";
import { extractApiKey, validateApiKey, logUsage } from "@/lib/supabase";

export const runtime = "nodejs";
export const maxDuration = 300;

const DEFAULT_VIDEO_MODEL = "qwen3-max-2026-01-23";

function err(message: string, status: number, type = "invalid_request_error") {
  return NextResponse.json({ error: { message, type } }, { status });
}

// Text-to-video. Video generation can take many minutes, and a serverless
// function can't stay open indefinitely — so by default this returns a task id
// immediately and you poll GET /v1/videos/status?task_id=…&chat_id=… for as long
// as you like (no timeout at all).
//
//   POST /v1/videos/generations { "prompt": "...", "model"?: "...", "wait"?: true }
//     default -> { id, chat_id, status: "processing" }
//     wait:true -> blocks and returns { data: [{ url }] } (bounded by maxDuration)
export async function POST(req: NextRequest) {
  const key = extractApiKey(req.headers);
  if (!key) return err("Missing API key.", 401);
  const record = await validateApiKey(key);
  if (!record) return err("Invalid or revoked API key.", 401);

  let body: any;
  try {
    body = await req.json();
  } catch {
    return err("Request body must be valid JSON.", 400);
  }
  const prompt = typeof body.prompt === "string" ? body.prompt : "";
  if (!prompt) return err("'prompt' is required.", 400);
  const modelId = typeof body.model === "string" && body.model ? body.model : DEFAULT_VIDEO_MODEL;
  const wait = body.wait === true;

  let pooled;
  try {
    pooled = await pickToken();
  } catch (e: any) {
    return err(e.message, 503, "no_token");
  }
  const token = pooled.token;

  const model = await resolveModel(token, modelId);
  if (!model) return err(`Model '${modelId}' is not available.`, 404, "model_not_found");
  if (!model.chatTypes.includes("t2v")) return err(`Model '${modelId}' does not support video generation.`, 400, "model_not_supported");

  let chatId: string | undefined;
  let taskId: string | null = null;
  try {
    chatId = await createChat(token, modelId, "t2v");
    const messages = [buildMessage([{ role: "user", content: prompt }], { model: modelId, chatType: "t2v", thinking: false })];
    // Video is async: the non-stream request returns a task id.
    const res = await openCompletion(token, chatId, { model: modelId, messages, stream: false });
    const json = await res.json().catch(() => ({}));
    taskId = extractWanxTaskId(json);
    if (!taskId) throw new QwenError(`No video task returned: ${JSON.stringify(json).slice(0, 200)}`);
  } catch (e: any) {
    await deleteChat(token, chatId);
    const status = e instanceof QwenError ? e.status : 502;
    logUsage(record.id, modelId, false, false, status);
    return err(e.message || "Video generation failed", status, "upstream_error");
  }

  if (!wait) {
    logUsage(record.id, modelId, false, false, 202);
    // Note: the chat is kept until the task finishes; /v1/videos/status cleans up.
    return NextResponse.json({ id: taskId, chat_id: chatId, status: "processing" }, { status: 202 });
  }

  // Synchronous mode (bounded by the function's maxDuration).
  try {
    const url = await pollTask(token, taskId, 280_000);
    await Promise.all([deleteChat(token, chatId), forgetAllMemories(token)]);
    logUsage(record.id, modelId, false, false, 200);
    return NextResponse.json({ created: Math.floor(Date.now() / 1000), data: [{ url }] });
  } catch (e: any) {
    // Don't delete the chat — the task may still finish; caller can poll by id.
    const status = e instanceof QwenError ? e.status : 502;
    logUsage(record.id, modelId, false, false, status);
    return NextResponse.json(
      { id: taskId, chat_id: chatId, status: "processing", note: "Still rendering — poll /v1/videos/status." },
      { status: 202 }
    );
  }
}

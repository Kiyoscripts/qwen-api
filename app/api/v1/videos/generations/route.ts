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
export const maxDuration = 300; // video generation can take a couple of minutes

const DEFAULT_VIDEO_MODEL = "qwen3-max-2026-01-23";

function err(message: string, status: number, type = "invalid_request_error") {
  return NextResponse.json({ error: { message, type } }, { status });
}

// Text-to-video. Non-OpenAI-standard shape:
//   POST /v1/videos/generations { "prompt": "...", "model"?: "..." }
//   -> { "created": <ts>, "data": [{ "url": "https://…mp4" }] }
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
  let url = "";
  try {
    chatId = await createChat(token, modelId, "t2v");
    const messages = [buildMessage([{ role: "user", content: prompt }], { model: modelId, chatType: "t2v", thinking: false })];
    // Video is async: non-stream request returns a task id, then we poll.
    const res = await openCompletion(token, chatId, { model: modelId, messages, stream: false });
    const json = await res.json().catch(() => ({}));
    const taskId = extractWanxTaskId(json);
    if (!taskId) throw new QwenError(`No video task returned: ${JSON.stringify(json).slice(0, 200)}`);
    url = await pollTask(token, taskId);
  } catch (e: any) {
    await deleteChat(token, chatId);
    const status = e instanceof QwenError ? e.status : 502;
    logUsage(record.id, modelId, false, false, status);
    return err(e.message || "Video generation failed", status, "upstream_error");
  }
  await Promise.all([deleteChat(token, chatId), forgetAllMemories(token)]);
  logUsage(record.id, modelId, false, false, 200);

  return NextResponse.json({ created: Math.floor(Date.now() / 1000), data: [{ url }] });
}

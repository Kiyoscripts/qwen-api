import { NextRequest, NextResponse } from "next/server";
import { deleteChat, forgetAllMemories, pollTask, QwenError } from "@/lib/qwen";
import { startVideo, VIDEO_ENABLED } from "@/lib/media";
import { withTokenFailover } from "@/lib/tokens";
import { extractApiKey, validateApiKey, logUsage } from "@/lib/supabase";

export const runtime = "nodejs";
export const maxDuration = 300;

function err(message: string, status: number, type = "invalid_request_error") {
  return NextResponse.json({ error: { message, type } }, { status });
}

// Text-to-video (model: "qwen-vlo"). Generation can take many minutes and a
// serverless function can't stay open indefinitely, so by default this returns a
// task id immediately and you poll GET /v1/videos/status for as long as you like.
//
//   POST /v1/videos/generations { "prompt": "...", "wait"?: true }
//     default   -> 202 { id, chat_id, status: "processing" }
//     wait:true -> { data: [{ url }] } (bounded by maxDuration; falls back to 202)
export async function POST(req: NextRequest) {
  if (!VIDEO_ENABLED) return err("Video generation is disabled.", 404, "not_supported");
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
  const modelId = typeof body.model === "string" && body.model ? body.model : "qwen-vlo";
  const wait = body.wait === true;

  // Fail over to an account that still has usage left.
  let token: string;
  let chatId: string;
  let taskId: string;
  try {
    const { token: usedToken, result } = await withTokenFailover((t) => startVideo(t, prompt));
    token = usedToken;
    chatId = result.chatId;
    taskId = result.taskId;
  } catch (e: any) {
    const status = e instanceof QwenError ? e.status : 502;
    logUsage(record.id, modelId, false, false, status);
    return err(e.message || "Video generation failed", status, "upstream_error");
  }

  if (!wait) {
    logUsage(record.id, modelId, false, false, 202);
    return NextResponse.json({ id: taskId, chat_id: chatId, status: "processing" }, { status: 202 });
  }

  try {
    const url = await pollTask(token, taskId, 280_000);
    void Promise.all([deleteChat(token, chatId), forgetAllMemories(token)]);
    logUsage(record.id, modelId, false, false, 200);
    return NextResponse.json({ created: Math.floor(Date.now() / 1000), data: [{ url }] });
  } catch (e: any) {
    const status = e instanceof QwenError ? e.status : 502;
    logUsage(record.id, modelId, false, false, status);
    return NextResponse.json(
      { id: taskId, chat_id: chatId, status: "processing", note: "Still rendering — poll /v1/videos/status." },
      { status: 202 }
    );
  }
}

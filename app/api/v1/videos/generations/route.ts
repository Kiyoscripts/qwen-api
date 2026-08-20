import { NextRequest, NextResponse } from "next/server";
import { claimIdempotency, completeIdempotency, abandonIdempotency } from "@/lib/idempotency";
import { apiError } from "@/lib/apiErrors";
import { modelEnabled, capabilityEnabled } from "@/lib/settings";
import { deleteChat, forgetAllMemories, pollTask, QwenError } from "@/lib/qwen";
import { startVideo, VIDEO_ENABLED } from "@/lib/media";
import { withTokenFailover } from "@/lib/tokens";
import { seal } from "@/lib/secureToken";
import { logUsage } from "@/lib/supabase";
import { authenticate, modelAllowed } from "@/lib/apiAuth";

export const runtime = "nodejs";
export const maxDuration = 300;

function err(message: string, status: number, type = "invalid_request_error", req?: Request) {
  const code = type === "model_not_found" ? "model_not_found" : type === "service_unavailable" ? "service_unavailable" : type === "upstream_error" ? "provider_unavailable" : status === 401 ? "invalid_api_key" : status === 403 ? "model_not_allowed" : "invalid_request";
  return apiError(req, message, status, code, type);
}

// Reference image(s) for image-to-video, from any of the common shapes.
function collectImages(body: any): string[] {
  const out: string[] = [];
  const push = (v: unknown) => {
    if (typeof v === "string" && v) out.push(v);
    else if (v && typeof v === "object") {
      const u = (v as any).url || (v as any).image_url?.url;
      if (typeof u === "string") out.push(u);
    }
  };
  if (Array.isArray(body.images)) body.images.forEach(push);
  else if (body.images) push(body.images);
  if (Array.isArray(body.image)) body.image.forEach(push);
  else if (body.image) push(body.image);
  return out;
}

// Text-to-video (model: "qwen-wan"). Generation can take many minutes and a
// serverless function can't stay open indefinitely, so by default this returns a
// task id immediately and you poll GET /v1/videos/status for as long as you like.
//
//   POST /v1/videos/generations { "prompt": "...", "wait"?: true }
//     default   -> 202 { id, chat_id, status: "processing" }
//     wait:true -> { data: [{ url }] } (bounded by maxDuration; falls back to 202)
export async function POST(req: NextRequest) {
  if (!VIDEO_ENABLED) return err("Video generation is disabled.", 404, "not_supported");
  const record = await authenticate(req);
  if (!record) return err("Missing or invalid API key.", 401);

  let body: any;
  try {
    body = await req.json();
  } catch {
    return err("Request body must be valid JSON.", 400);
  }
  const prompt = typeof body.prompt === "string" ? body.prompt : "";
  const images = collectImages(body);
  if (!prompt && images.length === 0) return err("'prompt' is required.", 400);
  const modelId = typeof body.model === "string" && body.model ? body.model : "qwen-wan";
  const capability = await capabilityEnabled("video");
  if (!capability.enabled) return err(capability.message, 503, "service_unavailable");
  if (!(await modelEnabled(modelId))) return err("The requested model is disabled.", 404, "model_not_found");
  if (!modelAllowed(record, modelId)) return err("This API key is not permitted to use the requested model.", 403);
  const idempotency = await claimIdempotency(req, record.id, "/v1/videos/generations", body);
  if (idempotency.kind === "replay") return idempotency.response;
  if (idempotency.kind === "conflict") return err(idempotency.message, 409);
  const idempotencyId = idempotency.kind === "new" ? idempotency.id : null;
  const finish = (response: Response) => idempotencyId ? completeIdempotency(idempotencyId, response) : response;
  const size = typeof body.size === "string" ? body.size : undefined;
  const wait = body.wait === true;

  // Fail over to an account that still has usage left.
  let token: string;
  let entryId: string | null;
  let chatId: string;
  let taskId: string;
  try {
    const { token: usedToken, entryId: usedId, result } = await withTokenFailover((t) => startVideo(t, prompt, { size, images }));
    token = usedToken;
    entryId = usedId;
    chatId = result.chatId;
    taskId = result.taskId;
  } catch (e: any) {
    const status = e instanceof QwenError ? e.status : 502;
    logUsage(record.id, modelId, false, false, status);
    return err(e.message || "Video generation failed", status, "upstream_error");
  }

  if (!wait) {
    logUsage(record.id, modelId, false, false, 202);
    const created = Math.floor(Date.now() / 1000);
    // The task lives on ONE pooled account; the ticket pins polling to it (a random
    // account would get "not found" forever). It also carries `created` for progress.
    const ticket = seal({ id: entryId, task: taskId, chat: chatId, created });
    return finish(NextResponse.json({ id: taskId, chat_id: chatId, status: "processing", created, ticket }, { status: 202 }));
  }

  try {
    const url = await pollTask(token, taskId, 280_000);
    void Promise.all([deleteChat(token, chatId), forgetAllMemories(token)]);
    logUsage(record.id, modelId, false, false, 200);
    return finish(NextResponse.json({ created: Math.floor(Date.now() / 1000), data: [{ url }] }));
  } catch (e: any) {
    const status = e instanceof QwenError ? e.status : 502;
    logUsage(record.id, modelId, false, false, status);
    return finish(NextResponse.json(
      { id: taskId, chat_id: chatId, status: "processing", note: "Still rendering — poll /v1/videos/status." },
      { status: 202 }
    ));
  }
}
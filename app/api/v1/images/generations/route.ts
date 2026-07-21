import { NextRequest, NextResponse } from "next/server";
import {
  buildMessage,
  createChat,
  deleteChat,
  forgetAllMemories,
  openCompletion,
  qwenDeltas,
  resolveModel,
  QwenError,
} from "@/lib/qwen";
import { pickToken } from "@/lib/tokens";
import { extractApiKey, validateApiKey, logUsage } from "@/lib/supabase";

export const runtime = "nodejs";
export const maxDuration = 300;

// Default to a model that supports image generation (t2i).
const DEFAULT_IMAGE_MODEL = "qwen3-max-2026-01-23";

function err(message: string, status: number, type = "invalid_request_error") {
  return NextResponse.json({ error: { message, type } }, { status });
}

// Map OpenAI-style sizes to Qwen aspect ratios; pass ratios through.
function toRatio(size?: string): string {
  if (!size) return "1:1";
  if (/^\d+:\d+$/.test(size)) return size;
  const map: Record<string, string> = {
    "1024x1024": "1:1",
    "1792x1024": "16:9",
    "1024x1792": "9:16",
    "1152x896": "4:3",
    "896x1152": "3:4",
  };
  return map[size] || "1:1";
}

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
  const modelId = typeof body.model === "string" && body.model ? body.model : DEFAULT_IMAGE_MODEL;
  const size = toRatio(body.size);
  const wantB64 = body.response_format === "b64_json";

  let pooled;
  try {
    pooled = await pickToken();
  } catch (e: any) {
    return err(e.message, 503, "no_token");
  }
  const token = pooled.token;

  const model = await resolveModel(token, modelId);
  if (!model) return err(`Model '${modelId}' is not available.`, 404, "model_not_found");
  if (!model.chatTypes.includes("t2i")) return err(`Model '${modelId}' does not support image generation.`, 400, "model_not_supported");

  let chatId: string | undefined;
  let url = "";
  try {
    chatId = await createChat(token, modelId, "t2i");
    const messages = [buildMessage([{ role: "user", content: prompt }], { model: modelId, chatType: "t2i", thinking: false, size })];
    const res = await openCompletion(token, chatId, { model: modelId, messages, stream: true, size });
    let content = "";
    for await (const { text } of qwenDeltas(res)) content += text;
    const m = content.match(/https?:\/\/[^"\\\s]+/);
    if (!m) throw new QwenError("No image URL returned.");
    url = m[0];
  } catch (e: any) {
    await deleteChat(token, chatId);
    const status = e instanceof QwenError ? e.status : 502;
    logUsage(record.id, modelId, false, false, status);
    return err(e.message || "Image generation failed", status, "upstream_error");
  }
  await Promise.all([deleteChat(token, chatId), forgetAllMemories(token)]);
  logUsage(record.id, modelId, false, false, 200);

  const created = Math.floor(Date.now() / 1000);
  if (wantB64) {
    try {
      const imgRes = await fetch(url);
      const b64 = Buffer.from(await imgRes.arrayBuffer()).toString("base64");
      return NextResponse.json({ created, data: [{ b64_json: b64 }] });
    } catch {
      return NextResponse.json({ created, data: [{ url }] });
    }
  }
  return NextResponse.json({ created, data: [{ url }] });
}

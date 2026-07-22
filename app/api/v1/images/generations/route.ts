import { NextRequest, NextResponse } from "next/server";
import { generateImage, virtualModel, VIRTUAL_MODELS } from "@/lib/media";
import { QwenError } from "@/lib/qwen";
import { withTokenFailover } from "@/lib/tokens";
import { extractApiKey, validateApiKey, logUsage } from "@/lib/supabase";

export const runtime = "nodejs";
export const maxDuration = 300;

const DEFAULT_IMAGE_VERSION = "qwen-image-3.0-pro";

function err(message: string, status: number, type = "invalid_request_error") {
  return NextResponse.json({ error: { message, type } }, { status });
}

// Resolve the requested model to a Qwen image-model version id.
function resolveImageModel(model?: string): string {
  if (!model) return DEFAULT_IMAGE_VERSION;
  const vm = virtualModel(model); // qwen-image-2.0 / qwen-image-3.0
  if (vm?.imageModelId) return vm.imageModelId;
  if (/^qwen-image-\d\.\d-pro$/.test(model)) return model; // already a version id
  return DEFAULT_IMAGE_VERSION;
}

// Collect reference images from any of the common shapes, for editing.
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

// POST /v1/images/generations
//   { "prompt": "...", "model"?: "qwen-image-3.0", "size"?: "1:1",
//     "image"?: <ref image(s) for editing>, "response_format"?: "url"|"b64_json" }
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
  const images = collectImages(body);
  if (!prompt && images.length === 0) return err("'prompt' is required.", 400);

  const imageModelId = resolveImageModel(typeof body.model === "string" ? body.model : undefined);
  const size = typeof body.size === "string" ? body.size : undefined;
  const wantB64 = body.response_format === "b64_json";

  let url = "";
  try {
    const { result } = await withTokenFailover((token) => generateImage(token, { prompt, images, imageModelId, size }));
    url = result;
  } catch (e: any) {
    const status = e instanceof QwenError ? e.status : 502;
    logUsage(record.id, imageModelId, images.length > 0, false, status);
    return err(e.message || "Image generation failed", status, "upstream_error");
  }
  logUsage(record.id, imageModelId, images.length > 0, false, 200);

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

// GET /v1/images/generations -> lists the available image models (handy).
export async function GET(req: NextRequest) {
  const key = extractApiKey(req.headers);
  if (!key || !(await validateApiKey(key))) {
    return NextResponse.json({ error: { message: "Invalid or missing API key." } }, { status: 401 });
  }
  return NextResponse.json({
    object: "list",
    data: VIRTUAL_MODELS.filter((m) => m.kind === "image").map((m) => ({ id: m.id, name: m.name })),
  });
}

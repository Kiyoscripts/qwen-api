import { NextRequest, NextResponse } from "next/server";
import { claimIdempotency, completeIdempotency, abandonIdempotency } from "@/lib/idempotency";
import { apiError } from "@/lib/apiErrors";
import { modelEnabled, capabilityEnabled } from "@/lib/settings";
import { generateImage, virtualModel, VIRTUAL_MODELS } from "@/lib/media";
import { resolveWatermark, buildMediaUrl, applyWatermark } from "@/lib/watermark";
import { QwenError } from "@/lib/qwen";
import { withTokenFailover } from "@/lib/tokens";
import { logUsage } from "@/lib/supabase";
import { authenticate, modelAllowed } from "@/lib/apiAuth";
import { publicOrigin } from "@/lib/canonicalHost";

export const runtime = "nodejs";
export const maxDuration = 300;

const DEFAULT_IMAGE_VERSION = "qwen-image-3.0-pro";

function err(message: string, status: number, type = "invalid_request_error", req?: Request) {
  const code = type === "model_not_found" ? "model_not_found" : type === "service_unavailable" ? "service_unavailable" : type === "upstream_error" ? "provider_unavailable" : status === 401 ? "invalid_api_key" : status === 403 ? "model_not_allowed" : "invalid_request";
  return apiError(req, message, status, code, type);
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
//     "image"?: <ref image(s) for editing>, "response_format"?: "url"|"b64_json",
//     "watermark"?: false | "My Brand" }  // default "Syde"; false removes it
export async function POST(req: NextRequest) {
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

  const imageModelId = resolveImageModel(typeof body.model === "string" ? body.model : undefined);
  const capability = await capabilityEnabled("images");
  if (!capability.enabled) return err(capability.message, 503, "service_unavailable");
  if (!(await modelEnabled(imageModelId))) return err("The requested model is disabled.", 404, "model_not_found");
  if (!modelAllowed(record, imageModelId)) return err("This API key is not permitted to use the requested model.", 403);
  const idempotency = await claimIdempotency(req, record.id, "/v1/images/generations", body);
  if (idempotency.kind === "replay") return idempotency.response;
  if (idempotency.kind === "conflict") return err(idempotency.message, 409);
  const idempotencyId = idempotency.kind === "new" ? idempotency.id : null;
  const finish = (response: Response) => idempotencyId ? completeIdempotency(idempotencyId, response) : response;
  const size = typeof body.size === "string" ? body.size : undefined;
  const wantB64 = body.response_format === "b64_json";
  // Default watermark "Syde"; pass watermark:false to remove or a string to customize.
  const watermark = resolveWatermark(body.watermark);

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
      let bytes: Uint8Array = new Uint8Array(await imgRes.arrayBuffer());
      if (watermark) {
        try {
          bytes = (await applyWatermark(bytes, watermark, imgRes.headers.get("content-type") || undefined)).buffer;
        } catch {
          /* keep the un-watermarked bytes if compositing fails */
        }
      }
      return finish(NextResponse.json({ created, data: [{ b64_json: Buffer.from(bytes).toString("base64") }] }));
    } catch {
      return finish(NextResponse.json({ created, data: [{ url }] }));
    }
  }
  // With a watermark we hand back a media-proxy URL that brands the image on the
  // fly; without one, the original CDN URL (clean image) is returned as before.
  const outUrl = watermark ? buildMediaUrl(publicOrigin(req), url, watermark) : url;
  return finish(NextResponse.json({ created, data: [{ url: outUrl }] }));
}

// GET /v1/images/generations -> lists the available image models (handy).
export async function GET(req: NextRequest) {
  if (!(await authenticate(req))) {
    return NextResponse.json({ error: { message: "Invalid or missing API key." } }, { status: 401 });
  }
  return NextResponse.json({
    object: "list",
    data: VIRTUAL_MODELS.filter((m) => m.kind === "image").map((m) => ({ id: m.id, name: m.name })),
  });
}
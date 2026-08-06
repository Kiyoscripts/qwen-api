import { NextRequest, NextResponse } from "next/server";
import { getModels } from "@/lib/qwen";
import { ONECOMPILER_MODELS } from "@/lib/onecompiler";
import { TOKENROUTER_MODELS, tokenRouterConfigured } from "@/lib/tokenrouter";
import { VIRTUAL_MODELS } from "@/lib/media";
import { CUSTOM_MODELS } from "@/lib/customModels";
import { withTokenFailover } from "@/lib/tokens";
import { authenticate } from "@/lib/apiAuth";

export const runtime = "nodejs";

// Image/video generation models (always available; served via the Qwen pool).
const mediaEntries = VIRTUAL_MODELS.map((m) => ({
  id: m.id,
  object: "model" as const,
  created: 0,
  owned_by: "qwen",
  display_name: m.name,
  capabilities: {
    vision: m.kind === "image", // image models accept a reference image (editing)
    thinking: false,
    chat_types: m.kind === "image" ? ["t2i", "image_edit"] : ["t2v"],
  },
}));

// Custom slugs (persona + system prompt over a real Qwen model).
const customEntries = CUSTOM_MODELS.map((m) => ({
  id: m.id,
  object: "model" as const,
  created: 0,
  owned_by: "qwen",
  display_name: m.name,
  description: m.description,
  capabilities: { vision: true, thinking: true, chat_types: ["t2t"] },
}));

// OneCompiler free-tier models. Its "Premium" models are not in the registry and
// so are never advertised here.
const oneCompilerEntries = ONECOMPILER_MODELS.map((m) => ({
  id: m.id,
  object: "model" as const,
  created: 0,
  owned_by: "onecompiler",
  display_name: m.name,
  capabilities: { vision: false, thinking: false, chat_types: ["t2t"], input: { text: true, image: false, document: false, video: false, audio: false } },
}));

// TokenRouter's free tier. Advertised only when a key is configured, so an
// unconfigured deploy does not offer a model that cannot answer.
const tokenRouterEntries = tokenRouterConfigured()
  ? TOKENROUTER_MODELS.map((m) => ({
      id: m.id,
      object: "model" as const,
      created: 0,
      owned_by: "tokenrouter",
      display_name: m.name,
      capabilities: { vision: false, thinking: false, chat_types: ["t2t"], input: { text: true, image: false, document: false, video: false, audio: false } },
    }))
  : [];

export async function GET(req: NextRequest) {
  if (!(await authenticate(req))) {
    return NextResponse.json({ error: { message: "Invalid or missing API key.", type: "invalid_request_error" } }, { status: 401 });
  }
  try {
    // The static entries are always available; Qwen models depend on the account pool.
    let qwenEntries: any[] = [];
    try {
      const { result: models } = await withTokenFailover((token) => getModels(token), 24, false);
      qwenEntries = models.map((m) => ({
        id: m.id,
        object: "model",
        created: 0,
        owned_by: "qwen",
        // extra, non-standard hints:
        display_name: m.name,
        capabilities: {
          vision: m.vision,
          thinking: m.thinking,
          chat_types: m.chatTypes,
          // Which inputs the model accepts, as declared by upstream per model.
          input: {
            text: true,
            image: m.vision,
            document: m.document,
            video: m.video,
            audio: m.audio,
          },
          ...(m.contextLength ? { context_length: m.contextLength } : {}),
        },
      }));
    } catch {
      /* Qwen pool unavailable -> still return the static entries */
    }
    return NextResponse.json({ object: "list", data: [...customEntries, ...mediaEntries, ...oneCompilerEntries, ...tokenRouterEntries, ...qwenEntries] });
  } catch (e: any) {
    return NextResponse.json({ error: { message: e.message, type: "upstream_error" } }, { status: 503 });
  }
}

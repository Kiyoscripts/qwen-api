import { NextRequest, NextResponse } from "next/server";
import { getModels } from "@/lib/qwen";
import { DEEPSEEK_MODELS } from "@/lib/deepseek";
import { VIRTUAL_MODELS } from "@/lib/media";
import { CUSTOM_MODELS } from "@/lib/customModels";
import { withTokenFailover } from "@/lib/tokens";
import { extractApiKey, validateApiKey } from "@/lib/supabase";

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

const deepseekEntries = DEEPSEEK_MODELS.map((m) => ({
  id: m.id,
  object: "model" as const,
  created: 0,
  owned_by: "deepseek",
  display_name: m.name,
  capabilities: { vision: m.vision, thinking: m.thinking, chat_types: ["t2t"] },
}));

export async function GET(req: NextRequest) {
  const key = extractApiKey(req.headers);
  if (!key || !(await validateApiKey(key))) {
    return NextResponse.json({ error: { message: "Invalid or missing API key.", type: "invalid_request_error" } }, { status: 401 });
  }
  try {
    // DeepSeek models are always available; Qwen models depend on the account pool.
    let qwenEntries: any[] = [];
    try {
      const { result: models } = await withTokenFailover((token) => getModels(token));
      qwenEntries = models.map((m) => ({
        id: m.id,
        object: "model",
        created: 0,
        owned_by: "qwen",
        // extra, non-standard hints:
        display_name: m.name,
        capabilities: { vision: m.vision, thinking: m.thinking, chat_types: m.chatTypes },
      }));
    } catch {
      /* Qwen pool unavailable -> still return DeepSeek models */
    }
    return NextResponse.json({ object: "list", data: [...customEntries, ...mediaEntries, ...deepseekEntries, ...qwenEntries] });
  } catch (e: any) {
    return NextResponse.json({ error: { message: e.message, type: "upstream_error" } }, { status: 503 });
  }
}

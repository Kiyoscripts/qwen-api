import { NextRequest, NextResponse } from "next/server";
import { getModels } from "@/lib/qwen";
import { DEEPSEEK_MODELS } from "@/lib/deepseek";
import { withTokenFailover } from "@/lib/tokens";
import { extractApiKey, validateApiKey } from "@/lib/supabase";

export const runtime = "nodejs";

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
    return NextResponse.json({ object: "list", data: [...deepseekEntries, ...qwenEntries] });
  } catch (e: any) {
    return NextResponse.json({ error: { message: e.message, type: "upstream_error" } }, { status: 503 });
  }
}

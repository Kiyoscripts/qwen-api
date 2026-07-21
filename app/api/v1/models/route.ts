import { NextRequest, NextResponse } from "next/server";
import { getModels } from "@/lib/qwen";
import { pickToken } from "@/lib/tokens";
import { extractApiKey, validateApiKey } from "@/lib/supabase";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const key = extractApiKey(req.headers);
  if (!key || !(await validateApiKey(key))) {
    return NextResponse.json({ error: { message: "Invalid or missing API key.", type: "invalid_request_error" } }, { status: 401 });
  }
  try {
    const { token } = await pickToken();
    const models = await getModels(token);
    return NextResponse.json({
      object: "list",
      data: models.map((m) => ({
        id: m.id,
        object: "model",
        created: 0,
        owned_by: "qwen",
        // extra, non-standard hints:
        display_name: m.name,
        capabilities: { vision: m.vision, thinking: m.thinking, chat_types: m.chatTypes },
      })),
    });
  } catch (e: any) {
    return NextResponse.json({ error: { message: e.message, type: "upstream_error" } }, { status: 503 });
  }
}

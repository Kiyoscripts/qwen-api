import { NextRequest, NextResponse } from "next/server";
import { getVoices } from "@/lib/tts";
import { withTokenFailover } from "@/lib/tokens";
import { extractApiKey, validateApiKey } from "@/lib/supabase";

export const runtime = "nodejs";

// Lists the available TTS voices (non-OpenAI-standard, but handy).
export async function GET(req: NextRequest) {
  const key = extractApiKey(req.headers);
  if (!key || !(await validateApiKey(key))) {
    return NextResponse.json({ error: { message: "Invalid or missing API key.", type: "invalid_request_error" } }, { status: 401 });
  }
  try {
    const { result: voices } = await withTokenFailover((token) => getVoices(token));
    return NextResponse.json({ object: "list", data: voices });
  } catch (e: any) {
    return NextResponse.json({ error: { message: e.message, type: "upstream_error" } }, { status: 503 });
  }
}

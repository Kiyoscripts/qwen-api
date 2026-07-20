import { NextRequest, NextResponse } from "next/server";
import { ALLOWED_MODEL } from "@/lib/qwen";
import { extractApiKey, validateApiKey } from "@/lib/supabase";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const key = extractApiKey(req.headers);
  if (!key || !(await validateApiKey(key))) {
    return NextResponse.json(
      { error: { message: "Invalid or missing API key.", type: "invalid_request_error" } },
      { status: 401 }
    );
  }
  return NextResponse.json({
    object: "list",
    data: [{ id: ALLOWED_MODEL, object: "model", created: 0, owned_by: "qwen" }],
  });
}

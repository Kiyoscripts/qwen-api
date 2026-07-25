import { NextRequest, NextResponse } from "next/server";
import { authenticate } from "@/lib/apiAuth";

export const runtime = "nodejs";

// Anthropic's POST /v1/messages/count_tokens. Claude Code (and the Anthropic SDK)
// call this before sending a message to size the context. Qwen gives us no real
// token count, so we return a ~chars/4 estimate — enough for context management.
export async function POST(req: NextRequest) {
  if (!(await authenticate(req))) {
    return NextResponse.json({ type: "error", error: { type: "authentication_error", message: "Invalid API key." } }, { status: 401 });
  }

  let body: any;
  try { body = await req.json(); } catch { body = {}; }

  let chars = 0;
  const addContent = (c: any) => {
    if (typeof c === "string") chars += c.length;
    else if (Array.isArray(c)) {
      for (const b of c) {
        if (typeof b === "string") chars += b.length;
        else if (b?.type === "text") chars += (b.text || "").length;
        else if (b?.type === "tool_result") chars += typeof b.content === "string" ? b.content.length : JSON.stringify(b.content ?? "").length;
        else if (b?.type === "tool_use") chars += JSON.stringify(b.input ?? "").length + (b.name || "").length;
        else if (b?.type === "image") chars += 1500; // rough flat cost for an image
      }
    }
  };

  if (body.system) addContent(body.system);
  for (const m of body.messages || []) addContent(m.content);
  if (body.tools) chars += JSON.stringify(body.tools).length;

  return NextResponse.json({ input_tokens: Math.max(1, Math.ceil(chars / 4)) });
}

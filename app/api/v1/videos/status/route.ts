import { NextRequest, NextResponse } from "next/server";
import { checkTask, deleteChat, forgetAllMemories } from "@/lib/qwen";
import { withTokenFailover } from "@/lib/tokens";
import { extractApiKey, validateApiKey } from "@/lib/supabase";

export const runtime = "nodejs";

// Poll a video task. Returns immediately — call it as often/long as you like;
// there is no timeout on generation.
//
//   GET /v1/videos/status?task_id=…&chat_id=…
//     -> { status: "processing" }
//     -> { status: "completed", data: [{ url }] }
//     -> { status: "failed" }
export async function GET(req: NextRequest) {
  const key = extractApiKey(req.headers);
  if (!key || !(await validateApiKey(key))) {
    return NextResponse.json({ error: { message: "Invalid or missing API key.", type: "invalid_request_error" } }, { status: 401 });
  }
  const taskId = req.nextUrl.searchParams.get("task_id");
  const chatId = req.nextUrl.searchParams.get("chat_id") || undefined;
  if (!taskId) return NextResponse.json({ error: { message: "task_id is required." } }, { status: 400 });

  try {
    const { token, result: state } = await withTokenFailover((t) => checkTask(t, taskId));
    if (state.status === "completed") {
      // Task is done — tidy up the throwaway chat.
      void Promise.all([deleteChat(token, chatId), forgetAllMemories(token)]);
      return NextResponse.json({ status: "completed", data: [{ url: state.url }] });
    }
    if (state.status === "failed") {
      void deleteChat(token, chatId);
      return NextResponse.json({ status: "failed" });
    }
    return NextResponse.json({ status: "processing" });
  } catch (e: any) {
    return NextResponse.json({ error: { message: e.message, type: "upstream_error" } }, { status: 503 });
  }
}

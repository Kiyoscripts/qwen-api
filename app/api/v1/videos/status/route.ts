import { NextRequest, NextResponse } from "next/server";
import { checkTask, deleteChat, forgetAllMemories, type TaskState } from "@/lib/qwen";
import { tokenById, poolTokens } from "@/lib/tokens";
import { VIDEO_ENABLED, estimateVideoProgress } from "@/lib/media";
import { unseal } from "@/lib/secureToken";
import { authenticate } from "@/lib/apiAuth";

export const runtime = "nodejs";

// Poll a video task. Returns immediately — call it as often/long as you like;
// there is no timeout on generation.
//
// A video task lives on ONE pooled account, so polling MUST hit that account. The
// generation response includes an encrypted `ticket` that pins the poll to it;
// pass it back here. (Without it we scan the pool to find the owner, which is why
// polling a random account used to spin forever.)
//
//   GET /v1/videos/status?ticket=…            (preferred)
//   GET /v1/videos/status?task_id=…&chat_id=…&started=…   (fallback: pool scan)
//     -> { status: "processing", progress }
//     -> { status: "completed", progress: 100, data: [{ url }] }
//     -> { status: "failed" }
export async function GET(req: NextRequest) {
  if (!VIDEO_ENABLED) {
    return NextResponse.json({ error: { message: "Video generation is disabled.", type: "not_supported" } }, { status: 404 });
  }
  if (!(await authenticate(req))) {
    return NextResponse.json({ error: { message: "Invalid or missing API key.", type: "invalid_request_error" } }, { status: 401 });
  }

  // Prefer the sealed ticket (pins to the owning account).
  const ticketRaw = req.nextUrl.searchParams.get("ticket");
  const ticket = ticketRaw ? unseal<{ id: string | null; task: string; chat?: string; created?: number }>(ticketRaw) : null;

  const taskId = ticket?.task || req.nextUrl.searchParams.get("task_id");
  const chatId = ticket?.chat || req.nextUrl.searchParams.get("chat_id") || undefined;
  const started = ticket?.created ?? (Number(req.nextUrl.searchParams.get("started")) || undefined);
  if (!taskId) return NextResponse.json({ error: { message: "task_id (or ticket) is required." } }, { status: 400 });

  try {
    let usedToken: string | null = null;
    let state: TaskState = { status: "not_found" };

    if (ticket) {
      // Pinned: check only the account that created the task.
      const pinned = await tokenById(ticket.id);
      if (pinned) {
        usedToken = pinned;
        state = await checkTask(pinned, taskId);
      }
    }

    // No ticket, or the pinned account is gone / didn't recognize it: scan the pool
    // and stop at the account that actually owns the task.
    if (!ticket || state.status === "not_found") {
      for (const entry of await poolTokens()) {
        const s = await checkTask(entry.token, taskId);
        if (s.status !== "not_found") {
          usedToken = entry.token;
          state = s;
          break;
        }
      }
    }

    if (state.status === "completed" && usedToken) {
      void Promise.all([deleteChat(usedToken, chatId), forgetAllMemories(usedToken)]);
      // Video is returned unwatermarked (raw CDN URL; the UIs proxy it for display).
      return NextResponse.json({ status: "completed", progress: 100, data: [{ url: state.url }] });
    }
    if (state.status === "failed") {
      if (usedToken) void deleteChat(usedToken, chatId);
      return NextResponse.json({ status: "failed", progress: 0 });
    }
    // Still running (or not yet visible on any account). Qwen exposes no real
    // progress; this is a time-based estimate (null without `started`/ticket).
    return NextResponse.json({ status: "processing", progress: estimateVideoProgress(started) });
  } catch (e: any) {
    return NextResponse.json({ error: { message: e.message, type: "upstream_error" } }, { status: 503 });
  }
}

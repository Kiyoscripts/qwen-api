import { NextRequest, NextResponse } from "next/server";
import {
  buildMessage,
  createChat,
  deleteChat,
  forgetAllMemories,
  openCompletion,
  QwenError,
} from "@/lib/qwen";
import { getVoices, setVoice, synthesize, pcmToWav } from "@/lib/tts";
import { withTokenFailover } from "@/lib/tokens";
import { logUsage } from "@/lib/supabase";
import { authenticate } from "@/lib/apiAuth";

export const runtime = "nodejs";
export const maxDuration = 300;

const TTS_HELPER_MODEL = process.env.QWEN_TTS_MODEL || "qwen3.8-max";

function err(message: string, status: number, type = "invalid_request_error") {
  return NextResponse.json({ error: { message, type } }, { status });
}

// OpenAI-compatible-ish TTS:
//   POST /v1/audio/speech { "input": "...", "voice": "Cherry" } -> audio/wav
//
// Qwen can only read aloud a message that exists in a chat, so we have the model
// emit the text verbatim first, then run its "read aloud" on that message.
export async function POST(req: NextRequest) {
  const record = await authenticate(req);
  if (!record) return err("Missing or invalid API key.", 401);

  let body: any;
  try {
    body = await req.json();
  } catch {
    return err("Request body must be valid JSON.", 400);
  }
  const input = typeof body.input === "string" ? body.input.trim() : "";
  if (!input) return err("'input' is required.", 400);
  if (input.length > 2000) return err("'input' is too long (max 2000 characters).", 400);
  const requestedVoice = typeof body.voice === "string" ? body.voice : "";

  // TTS costs an echo completion plus the synthesis, so a burnt-out account must
  // fail over to another one rather than failing the request.
  let wav: Buffer;
  try {
    const { result } = await withTokenFailover(async (token) => {
      // Resolve the voice against the real voice list.
      let voice = "";
      if (requestedVoice) {
        const voices = await getVoices(token);
        const match = voices.find((v) => v.speaker.toLowerCase() === requestedVoice.toLowerCase());
        if (!match) throw new QwenError(`Unknown voice '${requestedVoice}'. See GET /v1/audio/voices.`, 400);
        voice = match.speaker;
      }

      let chatId: string | undefined;
      try {
        if (voice) await setVoice(token, voice);

        // Get the text into an assistant message.
        chatId = await createChat(token, TTS_HELPER_MODEL, "t2t");
        const prompt = `Repeat the following text back exactly as written, with no extra words, no quotes and no commentary:\n\n${input}`;
        // Thinking stays on: reasoning adds nothing to repeating a string back,
        // but the default helper (qwen3.8-max) rejects a request with it
        // disabled — upstream answers "invalid_input" and generates nothing.
        const messages = [buildMessage([{ role: "user", content: prompt }], { model: TTS_HELPER_MODEL, chatType: "t2t", thinking: true })];
        const res = await openCompletion(token, chatId, { model: TTS_HELPER_MODEL, messages, stream: true });

        // We need the assistant message id (response_id), and proof that the
        // echo actually produced text: synthesis reads the *stored* message, so
        // an account that streams an empty completion (quota exhausted, or the
        // spurious "invalid_input" a degraded account returns) yields silence
        // rather than an error. Checking here turns that into a failover.
        const raw = await res.text();
        let messageId: string | null = null;
        let echoed = "";
        let upstreamError = "";
        for (const line of raw.split("\n")) {
          if (!line.startsWith("data:")) continue;
          try {
            const evt = JSON.parse(line.slice(5).trim());
            if (!messageId && evt?.["response.created"]?.response_id) messageId = evt["response.created"].response_id;
            const delta = evt?.choices?.[0]?.delta;
            if (delta?.phase === "answer" && typeof delta.content === "string") echoed += delta.content;
            const e = evt?.error ?? delta?.error;
            if (e && !upstreamError) upstreamError = [e.code, e.details].filter(Boolean).join(": ") || String(e);
          } catch {
            /* skip */
          }
        }
        if (!messageId) throw new QwenError("Could not prepare text for speech.");
        if (!echoed.trim()) {
          throw new QwenError(upstreamError || "The speech helper generated no text.", 502, true);
        }

        const pcm = await synthesize(token, chatId, messageId);
        await Promise.all([deleteChat(token, chatId), forgetAllMemories(token)]);
        return pcmToWav(pcm);
      } catch (e) {
        await deleteChat(token, chatId);
        throw e;
      }
    });
    wav = result;
  } catch (e: any) {
    const status = e instanceof QwenError ? e.status : 502;
    logUsage(record.id, "tts", false, false, status);
    return err(e.message || "Speech generation failed", status, status === 400 ? "voice_not_found" : "upstream_error");
  }
  logUsage(record.id, "tts", false, false, 200);

  return new Response(new Uint8Array(wav), {
    headers: {
      "Content-Type": "audio/wav",
      "Content-Length": String(wav.length),
      "Cache-Control": "no-store",
    },
  });
}

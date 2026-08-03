// Qwen text-to-speech ("read aloud").
//
// Reverse-engineered flow:
//   1. GET  /api/v2/tts/config            -> available voices (speakers)
//   2. POST /api/v2/users/user/settings/update {tts_speaker_v2:{speaker}}
//        -> the voice is an ACCOUNT-LEVEL setting; there is no per-request voice
//           parameter (passing one in the TTS body is ignored).
//   3. Qwen can only read aloud a message that exists in a chat, so we first make
//      the model emit the text, then:
//   4. POST /api/v2/tts/completions?chat_id=X
//        {chat_id, timestamp, messages:[{id, role:"assistant", sub_chat_type:"tts"}]}
//      -> SSE whose deltas carry base64 PCM in `delta.tts`.
//   5. The PCM is 16-bit mono @ 24 kHz; we wrap it in a WAV header.

import { QWEN_BASE, qwenHeaders, QwenError } from "./qwen";
import { qwenFetch } from "./proxy";

// Qwen's TTS PCM is 24 kHz mono 16-bit — every audio player class in their
// frontend defaults to sampleRate 24e3. (Do not confuse this with the 16 kHz in
// their SpeechTranscriber payload: that is microphone input for speech-to-text.
// Declaring 16 kHz here plays the audio 1.5x too slow and drops the pitch.)
export const TTS_SAMPLE_RATE = 24000;

export interface Voice {
  speaker: string;
  name: string;
  gender: string;
  description: string;
  kind: "audio" | "omni";
}

let voiceCache: { voices: Voice[]; at: number } | null = null;
const VOICE_TTL = 10 * 60_000;

export async function getVoices(token: string): Promise<Voice[]> {
  if (voiceCache && Date.now() - voiceCache.at < VOICE_TTL) return voiceCache.voices;
  const url =
    `${QWEN_BASE}/api/v2/tts/config?omni_speakers=v1&audio_tts_speakers=v1&omni_language=v1&audio_tts_language=v1`;
  const res = await qwenFetch(url, { headers: qwenHeaders(token, { "Accept-Language": "en-US,en;q=0.9" }) });
  const j: any = await res.json().catch(() => ({}));
  const d = j?.data || {};
  const map = (arr: any[], kind: "audio" | "omni"): Voice[] =>
    (Array.isArray(arr) ? arr : []).map((v) => ({
      speaker: v.speaker,
      name: v.spk_name || v.speaker,
      gender: v.gender || "",
      description: v.description || "",
      kind,
    }));
  const seen = new Set<string>();
  const voices = [...map(d.audio_tts_speakers, "audio"), ...map(d.omni_speakers, "omni")].filter((v) => {
    if (!v.speaker || seen.has(v.speaker)) return false;
    seen.add(v.speaker);
    return true;
  });
  if (voices.length) voiceCache = { voices, at: Date.now() };
  return voices;
}

// Set the account's TTS voice. NOTE: this is a global setting on the Qwen
// account, so concurrent requests using the same pooled token can race.
export async function setVoice(token: string, speaker: string): Promise<void> {
  await qwenFetch(`${QWEN_BASE}/api/v2/users/user/settings/update`, {
    method: "POST",
    headers: qwenHeaders(token),
    body: JSON.stringify({ tts_speaker_v2: { speaker } }),
  });
}

// Read a chat message aloud. Returns raw 16-bit mono PCM @16kHz.
export async function synthesize(token: string, chatId: string, messageId: string): Promise<Buffer> {
  const res = await qwenFetch(`${QWEN_BASE}/api/v2/tts/completions?chat_id=${encodeURIComponent(chatId)}`, {
    method: "POST",
    headers: qwenHeaders(token, { Accept: "*/*" }),
    body: JSON.stringify({
      chat_id: chatId,
      timestamp: Math.floor(Date.now() / 1000),
      messages: [{ id: messageId, role: "assistant", sub_chat_type: "tts" }],
    }),
  });
  if (!res.ok) throw new QwenError(`TTS failed (${res.status})`);
  const text = await res.text();
  let b64 = "";
  for (const line of text.split("\n")) {
    if (!line.startsWith("data:")) continue;
    try {
      const evt = JSON.parse(line.slice(5).trim());
      const chunk = evt?.choices?.[0]?.delta?.tts;
      if (typeof chunk === "string" && chunk) b64 += chunk;
    } catch {
      /* skip */
    }
  }
  if (!b64) throw new QwenError("TTS returned no audio.");
  return Buffer.from(b64, "base64");
}

// Wrap raw 16-bit mono PCM in a WAV container so browsers can play it.
export function pcmToWav(pcm: Buffer, sampleRate = TTS_SAMPLE_RATE, channels = 1): Buffer {
  const bitsPerSample = 16;
  const byteRate = (sampleRate * channels * bitsPerSample) / 8;
  const blockAlign = (channels * bitsPerSample) / 8;
  const header = Buffer.alloc(44);
  header.write("RIFF", 0);
  header.writeUInt32LE(36 + pcm.length, 4);
  header.write("WAVE", 8);
  header.write("fmt ", 12);
  header.writeUInt32LE(16, 16); // PCM chunk size
  header.writeUInt16LE(1, 20); // format = PCM
  header.writeUInt16LE(channels, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(byteRate, 28);
  header.writeUInt16LE(blockAlign, 32);
  header.writeUInt16LE(bitsPerSample, 34);
  header.write("data", 36);
  header.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([header, pcm]);
}

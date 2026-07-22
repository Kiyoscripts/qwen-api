// Image and video generation exposed as their own selectable models, so callers
// pick e.g. `qwen-image-3.0` or `qwen-vlo` instead of switching to a chat model.
//
// Under the hood these all ride the same completions endpoint on a chat model
// (BACKEND_MODEL) with a specific chat_type; the image-model *version*
// (qwen-image-2.0-pro / 3.0-pro) is passed in message.extra.meta.model, and an
// attached reference image switches t2i -> image_edit.

import {
  buildMessage,
  createChat,
  deleteChat,
  extractWanxTaskId,
  forgetAllMemories,
  openCompletion,
  qwenDeltas,
  uploadImages,
  QwenError,
} from "./qwen";

// A chat model that drives the t2i / image_edit / t2v backends.
export const MEDIA_BACKEND_MODEL = process.env.QWEN_MEDIA_MODEL || "qwen3-max-2026-01-23";

// Video generation is off by default. Flip ENABLE_VIDEO_GENERATION=true to bring
// back the `qwen-vlo` model and the /v1/videos/* endpoints.
export const VIDEO_ENABLED = /^(1|true|yes)$/i.test(process.env.ENABLE_VIDEO_GENERATION || "");

export interface VirtualModel {
  id: string;
  name: string;
  kind: "image" | "video";
  imageModelId?: string; // image kinds only
}

export const VIRTUAL_MODELS: VirtualModel[] = [
  { id: "qwen-image-3.0", name: "Qwen Image 3.0", kind: "image", imageModelId: "qwen-image-3.0-pro" },
  { id: "qwen-image-2.0", name: "Qwen Image 2.0", kind: "image", imageModelId: "qwen-image-2.0-pro" },
  ...(VIDEO_ENABLED ? [{ id: "qwen-vlo", name: "Qwen VLo (video)", kind: "video" as const }] : []),
];

export function virtualModel(id: string): VirtualModel | undefined {
  return VIRTUAL_MODELS.find((m) => m.id === id);
}

// Map an OpenAI-style size to a Qwen aspect ratio; pass ratios through.
export function toRatio(size?: string): string {
  if (!size) return "1:1";
  if (/^\d+:\d+$/.test(size)) return size;
  const map: Record<string, string> = {
    "1024x1024": "1:1",
    "1792x1024": "16:9",
    "1024x1792": "9:16",
    "1152x896": "4:3",
    "896x1152": "3:4",
  };
  return map[size] || "1:1";
}

// Generate (or, with reference images, edit) an image. Returns the result URL.
export async function generateImage(
  token: string,
  opts: { prompt: string; images?: string[]; imageModelId?: string; size?: string }
): Promise<string> {
  const edit = (opts.images?.length ?? 0) > 0;
  const chatType = edit ? "image_edit" : "t2i";
  const files = edit ? await uploadImages(token, opts.images!) : [];
  const size = toRatio(opts.size);

  let chatId: string | undefined;
  try {
    chatId = await createChat(token, MEDIA_BACKEND_MODEL, chatType);
    const messages = [
      buildMessage([{ role: "user", content: opts.prompt }], {
        model: MEDIA_BACKEND_MODEL,
        chatType,
        files,
        thinking: false,
        size,
        imageModelId: opts.imageModelId,
      }),
    ];
    const res = await openCompletion(token, chatId, { model: MEDIA_BACKEND_MODEL, messages, stream: true, size });
    let content = "";
    for await (const { text } of qwenDeltas(res)) content += text;
    const m = content.match(/https?:\/\/[^"\\\s]+/);
    if (!m) throw new QwenError("No image URL returned.");
    await Promise.all([deleteChat(token, chatId), forgetAllMemories(token)]);
    return m[0];
  } catch (e) {
    await deleteChat(token, chatId);
    throw e;
  }
}

// Kick off a video generation. Returns the chat id + WanX task id to poll.
export async function startVideo(token: string, prompt: string): Promise<{ chatId: string; taskId: string }> {
  let chatId: string | undefined;
  try {
    chatId = await createChat(token, MEDIA_BACKEND_MODEL, "t2v");
    const messages = [buildMessage([{ role: "user", content: prompt }], { model: MEDIA_BACKEND_MODEL, chatType: "t2v", thinking: false })];
    // Video is async: the non-stream request returns a task id.
    const res = await openCompletion(token, chatId, { model: MEDIA_BACKEND_MODEL, messages, stream: false });
    const json = await res.json().catch(() => ({}));
    const taskId = extractWanxTaskId(json);
    if (!taskId) throw new QwenError(`No video task returned: ${JSON.stringify(json).slice(0, 200)}`);
    return { chatId, taskId };
  } catch (e) {
    await deleteChat(token, chatId);
    throw e;
  }
}

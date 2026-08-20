import { NextRequest, NextResponse } from "next/server";
import { getModels } from "@/lib/qwen";
import { ONECOMPILER_MODELS } from "@/lib/onecompiler";
import { TOKENROUTER_MODELS, tokenRouterConfigured } from "@/lib/tokenrouter";
import { OPENCODE_ZEN_MODELS, openCodeZenConfigured } from "@/lib/opencodezen";
import { SOLAR_MODELS, solarConfigured } from "@/lib/solar";
import { NVIDIA_MODELS, nvidiaConfigured } from "@/lib/nvidia";
import { chatglmModels } from "@/lib/chatglm";
import { VIRTUAL_MODELS } from "@/lib/media";
import { CUSTOM_MODELS } from "@/lib/customModels";
import { withTokenFailover } from "@/lib/tokens";
import { authenticate } from "@/lib/apiAuth";
import { getSetting } from "@/lib/settings";
import { listCustomModels } from "@/lib/customProviders";

export const runtime = "nodejs";

// Image/video generation models (always available; served via the Qwen pool).
const mediaEntries = VIRTUAL_MODELS.map((m) => ({
  id: m.id,
  object: "model" as const,
  created: 0,
  owned_by: "qwen",
  display_name: m.name,
  capabilities: {
    vision: m.kind === "image", // image models accept a reference image (editing)
    thinking: false,
    chat_types: m.kind === "image" ? ["t2i", "image_edit"] : ["t2v"],
    // Both kinds take a reference image: the image models for editing, the
    // video model for image-to-video. Leaving this out made clients read
    // `vision: false` as "no files", which disabled attachment on the very
    // model that needs one to do image-to-video.
    input: { text: true, image: true, document: false, video: false, audio: false },
  },
}));

// Custom slugs (persona + system prompt over a real Qwen model).
const customEntries = CUSTOM_MODELS.map((m) => ({
  id: m.id,
  object: "model" as const,
  created: 0,
  owned_by: "qwen",
  display_name: m.name,
  description: m.description,
  capabilities: { vision: true, thinking: true, chat_types: ["t2t"] },
}));

// OneCompiler free-tier models. Its "Premium" models are not in the registry and
// so are never advertised here.
const oneCompilerEntries = ONECOMPILER_MODELS.map((m) => ({
  id: m.id,
  object: "model" as const,
  created: 0,
  owned_by: "onecompiler",
  display_name: m.name,
  capabilities: { vision: false, thinking: false, chat_types: ["t2t"], input: { text: true, image: false, document: false, video: false, audio: false } },
}));

// TokenRouter's free tier. Advertised only when a key is configured, so an
// unconfigured deploy does not offer a model that cannot answer.
const tokenRouterEntries = tokenRouterConfigured()
  ? TOKENROUTER_MODELS.map((m) => ({
      id: m.id,
      object: "model" as const,
      created: 0,
      owned_by: "tokenrouter",
      display_name: m.name,
      capabilities: {
        vision: false,
        thinking: Boolean(m.reasoningEffort?.length),
        chat_types: ["t2t"],
        input: { text: true, image: false, document: false, video: false, audio: false },
        ...(m.reasoningEffort?.length ? { reasoning_effort: [...m.reasoningEffort] } : {}),
      },
    }))
  : [];

// OpenCode Zen free / stealth models (Big Pickle etc.). Same configuration gate.
const openCodeZenEntries = openCodeZenConfigured()
  ? OPENCODE_ZEN_MODELS.map((m) => ({
      id: m.id,
      object: "model" as const,
      created: 0,
      owned_by: "opencode",
      display_name: m.name,
      capabilities: {
        vision: false,
        thinking: Boolean(m.thinking || m.reasoningEffort?.length),
        chat_types: ["t2t"],
        input: { text: true, image: false, document: false, video: false, audio: false },
        ...(m.contextLength ? { context_length: m.contextLength } : {}),
        ...(m.reasoningEffort?.length ? { reasoning_effort: [...m.reasoningEffort] } : {}),
      },
    }))
  : [];
// Upstage's Solar Chat. Public rather than key-gated, so the flag is a kill
// switch; text-only, because the upstream refuses image input outright.
const solarEntries = solarConfigured()
  ? SOLAR_MODELS.map((m) => ({
      id: m.id,
      object: "model" as const,
      created: 0,
      owned_by: "upstage",
      display_name: m.name,
      capabilities: {
        vision: false,
        thinking: Boolean(m.thinking),
        chat_types: ["t2t"],
        input: { text: true, image: false, document: false, video: false, audio: false },
        ...(m.contextLength ? { context_length: m.contextLength } : {}),
        ...(m.reasoningEffort?.length ? { reasoning_effort: [...m.reasoningEffort] } : {}),
      },
    }))
  : [];

// chatglm.cn. The text model carries the Fast/Standard/Deep ladder and accepts
// images; the image models are t2i, one of which also takes a reference image.
const chatglmEntries = chatglmModels().map((m) => ({
      id: m.id,
      object: "model" as const,
      created: 0,
      owned_by: "z-ai",
      display_name: m.name,
      capabilities: {
        vision: Boolean(m.vision),
        thinking: Boolean(m.thinking),
        chat_types: m.kind === "image" ? ["t2i", ...(m.vision ? ["image_edit"] : [])] : ["t2t"],
        input: { text: true, image: Boolean(m.vision), document: false, video: false, audio: false },
        ...(m.contextLength ? { context_length: m.contextLength } : {}),
        ...(m.reasoningEffort?.length ? { reasoning_effort: [...m.reasoningEffort] } : {}),
      },
    }));

// NVIDIA NIM. Reasoning is a two-state switch (enable_thinking) rather than an
// effort ladder, so no reasoning_effort list is advertised for these.
const nvidiaEntries = nvidiaConfigured()
  ? NVIDIA_MODELS.map((m) => ({
      id: m.id,
      object: "model" as const,
      created: 0,
      owned_by: "nvidia",
      display_name: m.name,
      capabilities: {
        vision: false,
        thinking: Boolean(m.thinking),
        chat_types: ["t2t"],
        input: { text: true, image: false, document: false, video: false, audio: false },
        ...(m.contextLength ? { context_length: m.contextLength } : {}),
      },
    }))
  : [];

export async function GET(req: NextRequest) {
  if (!(await authenticate(req))) {
    return NextResponse.json({ error: { message: "Invalid or missing API key.", type: "invalid_request_error" } }, { status: 401 });
  }
  try {
    // Advertise only models actually returned by the connected Qwen account.
    let qwenEntries: any[] = [];
    try {
      const { result: models } = await withTokenFailover((token) => getModels(token));
      const enabled = (await getSetting("models")).enabled;
      const visible = enabled.length ? models.filter((model) => enabled.includes(model.id)) : models;
      qwenEntries = visible.map((m) => ({
        id: m.id,
        object: "model",
        created: 0,
        owned_by: "qwen",
        // extra, non-standard hints:
        display_name: m.name,
        capabilities: {
          vision: m.vision,
          thinking: m.thinking,
          chat_types: m.chatTypes,
          // Which inputs the model accepts, as declared by upstream per model.
          input: {
            text: true,
            image: m.vision,
            document: m.document,
            video: m.video,
            audio: m.audio,
          },
          ...(m.contextLength ? { context_length: m.contextLength } : {}),
        },
      }));
    } catch {
      /* Qwen pool unavailable -> return an empty catalogue. */
    }
    const customEntries = (await listCustomModels()).map((m) => ({ id:m.id,object:"model",created:0,owned_by:m.provider_slug,display_name:m.provider_name,capabilities:{vision:false,thinking:false,chat_types:["t2t"],input:{text:true,image:false,document:false,video:false,audio:false}} }));
    return NextResponse.json({ object: "list", data: [...qwenEntries,...customEntries] });
  } catch (e: any) {
    return NextResponse.json({ error: { message: e.message, type: "upstream_error" } }, { status: 503 });
  }
}

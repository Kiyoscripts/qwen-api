import { NextRequest, NextResponse } from "next/server";
import { getModels } from "@/lib/qwen";
import { ONECOMPILER_MODELS } from "@/lib/onecompiler";
import { G4F_MODELS } from "@/lib/g4f";
import { VIRTUAL_MODELS } from "@/lib/media";
import { CUSTOM_MODELS } from "@/lib/customModels";
import { withTokenFailover } from "@/lib/tokens";
import { authenticate } from "@/lib/apiAuth";

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
  capabilities: { vision: false, thinking: false, chat_types: ["t2t"] },
}));

// g4f.dev models, served anonymously over g4f.space. Only routes verified
// answering are in the registry, so everything listed here is callable.
//
// The warning rides on every entry rather than living only on the /models page:
// most callers read this endpoint and never see the site, and an id like
// `gpt-oss:120b` is a claim by an unaccountable third party about what answers —
// not something we can verify.
const G4F_WARNING =
  "WARNING: This is proxied off some unknown site, models MAY be fake, not recommended for day-to-day use.";

const g4fEntries = G4F_MODELS.map((m) => ({
  id: m.id,
  object: "model" as const,
  created: 0,
  owned_by: "g4f",
  display_name: m.name,
  description: G4F_WARNING,
  capabilities: { vision: false, thinking: true, chat_types: ["t2t"] },
}));

export async function GET(req: NextRequest) {
  if (!(await authenticate(req))) {
    return NextResponse.json({ error: { message: "Invalid or missing API key.", type: "invalid_request_error" } }, { status: 401 });
  }
  try {
    // The static entries are always available; Qwen models depend on the account pool.
    let qwenEntries: any[] = [];
    try {
      const { result: models } = await withTokenFailover((token) => getModels(token));
      qwenEntries = models.map((m) => ({
        id: m.id,
        object: "model",
        created: 0,
        owned_by: "qwen",
        // extra, non-standard hints:
        display_name: m.name,
        capabilities: { vision: m.vision, thinking: m.thinking, chat_types: m.chatTypes },
      }));
    } catch {
      /* Qwen pool unavailable -> still return the static entries */
    }
    return NextResponse.json({ object: "list", data: [...customEntries, ...mediaEntries, ...oneCompilerEntries, ...g4fEntries, ...qwenEntries] });
  } catch (e: any) {
    return NextResponse.json({ error: { message: e.message, type: "upstream_error" } }, { status: 503 });
  }
}

// Custom model slugs: a public model id that maps onto a real Qwen model plus a
// system prompt (a persona / house style) kept in its own editable file.
//
// The prompt lives in `prompts/<file>` as plain markdown — edit it there, no code
// changes required. It's PREPENDED as a system message, so a caller's own system
// prompt still applies on top of it rather than being thrown away.
//
// To add a new slug:
//   1. Drop a markdown file in `prompts/`.
//   2. Add an entry below pointing at it.
//   3. Add the file to `outputFileTracingIncludes` in next.config.mjs (the
//      `prompts/**` glob already covers it).
// It then shows up in /v1/models and works on /v1/chat/completions automatically.

import { readFileSync } from "node:fs";
import { join } from "node:path";

export interface CustomModel {
  id: string; // slug callers request
  name: string; // display name
  baseModel: string; // real Qwen model that actually runs
  description: string;
  promptFile: string; // file under prompts/
}

// No custom slugs. (The mechanism stays wired but empty, so nothing is injected.)
export const CUSTOM_MODELS: CustomModel[] = [];

export function customModel(id: string): CustomModel | undefined {
  return CUSTOM_MODELS.find((m) => m.id === id);
}

// Cache parsed prompts in production; re-read every time in dev so editing the
// markdown takes effect immediately without a restart.
const cache = new Map<string, string>();
const CACHE_PROMPTS = process.env.NODE_ENV === "production";

// Read a slug's system prompt. HTML comments are stripped so you can leave editing
// notes in the file without sending them to the model.
export function systemPromptFor(model: CustomModel): string {
  if (CACHE_PROMPTS) {
    const hit = cache.get(model.promptFile);
    if (hit !== undefined) return hit;
  }
  let text = "";
  try {
    text = readFileSync(join(process.cwd(), "prompts", model.promptFile), "utf8");
  } catch {
    // Missing/unreadable prompt file: fall back to the plain base model rather
    // than failing the request.
    text = "";
  }
  const cleaned = text.replace(/<!--[\s\S]*?-->/g, "").trim();
  if (CACHE_PROMPTS) cache.set(model.promptFile, cleaned);
  return cleaned;
}

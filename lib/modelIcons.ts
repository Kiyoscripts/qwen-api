// Brand marks for model ids, as paths under /public.
//
// Deliberately free of imports: this is pulled into the chat UI (a client
// component) as well as server code, and anything it required would be dragged
// into the browser bundle with it.
//
// Keyed on the maker prefix of a namespaced id ("openai/gpt-5.4-mini"), so
// adding another model from a maker already listed needs no icon work. Where a
// maker is represented here by one product, the more recognisable mark wins —
// Gemini for Google, Kimi for Moonshot, Grok for xAI.
//
// openai.svg and grok.svg are monochrome marks pinned to white inside the file:
// they are rendered through <img>, which cannot inherit the page's currentColor.
/** Fallback for bare (non-namespaced) Qwen ids like `qwen3.8-max`. */
export const DEFAULT_MODEL_ICON = "/qwen.svg";

export const MAKER_ICONS: Record<string, string> = {
  openai: "/openai.svg",
  google: "/gemini.svg",
  deepseek: "/deepseek.svg",
  moonshotai: "/kimi.svg",
  qwen: "/qwen.svg",
  xai: "/grok.svg",
  nvidia: "/nvidia.svg",
  cohere: "/cohere.svg",
  // OpenCode Zen free/stealth models without a dedicated brand mark.
  opencode: "/opencode.svg",
};

export function modelIcon(id: string | undefined | null): string {
  if (!id) return DEFAULT_MODEL_ICON;
  const slash = id.indexOf("/");
  if (slash <= 0) return DEFAULT_MODEL_ICON;
  return MAKER_ICONS[id.slice(0, slash)] ?? DEFAULT_MODEL_ICON;
}

// --- makers -----------------------------------------------------------------
//
// The company that built the model, which is not the same thing as the pool it
// is served from: Grok and Kimi both arrive through OneCompiler, but a reader
// browsing the catalogue is looking for xAI and Moonshot. Derived from the same
// maker prefix the icons use, so the two never disagree.

export const MAKER_LABELS: Record<string, string> = {
  openai: "OpenAI",
  google: "Google",
  deepseek: "DeepSeek",
  moonshotai: "Moonshot AI",
  qwen: "Qwen",
  xai: "xAI",
  nvidia: "NVIDIA",
  cohere: "Cohere",
  opencode: "OpenCode Zen",
};

export interface Maker {
  /** Stable key for filtering and React keys. */
  key: string;
  label: string;
  icon: string;
}

/**
 * The maker of a model. `owner` distinguishes the one case the id cannot:
 * custom persona slugs are bare names with no prefix, so they would otherwise
 * fall through to Qwen.
 */
export function modelMaker(id: string, owner?: string): Maker {
  if (owner === "custom") return { key: "custom", label: "Custom", icon: DEFAULT_MODEL_ICON };
  const slash = id.indexOf("/");
  const prefix = slash > 0 ? id.slice(0, slash) : "qwen";
  return {
    key: prefix,
    label: MAKER_LABELS[prefix] ?? prefix,
    icon: MAKER_ICONS[prefix] ?? DEFAULT_MODEL_ICON,
  };
}

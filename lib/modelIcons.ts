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
export const MAKER_ICONS: Record<string, string> = {
  openai: "/openai.svg",
  google: "/gemini.svg",
  deepseek: "/deepseek.svg",
  moonshotai: "/kimi.svg",
  qwen: "/qwen.svg",
  xai: "/grok.svg",
};

/**
 * Bare ids, matched on their leading segment.
 *
 * Not every provider namespaces: the crax registry ships ids like `gpt-5-6-sol`
 * and `claude-opus-5` verbatim. Without these rules such ids fall to the default
 * below and every one of them renders as Qwen — which is not a cosmetic slip but
 * a false claim about who made the model.
 *
 * Order matters: the list is scanned in sequence, so a longer prefix must precede
 * any shorter one it starts with.
 */
const BARE_PREFIX_ICONS: Array<[string, string]> = [
  ["gpt-", "/openai.svg"],
  // Fable is Anthropic's, so it wears the Claude mark.
  ["claude-", "/claude.svg"],
  ["fable-", "/claude.svg"],
  ["gemini-", "/gemini.svg"],
  ["gemma", "/gemini.svg"],
  ["deepseek", "/deepseek.svg"],
  ["kimi", "/kimi.svg"],
  ["glm-", "/zai.svg"],
  ["llama-", "/meta.svg"],
  ["grok", "/grok.svg"],
  ["qwen", "/qwen.svg"],
];

/**
 * Fallback for bare Qwen ids like `qwen3.8-max-preview`.
 *
 * Qwen is this proxy's primary backend, so an unrecognised bare id is far more
 * likely to be one of its models than anything else.
 */
export const DEFAULT_MODEL_ICON = "/qwen.svg";

export function modelIcon(id: string | undefined | null): string {
  if (!id) return DEFAULT_MODEL_ICON;
  const slash = id.indexOf("/");
  if (slash > 0) return MAKER_ICONS[id.slice(0, slash)] ?? DEFAULT_MODEL_ICON;
  const lower = id.toLowerCase();
  for (const [prefix, icon] of BARE_PREFIX_ICONS) {
    if (lower.startsWith(prefix)) return icon;
  }
  return DEFAULT_MODEL_ICON;
}

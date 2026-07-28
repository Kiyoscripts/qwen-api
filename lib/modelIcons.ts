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

/** Fallback for bare (non-namespaced) Qwen ids like `qwen3.8-max-preview`. */
export const DEFAULT_MODEL_ICON = "/qwen.svg";

export function modelIcon(id: string | undefined | null): string {
  if (!id) return DEFAULT_MODEL_ICON;
  const slash = id.indexOf("/");
  if (slash <= 0) return DEFAULT_MODEL_ICON;
  return MAKER_ICONS[id.slice(0, slash)] ?? DEFAULT_MODEL_ICON;
}

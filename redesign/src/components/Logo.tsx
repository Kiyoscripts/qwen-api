/* ============================================================================
   Brand marks, from the AI-SVGS pack.

   The pack ships every file as fill="currentColor" with height="1em" and
   width="1em", which is deliberate: the mark inherits the surrounding text
   colour and scales with font-size. That is exactly what this design needs,
   since the whole page is one ink colour that flips with the theme.

   Two things follow from it:

     - Inlined, not <img>. An <img> cannot inherit currentColor, so every mark
       would render black and the dark theme would lose them. Vite's ?raw gives
       us the source at build time, no extra request and no SVGR plugin.

     - The intrinsic width/height are stripped here. The pack's own guidance is
       to set both dimensions or neither: leaving width="1em" on a lockup whose
       viewBox is 86x24 letterboxes the artwork into a square and renders it
       tiny. Removing both lets the CSS height plus w-auto do the work.
   ========================================================================== */

import qwenMono from "../assets/logos/qwen-mono.svg?raw";
import qwenLockup from "../assets/logos/qwen-lockup.svg?raw";
import kimiMono from "../assets/logos/kimi-mono.svg?raw";
import kimiLockup from "../assets/logos/kimi-lockup.svg?raw";
import deepseekMono from "../assets/logos/deepseek-mono.svg?raw";
import deepseekLockup from "../assets/logos/deepseek-lockup.svg?raw";
import openaiMono from "../assets/logos/openai-mono.svg?raw";
import openaiLockup from "../assets/logos/openai-lockup.svg?raw";
import grokMono from "../assets/logos/grok-mono.svg?raw";
import grokLockup from "../assets/logos/grok-lockup.svg?raw";
import googleMono from "../assets/logos/google-mono.svg?raw";
import googleLockup from "../assets/logos/google-lockup.svg?raw";

/** Keyed by the `owned_by` value the API reports, so a model resolves directly. */
export const LOGOS: Record<string, { name: string; mono: string; lockup: string }> = {
  qwen: { name: "Qwen", mono: qwenMono, lockup: qwenLockup },
  moonshotai: { name: "Kimi", mono: kimiMono, lockup: kimiLockup },
  deepseek: { name: "DeepSeek", mono: deepseekMono, lockup: deepseekLockup },
  openai: { name: "OpenAI", mono: openaiMono, lockup: openaiLockup },
  xai: { name: "Grok", mono: grokMono, lockup: grokLockup },
  google: { name: "Google", mono: googleMono, lockup: googleLockup },
};

const stripSize = (svg: string) =>
  svg.replace(/\s(width|height)="[^"]*"/g, "").replace(/<title>.*?<\/title>/, "");

/**
 * One mark.
 *
 * `variant="mark"` is the square glyph for inline use beside text. `"lockup"`
 * adds the wordmark, which is what a logo wall wants: the point of the wall is
 * reading whose models these are.
 */
export function Logo({
  maker,
  variant = "mark",
  className = "h-5",
}: {
  maker: string;
  variant?: "mark" | "lockup";
  className?: string;
}) {
  const entry = LOGOS[maker];
  if (!entry) return null;
  const svg = stripSize(variant === "lockup" ? entry.lockup : entry.mono);

  return (
    <span
      role="img"
      aria-label={entry.name}
      className={`inline-flex shrink-0 items-center [&>svg]:h-full [&>svg]:w-auto ${className}`}
      dangerouslySetInnerHTML={{ __html: svg }}
    />
  );
}

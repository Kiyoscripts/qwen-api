import { Logo, LOGOS } from "../components/Logo";

/**
 * Whose models are on the endpoint.
 *
 * Lockups rather than bare marks: the job of this row is to be read, and a
 * grid of unlabelled glyphs makes the visitor work out which company each one
 * is. Every file inherits currentColor, so the row follows the theme with no
 * second asset and no filter hack.
 */
const ORDER = ["qwen", "moonshotai", "openai", "deepseek", "xai", "google"];

export function Makers() {
  return (
    <section className="border-b border-rule bg-[var(--paper-2)]">
      <div className="field">
        <div className="flex flex-wrap items-center justify-center gap-x-12 gap-y-8 py-11 lg:justify-between">
          {ORDER.filter((k) => LOGOS[k]).map((maker) => (
            <Logo
              key={maker}
              maker={maker}
              variant="lockup"
              className="h-[22px] text-ink-3 transition-colors duration-300 hover:text-ink"
            />
          ))}
        </div>
      </div>
    </section>
  );
}

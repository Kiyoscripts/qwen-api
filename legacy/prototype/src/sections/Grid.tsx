import { Images, Wrench, Waveform, ShieldCheck, Translate } from "@phosphor-icons/react";
import { Reveal } from "../components/Reveal";

/**
 * Five capabilities, five cells, no filler tile.
 *
 * The first cell is wide and carries a tinted fill, two carry a printed rule
 * pattern, and two are plain. That variation is what keeps a grid from reading
 * as six identical boxes, and it maps to how much each capability matters.
 */
const CELLS = [
  {
    icon: Images,
    title: "Image, video, audio in",
    body: "Send a file with the message. The flagship reads all four input kinds; every model states which it takes.",
    span: "md:col-span-3",
    fill: "signal" as const,
  },
  {
    icon: Wrench,
    title: "Tool calling",
    body: "OpenAI function schemas in, tool_calls out, on every model including the ones with no native support.",
    span: "md:col-span-3",
    fill: "rules" as const,
  },
  {
    icon: Waveform,
    title: "Speech and images out",
    body: "Generate images and video, or read a reply aloud, from the same key.",
    span: "md:col-span-2",
    fill: "plain" as const,
  },
  {
    icon: ShieldCheck,
    title: "Keys you control",
    body: "Hashed at rest, shown once, revocable. Usage is visible per key.",
    span: "md:col-span-2",
    fill: "rules" as const,
  },
  {
    icon: Translate,
    title: "Twelve languages",
    body: "The console and docs ship translated, not machine-swapped at runtime.",
    span: "md:col-span-2",
    fill: "plain" as const,
  },
];

const RULE_PATTERN =
  "repeating-linear-gradient(135deg, var(--rule) 0 1px, transparent 1px 9px)";

export function Grid() {
  return (
    <section className="border-b border-rule py-20 md:py-28">
      <div className="field">
        <Reveal>
          <h2 className="h2 max-w-[18ch] text-ink">More than text in, text out.</h2>
        </Reveal>

        <div className="mt-10 grid gap-4 md:grid-cols-6">
          {CELLS.map((cell, i) => {
            const Icon = cell.icon;
            return (
              <Reveal key={cell.title} delay={0.05 * i} className={cell.span}>
                <article
                  className="group relative h-full overflow-hidden border border-rule p-6
                             transition-colors duration-300 hover:border-ink"
                  style={{
                    borderRadius: "var(--r-sm)",
                    background:
                      cell.fill === "signal" ? "var(--signal-wash)" : "var(--paper)",
                  }}
                >
                  {cell.fill === "rules" && (
                    <div
                      aria-hidden
                      className="pointer-events-none absolute -top-8 -right-8 size-36 opacity-70"
                      style={{ background: RULE_PATTERN }}
                    />
                  )}
                  <div className="relative">
                    <Icon
                      size={20}
                      weight="regular"
                      className={cell.fill === "signal" ? "text-signal" : "text-ink-2"}
                    />
                    <h3 className="h3 mt-4 text-ink">{cell.title}</h3>
                    <p className="body mt-2 text-[13.5px]">{cell.body}</p>
                  </div>
                </article>
              </Reveal>
            );
          })}
        </div>
      </div>
    </section>
  );
}

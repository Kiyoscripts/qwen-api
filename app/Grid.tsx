import { Images, Wrench, Waveform, ShieldCheck, Translate } from "@phosphor-icons/react/dist/ssr";
import { getT } from "@/lib/i18nServer";
import { Reveal } from "./Reveal";

/**
 * Five capabilities, five cells, no filler tile. One cell carries a tinted
 * fill, two carry a printed rule pattern, two are plain: that variation is what
 * keeps a grid from reading as six identical boxes.
 */
const RULE_PATTERN = "repeating-linear-gradient(135deg, var(--rule) 0 1px, transparent 1px 9px)";

export async function Grid() {
  const t = await getT();
  const cells = [
    { Icon: Images, title: t("grid_media_t"), body: t("grid_media_b"), span: "md:col-span-3", fill: "signal" },
    { Icon: Wrench, title: t("grid_tools_t"), body: t("grid_tools_b"), span: "md:col-span-3", fill: "rules" },
    { Icon: Waveform, title: t("grid_out_t"), body: t("grid_out_b"), span: "md:col-span-2", fill: "plain" },
    { Icon: ShieldCheck, title: t("grid_keys_t"), body: t("grid_keys_b"), span: "md:col-span-2", fill: "rules" },
    { Icon: Translate, title: t("grid_lang_t"), body: t("grid_lang_b"), span: "md:col-span-2", fill: "plain" },
  ] as const;

  return (
    <section className="border-b border-rule py-20 md:py-28">
      <div className="field">
        <Reveal><h2 className="h2 max-w-[18ch] text-ink">{t("grid_title")}</h2></Reveal>
        <div className="mt-10 grid gap-4 md:grid-cols-6">
          {cells.map((cell, i) => (
            <Reveal key={cell.title} delay={0.05 * i} className={cell.span}>
              <article
                className="group relative h-full overflow-hidden border border-rule p-6
                           transition-colors duration-300 hover:border-ink"
                style={{
                  borderRadius: "var(--r-sm)",
                  background: cell.fill === "signal" ? "var(--signal-wash)" : "var(--paper)",
                }}
              >
                {cell.fill === "rules" && (
                  <div aria-hidden className="pointer-events-none absolute -top-8 -right-8 size-36 opacity-70"
                       style={{ background: RULE_PATTERN }} />
                )}
                <div className="relative">
                  <cell.Icon size={20} className={cell.fill === "signal" ? "text-signal" : "text-ink-2"} />
                  <h3 className="h3 mt-4 text-ink">{cell.title}</h3>
                  <p className="body mt-2 text-[13.5px]">{cell.body}</p>
                </div>
              </article>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  );
}

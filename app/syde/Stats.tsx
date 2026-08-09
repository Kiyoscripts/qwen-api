import { getT } from "@/lib/i18nServer";
import { Reveal } from "./Reveal";
import { headers } from "next/headers";
import { CANONICAL_URL } from "@/lib/canonicalHost";

/**
 * Live numbers, from the same endpoint the old stats bar used.
 *
 * Figures are the content here, so they are set in mono at display size with
 * the label beneath, rather than dropped into cards. If the endpoint is down
 * the section is omitted entirely: a row of dashes is worse than no row.
 */
export async function Stats() {
  const t = await getT();
  let s: any = null;
  try {
    // Absolute URL, because a server component has no page origin to resolve
    // a relative one against.
    const h = await headers();
    const host = h.get("x-forwarded-host") || h.get("host");
    const proto = h.get("x-forwarded-proto") || "https";
    const origin = host ? `${proto}://${host}` : CANONICAL_URL;
    const r = await fetch(`${origin}/api/stats`, { next: { revalidate: 30 } });
    if (r.ok) s = await r.json();
  } catch {
    /* the section simply does not render */
  }
  if (!s) return null;

  const figures: [string, string][] = [
    [String(s.models ?? 0), t("stat_models_line")],
    [Number(s.poolAccounts ?? 0).toLocaleString(), t("stat_pool")],
    [Number(s.apiKeys ?? 0).toLocaleString(), t("stat_keys")],
    ["1M", t("stat_context")],
  ];

  return (
    <section className="border-b border-rule py-16 md:py-20">
      <div className="field">
        <Reveal>
          <dl className="grid gap-x-8 gap-y-10 sm:grid-cols-2 lg:grid-cols-4">
            {figures.map(([figure, label]) => (
              <div key={label} className="border-t border-rule pt-5">
                <dd className="num text-[2.4rem] leading-none font-medium text-ink">{figure}</dd>
                <dt className="mt-3 text-[13.5px] leading-snug text-ink-2">{label}</dt>
              </div>
            ))}
          </dl>
        </Reveal>
      </div>
    </section>
  );
}

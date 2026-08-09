import Link from "next/link";
import { getT } from "@/lib/i18nServer";
import { Reveal } from "./Reveal";
import { DISCORD_INVITE } from "@/lib/links";

export async function Footer() {
  const t = await getT();
  const columns = [
    { head: t("footer_product"), links: [["nav_models", "/models"], ["nav_playground", "/playground"], ["nav_chat", "/chat"], ["nav_docs", "/docs"]] },
    { head: t("footer_account"), links: [["nav_login", "/login"], ["footer_keys", "/keys"]] },
  ] as const;

  return (
    <>
      {/* Closing action. Split against a rule, unlike any earlier section. */}
      <section className="border-b border-rule py-20 md:py-24">
        <div className="field">
          <Reveal className="grid items-center gap-8 md:grid-cols-12">
            <h2 className="h2 text-ink md:col-span-7">{t("cta_title")}</h2>
            <div className="flex flex-wrap gap-3 md:col-span-5 md:justify-end">
              <Link href="/login" className="btn btn-primary">{t("cta_key")}</Link>
              <Link href="/docs" className="btn btn-ghost">{t("cta_docs")}</Link>
            </div>
          </Reveal>
        </div>
      </section>

      <footer className="py-14">
        <div className="field">
          <div className="grid gap-10 md:grid-cols-12">
            <div className="md:col-span-5">
              <p className="font-mono text-[13px] font-medium text-ink">syde</p>
              <p className="body mt-3 max-w-[34ch] text-[13.5px]">{t("footer_blurb")}</p>
            </div>
            {columns.map((col) => (
              <div key={col.head} className="md:col-span-3 lg:col-span-2">
                <p className="font-mono text-[11px] tracking-wide text-ink-3 uppercase">{col.head}</p>
                <ul className="mt-4 space-y-2.5">
                  {col.links.map(([key, href]) => (
                    <li key={href}>
                      <Link href={href} className="text-[13.5px] text-ink-2 transition-colors duration-200 hover:text-signal">
                        {t(key)}
                      </Link>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
          <div className="mt-12 flex flex-wrap items-center justify-between gap-3 border-t border-rule pt-6">
            <p className="font-mono text-[11.5px] text-ink-3">{t("footer_disclaimer")}</p>
            <a href={DISCORD_INVITE} target="_blank" rel="noreferrer"
               className="font-mono text-[11.5px] text-ink-2 transition-colors duration-200 hover:text-signal">
              {t("login_discord_server")}
            </a>
          </div>
        </div>
      </footer>
    </>
  );
}

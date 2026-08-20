"use client";

import Link from "next/link";
import { useT } from "./I18n";
import { Console } from "./Console";

/**
 * Asymmetric split: message left, working product right.
 *
 * The entry is CSS (see .rise in syde.css), so the hero is readable whether or
 * not the animation runs. It previously used Motion, which meant a stalled
 * animation left the headline and CTAs invisible.
 */
export function Hero() {
  const t = useT();
  return (
    <section className="relative border-b border-rule">
      <div className="field">
        <div className="grid items-center gap-12 pt-16 pb-20 lg:grid-cols-12 lg:gap-10 lg:pt-24 lg:pb-28">
          <div className="lg:col-span-6">
            <h1 className="display rise text-ink" style={{ ["--i" as string]: 0 }}>
              {t("hero_title_a")}
              <br />
              {t("hero_title_b")}
            </h1>
            <p className="lede rise mt-7" style={{ ["--i" as string]: 1 }}>{t("hero_sub")}</p>
            <div className="rise mt-9 flex flex-wrap items-center gap-3" style={{ ["--i" as string]: 2 }}>
              <Link href="/keys" className="btn btn-primary">{t("cta_key")}</Link>
              <Link href="/docs" className="btn btn-ghost">{t("cta_docs")}</Link>
            </div>
          </div>
          <div className="rise lg:col-span-6 lg:col-start-7 xl:col-span-5 xl:col-start-8"
               style={{ ["--i" as string]: 3 }}>
            <Console />
          </div>
        </div>
      </div>
    </section>
  );
}

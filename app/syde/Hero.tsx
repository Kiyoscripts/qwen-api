"use client";

import Link from "next/link";
import { motion, useReducedMotion } from "motion/react";
import { useT } from "../I18n";
import { Console } from "./Console";

/**
 * Asymmetric split: message left, working product right.
 *
 * Four text elements exactly, no eyebrow, so the hero stays one moment rather
 * than a feature list. Load-in order tells the eye where to start.
 */
export function Hero() {
  const t = useT();
  const reduce = useReducedMotion();
  const rise = (i: number) => ({
    initial: reduce ? false : { opacity: 0, y: 22 },
    animate: { opacity: 1, y: 0 },
    transition: { duration: 0.7, delay: 0.06 * i, ease: [0.16, 1, 0.3, 1] as const },
  });

  return (
    <section className="relative border-b border-rule">
      <div className="field">
        <div className="grid items-center gap-12 pt-16 pb-20 lg:grid-cols-12 lg:gap-10 lg:pt-24 lg:pb-28">
          <div className="lg:col-span-6">
            <motion.h1 {...rise(0)} className="display text-ink">
              {t("hero_title_a")}
              <br />
              {t("hero_title_b")}
            </motion.h1>
            <motion.p {...rise(1)} className="lede mt-7">{t("hero_sub")}</motion.p>
            <motion.div {...rise(2)} className="mt-9 flex flex-wrap items-center gap-3">
              <Link href="/login" className="btn btn-primary">{t("cta_key")}</Link>
              <Link href="/docs" className="btn btn-ghost">{t("cta_docs")}</Link>
            </motion.div>
          </div>
          <motion.div {...rise(3)} className="lg:col-span-6 lg:col-start-7 xl:col-span-5 xl:col-start-8">
            <Console />
          </motion.div>
        </div>
      </div>
    </section>
  );
}

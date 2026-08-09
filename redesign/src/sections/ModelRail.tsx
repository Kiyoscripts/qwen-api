import { useEffect, useState } from "react";
import { ArrowRight } from "@phosphor-icons/react";
import { listModels, type Model } from "../lib/api";
import { ModelCard } from "../components/ModelCard";
import { Reveal } from "../components/Reveal";
import { Link } from "../lib/router";

/**
 * The catalogue, as a rail rather than a grid.
 *
 * Breadth is the point here, not comparison: a visitor should feel how many
 * models are on one key and move on. Scroll-snap keeps that browsable without
 * spending a full screen on it, and the full grid lives on /models.
 */
export function ModelRail() {
  const [models, setModels] = useState<Model[] | null>(null);

  useEffect(() => {
    let live = true;
    listModels().then((m) => live && setModels(m.slice(0, 8)));
    return () => {
      live = false;
    };
  }, []);

  return (
    <section className="border-b border-rule py-20 md:py-28">
      <div className="field">
        <Reveal className="flex flex-wrap items-end justify-between gap-6">
          <h2 className="h2 max-w-[16ch] text-ink">Thirty-two models, one key.</h2>
          <Link
            to="/models"
            className="group inline-flex items-center gap-2 font-mono text-[13px] text-signal no-underline"
          >
            Full catalogue
            <ArrowRight
              size={14}
              weight="bold"
              className="transition-transform duration-300 group-hover:translate-x-1"
            />
          </Link>
        </Reveal>
      </div>

      <Reveal delay={0.08}>
        <div
          className="mt-10 flex snap-x snap-mandatory gap-4 overflow-x-auto px-6 pb-4 md:px-10
                     [scrollbar-width:thin]"
        >
          {models
            ? models.map((m) => (
                <div key={m.id} className="w-[268px] shrink-0 snap-start">
                  <ModelCard model={m} />
                </div>
              ))
            : /* Skeletons match the card's real shape, so nothing jumps when
                 the data lands. */
              Array.from({ length: 5 }).map((_, i) => (
                <div
                  key={i}
                  className="h-[188px] w-[268px] shrink-0 animate-pulse border border-rule bg-[var(--paper-2)]"
                  style={{ borderRadius: "var(--r-sm)" }}
                />
              ))}
        </div>
      </Reveal>
    </section>
  );
}

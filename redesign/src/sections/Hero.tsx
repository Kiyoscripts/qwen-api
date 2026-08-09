import { motion, useReducedMotion } from "motion/react";
import { Link } from "../lib/router";
import { Console } from "../components/Console";

/**
 * Asymmetric split: message left, working product right.
 *
 * Four text elements exactly (headline, subtext, two CTAs) and no eyebrow, so
 * the hero stays one moment rather than a feature list. Everything fits the
 * first viewport at desktop and at 375px.
 */
export function Hero() {
  const reduce = useReducedMotion();

  // Load-in order tells the eye where to start: name the thing, explain it,
  // offer the action, then reveal the proof.
  const rise = (i: number) => ({
    initial: reduce ? false : { opacity: 0, y: 22 },
    animate: { opacity: 1, y: 0 },
    transition: { duration: 0.7, delay: 0.06 * i, ease: [0.16, 1, 0.3, 1] as const },
  });

  return (
    <section className="relative border-b border-rule">
      <div className="field">
        <div className="grid items-center gap-12 pt-16 pb-20 lg:grid-cols-12 lg:gap-10 lg:pt-24 lg:pb-28">
          <div className="lg:col-span-6 xl:col-span-6">
            <motion.h1 {...rise(0)} className="display text-ink">
              Every model,
              <br />
              one endpoint.
            </motion.h1>

            <motion.p {...rise(1)} className="lede mt-7">
              Qwen, Kimi, GPT, DeepSeek and Grok behind a single key. OpenAI and
              Anthropic compatible, so your client does not change.
            </motion.p>

            <motion.div {...rise(2)} className="mt-9 flex flex-wrap items-center gap-3">
              <Link to="/playground" className="btn btn-primary">
                Get a key
              </Link>
              <Link to="/docs" className="btn btn-ghost">
                Read the docs
              </Link>
            </motion.div>
          </div>

          <motion.div
            {...rise(3)}
            className="lg:col-span-6 lg:col-start-7 xl:col-span-5 xl:col-start-8"
          >
            <Console />
          </motion.div>
        </div>
      </div>
    </section>
  );
}

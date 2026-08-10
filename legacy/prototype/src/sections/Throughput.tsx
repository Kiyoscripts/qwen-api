import { motion, useReducedMotion } from "motion/react";
import { LATENCY_SAMPLE } from "../lib/api";
import { Reveal } from "../components/Reveal";

const W = 720;
const H = 180;

function path(values: number[]): string {
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  return values
    .map((v, i) => {
      const x = (i / (values.length - 1)) * W;
      const y = H - ((v - min) / span) * (H - 16) - 8;
      return `${i === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");
}

/**
 * Time to first token across a run of requests.
 *
 * The line draws itself once on entry. That is the one thing worth animating
 * here: the shape of the series is the message, and drawing it left to right
 * reads as a sequence of requests rather than a static decoration.
 *
 * The series is sample data, not a measured SLA, and says so on the page.
 */
export function Throughput() {
  const reduce = useReducedMotion();
  const d = path(LATENCY_SAMPLE);

  return (
    <section className="border-b border-rule py-20 md:py-28">
      <div className="field">
        <div className="grid gap-12 lg:grid-cols-12 lg:gap-10">
          <Reveal className="lg:col-span-4">
            <h2 className="h2 text-ink">Streams first, thinks out loud.</h2>
            <p className="body mt-5">
              Tokens arrive as they are produced. Reasoning models emit their
              thinking on a separate channel, so you can show it or drop it.
            </p>

            <dl className="mt-9 space-y-5">
              {[
                ["32", "models on one key"],
                ["2", "wire formats, OpenAI and Anthropic"],
                ["1M", "token context, on the flagships"],
              ].map(([figure, label]) => (
                <div key={label} className="flex items-baseline gap-4 border-t border-rule pt-4">
                  <dd className="num shrink-0 text-[1.9rem] leading-none font-medium text-ink">
                    {figure}
                  </dd>
                  <dt className="text-[13.5px] leading-snug text-ink-2">{label}</dt>
                </div>
              ))}
            </dl>
          </Reveal>

          <Reveal delay={0.1} className="lg:col-span-7 lg:col-start-6">
            <div
              className="border border-rule bg-[var(--paper)] p-5"
              style={{ borderRadius: "var(--r-sm)" }}
            >
              <div className="flex items-baseline justify-between">
                <span className="font-mono text-[11.5px] text-ink-3">
                  time to first token, ms
                </span>
                <span className="font-mono text-[11.5px] text-ink-3">sample run</span>
              </div>

              <svg
                viewBox={`0 0 ${W} ${H}`}
                className="mt-4 h-[180px] w-full"
                role="img"
                aria-label="Time to first token across twenty sample requests, ranging roughly 250 to 340 milliseconds"
                preserveAspectRatio="none"
              >
                {/* Reference lines, not decoration: they give the curve a scale. */}
                {[0.25, 0.5, 0.75].map((t) => (
                  <line
                    key={t}
                    x1="0"
                    x2={W}
                    y1={H * t}
                    y2={H * t}
                    stroke="var(--rule)"
                    strokeWidth="1"
                    vectorEffect="non-scaling-stroke"
                  />
                ))}
                <motion.path
                  d={d}
                  fill="none"
                  stroke="var(--signal)"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  vectorEffect="non-scaling-stroke"
                  initial={reduce ? false : { pathLength: 0 }}
                  whileInView={{ pathLength: 1 }}
                  viewport={{ once: true, amount: 0.5 }}
                  transition={{ duration: 1.5, ease: [0.16, 1, 0.3, 1] }}
                />
              </svg>

              <div className="mt-3 flex justify-between font-mono text-[11px] text-ink-3">
                <span>request 1</span>
                <span>request 20</span>
              </div>
            </div>
          </Reveal>
        </div>
      </div>
    </section>
  );
}

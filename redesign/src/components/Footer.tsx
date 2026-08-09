import { Link } from "../lib/router";
import { Reveal } from "../components/Reveal";

const COLUMNS = [
  { head: "Product", links: [["Models", "/models"], ["Playground", "/playground"], ["Chat", "/chat"], ["Docs", "/docs"]] },
  { head: "Reference", links: [["Chat completions", "/docs"], ["Anthropic API", "/docs"], ["Coding CLIs", "/docs"]] },
];

export function Footer() {
  return (
    <>
      {/* Closing action. Split against a rule, unlike any earlier section. */}
      <section className="border-b border-rule py-20 md:py-24">
        <div className="field">
          <Reveal className="grid items-center gap-8 md:grid-cols-12">
            <h2 className="h2 md:col-span-7 text-ink">Start with the free tier.</h2>
            <div className="flex flex-wrap gap-3 md:col-span-5 md:justify-end">
              <Link to="/playground" className="btn btn-primary">
                Get a key
              </Link>
              <Link to="/docs" className="btn btn-ghost">
                Read the docs
              </Link>
            </div>
          </Reveal>
        </div>
      </section>

      <footer className="py-14">
        <div className="field">
          <div className="grid gap-10 md:grid-cols-12">
            <div className="md:col-span-5">
              <p className="font-mono text-[13px] font-medium text-ink">syde</p>
              <p className="body mt-3 max-w-[34ch] text-[13.5px]">
                An OpenAI and Anthropic compatible endpoint for Qwen, Kimi, GPT,
                DeepSeek, Grok and Gemma.
              </p>
            </div>

            {COLUMNS.map((col) => (
              <div key={col.head} className="md:col-span-3 lg:col-span-2">
                <p className="font-mono text-[11px] tracking-wide text-ink-3 uppercase">
                  {col.head}
                </p>
                <ul className="mt-4 space-y-2.5">
                  {col.links.map(([label, to]) => (
                    <li key={label}>
                      <Link
                        to={to}
                        className="text-[13.5px] text-ink-2 no-underline transition-colors duration-200 hover:text-signal"
                      >
                        {label}
                      </Link>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>

          <div className="mt-12 border-t border-rule pt-6">
            <p className="font-mono text-[11.5px] text-ink-3">
              Not affiliated with Alibaba, OpenAI, Moonshot AI, DeepSeek, xAI or Google.
            </p>
          </div>
        </div>
      </footer>
    </>
  );
}

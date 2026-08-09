import { useState } from "react";
import { Check, Copy } from "@phosphor-icons/react";

export interface Sample {
  lang: string;
  code: string;
}

/**
 * Code with a copy button that reports back.
 *
 * The tab switch and the copy confirmation are the only motion here: both are
 * feedback for something the user did, which is the one kind of animation a
 * code block earns.
 */
export function CodeTabs({ samples }: { samples: Sample[] }) {
  const [active, setActive] = useState(0);
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    await navigator.clipboard.writeText(samples[active].code);
    setCopied(true);
    setTimeout(() => setCopied(false), 1600);
  };

  return (
    <div className="border border-rule bg-[var(--paper)]" style={{ borderRadius: "var(--r-sm)" }}>
      <div className="flex items-center justify-between border-b border-rule">
        <div role="tablist" aria-label="Language" className="flex">
          {samples.map((s, i) => (
            <button
              key={s.lang}
              role="tab"
              aria-selected={i === active}
              onClick={() => setActive(i)}
              className={`border-r border-rule px-4 py-2.5 font-mono text-[12px] transition-colors
                duration-200 ${
                  i === active
                    ? "bg-[var(--paper-2)] text-ink"
                    : "text-ink-3 hover:text-ink"
                }`}
            >
              {s.lang}
            </button>
          ))}
        </div>
        <button
          type="button"
          onClick={copy}
          className="flex items-center gap-1.5 px-4 font-mono text-[11.5px] text-ink-3
                     transition-colors duration-200 hover:text-ink"
        >
          {copied ? <Check size={13} weight="bold" /> : <Copy size={13} weight="bold" />}
          {copied ? "Copied" : "Copy"}
        </button>
      </div>

      <pre className="overflow-x-auto px-5 py-5">
        <code className="font-mono text-[12.5px] leading-[1.7] text-ink">
          {samples[active].code}
        </code>
      </pre>
    </div>
  );
}

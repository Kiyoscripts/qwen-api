"use client";

import { useState } from "react";
import { Check, Copy } from "@phosphor-icons/react";

export interface Sample {
  lang: string;
  code: string;
}

/**
 * A code block with one tab per language.
 *
 * The tab choice is per-block rather than global on purpose: most readers want
 * one language, but the person checking whether the Go example matches the
 * Python one wants to flip a single block without moving the whole page.
 */
export function CodeTabs({ samples, id }: { samples: Sample[]; id?: string }) {
  const [active, setActive] = useState(0);
  const [copied, setCopied] = useState(false);
  const current = samples[active] ?? samples[0];

  async function copy() {
    try {
      await navigator.clipboard.writeText(current.code);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard may be blocked */
    }
  }

  return (
    <div className="dc" id={id}>
      <div className="dc-head">
        <div className="dc-tabs" role="tablist">
          {samples.map((s, i) => (
            <button
              key={s.lang}
              role="tab"
              aria-selected={i === active}
              className={`dc-tab ${i === active ? "on" : ""}`}
              onClick={() => setActive(i)}
            >
              {s.lang}
            </button>
          ))}
        </div>
        <button className="dc-copy" onClick={copy} aria-label="Copy code">
          {copied ? <Check size={13} weight="bold" /> : <Copy size={13} />} {copied ? "Copied" : "Copy"}
        </button>
      </div>
      <pre>
        <code>{current.code}</code>
      </pre>
    </div>
  );
}

/** Single-language block, same chrome. */
export function Code({ children, lang = "bash" }: { children: string; lang?: string }) {
  return <CodeTabs samples={[{ lang, code: children }]} />;
}

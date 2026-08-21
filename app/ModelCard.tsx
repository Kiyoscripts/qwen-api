"use client";

import { useState } from "react";
import { Check, Copy } from "@phosphor-icons/react";
import { Logo } from "./Logo";

export interface CardModel {
  id: string;
  name: string;
  owner: string;
  maker: string;
  inputs: string[];
  thinking: boolean;
  context?: number;
}

export function ModelCard({ m, labels }: { m: CardModel; labels: Record<string, string> }) {
  const [copied, setCopied] = useState(false);
  async function copyId() {
    await navigator.clipboard.writeText(m.id);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1600);
  }
  return (
    <article
      className="group flex h-full flex-col justify-between border border-rule bg-[var(--paper)] p-5
                 transition-colors duration-300 hover:border-ink"
      style={{ borderRadius: "var(--r-sm)" }}
    >
      <div>
        <div className="flex items-baseline justify-between gap-3">
          <div className="flex min-w-0 items-center gap-2.5">
            <Logo maker={m.maker} className="h-[15px] text-ink-2" />
            <h3 className="h3 truncate text-ink">{m.name}</h3>
          </div>
          {m.thinking && (
            <span className="shrink-0 font-mono text-[10.5px] text-signal">{labels.reasoning}</span>
          )}
        </div>
        <div className="mt-1.5 flex items-start gap-2"><p className="min-w-0 flex-1 break-all font-mono text-[11.5px] text-ink-3">{m.id}</p><button type="button" onClick={copyId} className="shrink-0 p-1 text-ink-3 transition-colors hover:text-signal" aria-label={`Copy model ID ${m.id}`}>{copied?<Check size={15} weight="bold"/>:<Copy size={15}/>}</button></div>
      </div>
      <div className="mt-6">
        <div className="flex flex-wrap gap-1.5">
          {m.inputs.map((i) => (
            <span key={i}
              className={`border px-2 py-1 font-mono text-[10.5px] ${i === "text" ? "border-rule text-ink-2" : "border-[var(--signal)] bg-[var(--signal-wash)] text-signal"}`}
              style={{ borderRadius: "var(--r-sm)" }}>
              {labels[i] ?? i}
            </span>
          ))}
        </div>
        {m.context && (
          <p className="num mt-3 text-[11.5px] text-ink-3">
            {(m.context / 1000).toLocaleString()}k context
          </p>
        )}
      </div>
    </article>
  );
}

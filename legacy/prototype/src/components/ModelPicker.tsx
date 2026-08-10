import { useEffect, useMemo, useRef, useState } from "react";
import { CaretDown, MagnifyingGlass, Check } from "@phosphor-icons/react";
import type { Model } from "../lib/api";
import { Logo } from "./Logo";

const MAKER_LABEL: Record<string, string> = {
  qwen: "Qwen",
  moonshotai: "Moonshot AI",
  openai: "OpenAI",
  deepseek: "DeepSeek",
  xai: "xAI",
  google: "Google",
};

/**
 * Thirty-two ids is too many for a select, so this is a searchable list grouped
 * by maker. Native button plus keyboard dismissal rather than a headless
 * library: one control does not justify the dependency.
 */
export function ModelPicker({
  models,
  value,
  onChange,
  filter,
}: {
  models: Model[];
  value: string;
  onChange: (id: string) => void;
  filter?: (m: Model) => boolean;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const wrap = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!wrap.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const pool = useMemo(() => models.filter((m) => (filter ? filter(m) : true)), [models, filter]);

  const groups = useMemo(() => {
    const q = query.trim().toLowerCase();
    const hit = pool.filter(
      (m) => !q || m.id.toLowerCase().includes(q) || m.display_name.toLowerCase().includes(q)
    );
    const by = new Map<string, Model[]>();
    for (const m of hit) by.set(m.owned_by, [...(by.get(m.owned_by) ?? []), m]);
    return [...by.entries()];
  }, [pool, query]);

  const current = pool.find((m) => m.id === value);

  return (
    <div ref={wrap} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="listbox"
        aria-expanded={open}
        className="flex h-10 w-full items-center justify-between gap-3 border border-rule px-3
                   text-left transition-colors duration-200 hover:border-ink"
        style={{ borderRadius: "var(--r-sm)" }}
      >
        <span className="flex min-w-0 items-center gap-2">
          {current && <Logo maker={current.owned_by} className="h-[14px] text-ink-2" />}
          <span className="truncate font-mono text-[12.5px] text-ink">
            {current?.id ?? value}
          </span>
        </span>
        <CaretDown size={13} weight="bold" className="shrink-0 text-ink-3" />
      </button>

      {open && (
        <div
          className="absolute z-30 mt-1 max-h-[340px] w-full min-w-[280px] overflow-y-auto
                     border border-rule-strong bg-[var(--paper)] shadow-lg"
          style={{ borderRadius: "var(--r-sm)" }}
          role="listbox"
        >
          <div className="sticky top-0 flex items-center gap-2 border-b border-rule bg-[var(--paper)] px-3 py-2">
            <MagnifyingGlass size={13} weight="bold" className="shrink-0 text-ink-3" />
            <input
              autoFocus
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Filter models"
              aria-label="Filter models"
              className="w-full bg-transparent font-mono text-[12px] text-ink outline-none
                         placeholder:text-ink-3"
            />
          </div>

          {groups.length === 0 && (
            <p className="px-3 py-6 text-center font-mono text-[12px] text-ink-3">
              Nothing matches.
            </p>
          )}

          {groups.map(([maker, list]) => (
            <div key={maker}>
              <p className="px-3 pt-3 pb-1 font-mono text-[10.5px] tracking-wider text-ink-3 uppercase">
                {MAKER_LABEL[maker] ?? maker}
              </p>
              {list.map((m) => (
                <button
                  key={m.id}
                  role="option"
                  aria-selected={m.id === value}
                  onClick={() => {
                    onChange(m.id);
                    setOpen(false);
                    setQuery("");
                  }}
                  className={`flex w-full items-center justify-between gap-3 px-3 py-2 text-left
                    transition-colors duration-150 hover:bg-[var(--paper-2)] ${
                      m.id === value ? "text-signal" : "text-ink"
                    }`}
                >
                  <span className="flex min-w-0 items-center gap-2.5">
                    <Logo maker={m.owned_by} className="h-[14px] text-ink-2" />
                    <span className="min-w-0">
                    <span className="block truncate text-[13px]">{m.display_name}</span>
                    <span className="block truncate font-mono text-[11px] text-ink-3">{m.id}</span>
                    </span>
                  </span>
                  {m.id === value && <Check size={13} weight="bold" className="shrink-0" />}
                </button>
              ))}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

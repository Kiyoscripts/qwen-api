"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { CaretDown, MagnifyingGlass, Check } from "@phosphor-icons/react";
import { Logo } from "./Logo";

export interface ModelInputs { image: boolean; document: boolean; video: boolean; audio: boolean }

export interface PickModel {
  id: string; name: string; maker: string; chatTypes: string[]; thinking: boolean;
  input: ModelInputs;
}

/**
 * What the file picker should accept for a model.
 *
 * Built from what the model declares rather than a fixed list, so a model that
 * takes audio offers audio and one that does not never shows it. An empty
 * string means it takes no files, and the control is disabled.
 */
export function acceptFor(m: PickModel | undefined): string {
  if (!m) return "";
  const parts: string[] = [];
  if (m.input.image) parts.push("image/*");
  if (m.input.audio) parts.push("audio/*");
  if (m.input.video) parts.push("video/*");
  if (m.input.document) parts.push(".pdf,.txt,.md,.csv,.json,.docx,.xlsx,.pptx");
  return parts.join(",");
}

/** Reads the capability block the API returns for each model. */
export function toPickModel(m: any): PickModel {
  const i = m.capabilities?.input ?? {};
  return {
    id: m.id,
    name: m.display_name || m.id,
    maker: (m.owned_by === "qwen" ? "qwen" : String(m.id).split("/")[0]) || "qwen",
    chatTypes: m.capabilities?.chat_types ?? ["t2t"],
    thinking: Boolean(m.capabilities?.thinking),
    input: {
      image: Boolean(i.image ?? m.capabilities?.vision),
      document: Boolean(i.document),
      video: Boolean(i.video),
      audio: Boolean(i.audio),
    },
  };
}

/** Thirty-odd ids is too many for a select, so this is a searchable list
    grouped by maker. One control does not justify a headless library. */
export function ModelPicker({
  models, value, onChange, filter,
}: {
  models: PickModel[]; value: string; onChange: (id: string) => void; filter?: (m: PickModel) => boolean;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const wrap = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const down = (e: MouseEvent) => { if (!wrap.current?.contains(e.target as Node)) setOpen(false); };
    const key = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", down);
    document.addEventListener("keydown", key);
    return () => { document.removeEventListener("mousedown", down); document.removeEventListener("keydown", key); };
  }, [open]);

  const pool = useMemo(() => models.filter((m) => (filter ? filter(m) : true)), [models, filter]);
  const groups = useMemo(() => {
    const q = query.trim().toLowerCase();
    const hit = pool.filter((m) => !q || m.id.toLowerCase().includes(q) || m.name.toLowerCase().includes(q));
    const by = new Map<string, PickModel[]>();
    for (const m of hit) by.set(m.maker, [...(by.get(m.maker) ?? []), m]);
    return [...by.entries()];
  }, [pool, query]);

  const current = pool.find((m) => m.id === value);

  return (
    <div ref={wrap} className="relative">
      <button type="button" onClick={() => setOpen((v) => !v)} aria-haspopup="listbox" aria-expanded={open}
        className="flex h-10 w-full items-center justify-between gap-3 border border-rule px-3 text-left
                   transition-colors duration-200 hover:border-ink"
        style={{ borderRadius: "var(--r-sm)" }}>
        <span className="flex min-w-0 items-center gap-2">
          {current && <Logo maker={current.maker} className="h-[14px] text-ink-2" />}
          <span className="truncate font-mono text-[12.5px] text-ink">{current?.id ?? value}</span>
        </span>
        <CaretDown size={13} weight="bold" className="shrink-0 text-ink-3" />
      </button>

      {open && (
        <div className="absolute z-30 mt-1 max-h-[340px] w-full min-w-[280px] overflow-y-auto
                        border border-rule-strong bg-[var(--paper)] shadow-lg"
             style={{ borderRadius: "var(--r-sm)" }} role="listbox">
          <div className="sticky top-0 flex items-center gap-2 border-b border-rule bg-[var(--paper)] px-3 py-2">
            <MagnifyingGlass size={13} weight="bold" className="shrink-0 text-ink-3" />
            <input autoFocus value={query} onChange={(e) => setQuery(e.target.value)}
              placeholder="Filter models" aria-label="Filter models"
              className="w-full bg-transparent font-mono text-[12px] text-ink outline-none placeholder:text-ink-3" />
          </div>
          {groups.length === 0 && <p className="px-3 py-6 text-center font-mono text-[12px] text-ink-3">No match.</p>}
          {groups.map(([maker, list]) => (
            <div key={maker}>
              <p className="px-3 pt-3 pb-1 font-mono text-[10.5px] tracking-wider text-ink-3 uppercase">{maker}</p>
              {list.map((m) => (
                <button key={m.id} role="option" aria-selected={m.id === value}
                  onClick={() => { onChange(m.id); setOpen(false); setQuery(""); }}
                  className={`flex w-full items-center justify-between gap-3 px-3 py-2 text-left
                    transition-colors duration-150 hover:bg-[var(--paper-2)] ${m.id === value ? "text-signal" : "text-ink"}`}>
                  <span className="flex min-w-0 items-center gap-2.5">
                    <Logo maker={m.maker} className="h-[14px] text-ink-2" />
                    <span className="min-w-0">
                      <span className="block truncate text-[13px]">{m.name}</span>
                      <span className="block truncate font-mono text-[11px] text-ink-3">{m.id}</span>
                      {(["image", "document", "video", "audio"] as const).some((k) => m.input[k]) && (
                        <span className="mt-0.5 block font-mono text-[10px] text-signal">
                          {(["image", "document", "video", "audio"] as const)
                            .filter((k) => m.input[k])
                            .map((k) => (k === "document" ? "file" : k))
                            .join(" · ")}
                        </span>
                      )}
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

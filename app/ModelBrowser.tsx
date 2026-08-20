"use client";

import { useMemo, useState } from "react";
import { MagnifyingGlass } from "@phosphor-icons/react";
import { useT } from "./I18n";
import { ModelCard, type CardModel } from "./ModelCard";

/** Search and company filter over the catalogue. Filtering is local: the list
    is small enough that a request per keystroke would be the slower design. */
export function ModelBrowser({ rows }: { rows: CardModel[] }) {
  const t = useT();
  const [query, setQuery] = useState("");
  const [maker, setMaker] = useState<string | null>(null);
  const [capability, setCapability] = useState<string | null>(null);
  const [sort, setSort] = useState("name");

  const labels = {
    reasoning: t("tag_reasoning"),
    text: t("tag_text"),
    image: t("models_input_image"),
    file: t("models_input_file"),
    video: t("models_input_video"),
    audio: t("models_input_audio"),
  };

  const makers = useMemo(() => {
    const c = new Map<string, number>();
    for (const r of rows) c.set(r.maker, (c.get(r.maker) ?? 0) + 1);
    return [...c.entries()].sort((a, b) => b[1] - a[1]);
  }, [rows]);

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return rows.filter((r) => {
      if (maker && r.maker !== maker) return false;
      if (capability === "reasoning" && !r.thinking) return false;
      if (capability && capability !== "reasoning" && !r.inputs.includes(capability)) return false;
      if (!q) return true;
      return r.id.toLowerCase().includes(q) || r.name.toLowerCase().includes(q);
    }).sort((a,b)=>sort==="provider"?a.maker.localeCompare(b.maker)||a.name.localeCompare(b.name):sort==="context"?(b.context||0)-(a.context||0):a.name.localeCompare(b.name));
  }, [rows, query, maker, capability, sort]);

  return (
    <>
      <div className="mt-9 flex flex-wrap items-center gap-3">
        <div className="flex h-10 min-w-[220px] flex-1 items-center gap-2 border border-rule px-3"
             style={{ borderRadius: "var(--r-sm)" }}>
          <MagnifyingGlass size={15} weight="bold" className="shrink-0 text-ink-3" />
          <label htmlFor="model-search" className="sr-only">{t("models_search")}</label>
          <input id="model-search" value={query} onChange={(e) => setQuery(e.target.value)}
            placeholder={t("models_search")}
            className="w-full bg-transparent font-mono text-[13px] text-ink outline-none placeholder:text-ink-3" />
        </div>
        <div className="flex flex-wrap gap-2">
          <Chip on={maker === null} onClick={() => setMaker(null)}>{t("models_all")} {rows.length}</Chip>
          {makers.map(([key, n]) => (
            <Chip key={key} on={maker === key} onClick={() => setMaker(maker === key ? null : key)}>
              {key} {n}
            </Chip>
          ))}
        </div><select value={capability||""} onChange={e=>setCapability(e.target.value||null)} className="h-10 border border-rule bg-transparent px-3 font-mono text-xs text-ink" aria-label="Filter by capability"><option value="">All capabilities</option><option value="reasoning">Reasoning</option><option value="image">Image</option><option value="file">Files</option><option value="video">Video</option><option value="audio">Audio</option></select><select value={sort} onChange={e=>setSort(e.target.value)} className="h-10 border border-rule bg-transparent px-3 font-mono text-xs text-ink" aria-label="Sort models"><option value="name">Sort: name</option><option value="provider">Sort: provider</option><option value="context">Sort: context</option></select>
      </div>

      {shown.length === 0 ? (
        <div className="mt-8 border border-dashed border-rule-strong px-6 py-16 text-center"
             style={{ borderRadius: "var(--r-sm)" }}>
          <p className="h3 text-ink">{t("models_none")}</p>
          <button onClick={() => { setQuery(""); setMaker(null); setCapability(null); setSort("name"); }} className="btn btn-ghost mt-5">
            {t("models_reset")}
          </button>
        </div>
      ) : (
        <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {shown.map((m) => <ModelCard key={m.id} m={m} labels={labels} />)}
        </div>
      )}
    </>
  );
}

function Chip({ on, onClick, children }: { on: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button type="button" onClick={onClick} aria-pressed={on}
      className={`h-10 border px-3 font-mono text-[12px] transition-colors duration-200 ${
        on ? "border-ink bg-ink text-[var(--paper)]" : "border-rule text-ink-2 hover:border-ink hover:text-ink"}`}
      style={{ borderRadius: "var(--r-sm)" }}>
      {children}
    </button>
  );
}

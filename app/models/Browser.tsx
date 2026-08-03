"use client";

// The catalogue browser: search, filter by company, grouped results.
//
// The rows are resolved on the server (the live Qwen list needs the account
// pool) and handed over whole, so filtering is local and instant — no request
// per keystroke, and no loading state to design around. The list is small
// enough (tens of rows) that filtering on every render is cheaper than the
// bookkeeping to avoid it.

import { useMemo, useState } from "react";
import { MagnifyingGlass, X } from "@phosphor-icons/react";
import { useT } from "../I18n";

export interface ModelRow {
  id: string;
  name: string;
  icon: string;
  tags: string[];
  inputs: string[];
  makerKey: string;
  makerLabel: string;
  makerIcon: string;
}

/** Groups rows by maker, preserving the order makers first appear. */
function groupByMaker(rows: ModelRow[]) {
  const groups: { key: string; label: string; icon: string; rows: ModelRow[] }[] = [];
  for (const r of rows) {
    let g = groups.find((x) => x.key === r.makerKey);
    if (!g) {
      g = { key: r.makerKey, label: r.makerLabel, icon: r.makerIcon, rows: [] };
      groups.push(g);
    }
    g.rows.push(r);
  }
  return groups;
}

export default function Browser({ rows }: { rows: ModelRow[] }) {
  const t = useT();
  const [query, setQuery] = useState("");
  const [maker, setMaker] = useState<string | null>(null);

  // Counts come from the unfiltered list so the chips never renumber as you
  // type — a chip that reads "OpenAI 3" and then "OpenAI 0" is a worse way of
  // saying "no matches" than the empty state is.
  const makers = useMemo(() => {
    const seen = new Map<string, { key: string; label: string; icon: string; count: number }>();
    for (const r of rows) {
      const m = seen.get(r.makerKey);
      if (m) m.count++;
      else seen.set(r.makerKey, { key: r.makerKey, label: r.makerLabel, icon: r.makerIcon, count: 1 });
    }
    return [...seen.values()].sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
  }, [rows]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return rows.filter((r) => {
      if (maker && r.makerKey !== maker) return false;
      if (!q) return true;
      // Id and name both match, so "kimi" and "moonshotai/" both land.
      return r.name.toLowerCase().includes(q) || r.id.toLowerCase().includes(q) ||
        r.tags.some((tag) => tag.toLowerCase().includes(q));
    });
  }, [rows, query, maker]);

  const groups = useMemo(() => groupByMaker(filtered), [filtered]);

  return (
    <>
      <div className="mdl-bar">
        <div className="mdl-search">
          <MagnifyingGlass size={16} weight="bold" aria-hidden />
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t("models_search")}
            aria-label={t("models_search")}
          />
          {query && (
            <button type="button" onClick={() => setQuery("")} aria-label={t("models_clear")}>
              <X size={14} weight="bold" />
            </button>
          )}
        </div>

        <div className="mdl-chips" role="group" aria-label={t("models_company")}>
          <button
            type="button"
            className={`mdl-chip ${maker === null ? "on" : ""}`}
            aria-pressed={maker === null}
            onClick={() => setMaker(null)}
          >
            {t("models_all")} <span className="n">{rows.length}</span>
          </button>
          {makers.map((m) => (
            <button
              key={m.key}
              type="button"
              className={`mdl-chip ${maker === m.key ? "on" : ""}`}
              aria-pressed={maker === m.key}
              onClick={() => setMaker(maker === m.key ? null : m.key)}
            >
              <img src={m.icon} alt="" width={15} height={15} />
              {m.label} <span className="n">{m.count}</span>
            </button>
          ))}
        </div>
      </div>

      {groups.length === 0 ? (
        <div className="mdl-empty">
          <p>{t("models_none")}</p>
          <button type="button" className="g-btn outline" onClick={() => { setQuery(""); setMaker(null); }}>
            {t("models_reset")}
          </button>
        </div>
      ) : (
        groups.map((g) => (
          <section key={g.key} className="mdl-group">
            <div className="mdl-grouphead">
              <img src={g.icon} alt="" width={18} height={18} />
              <h2>{g.label}</h2>
              <span className="n">{g.rows.length}</span>
            </div>
            <div className="lp-models">
              {g.rows.map((m) => (
                <div key={m.id} className="lp-mcard glass">
                  <div className="mt">
                    {m.icon.startsWith("/")
                      ? <img className="chip-img" src={m.icon} alt="" width={22} height={22} />
                      : <span className="chip" />}
                    {m.name}
                  </div>
                  <div className="md"><code>{m.id}</code></div>
                  {m.inputs.length > 0 && (
                    <div className="mdl-inputs">
                      <span className="lbl">{t("models_inputs")}</span>
                      {m.inputs.map((i) => <span key={i} className="mdl-input">{t(`models_input_${i}` as any)}</span>)}
                    </div>
                  )}
                  <div className="lp-tags">{m.tags.map((tag) => <span key={tag} className="lp-tag">{tag}</span>)}</div>
                </div>
              ))}
            </div>
          </section>
        ))
      )}
    </>
  );
}

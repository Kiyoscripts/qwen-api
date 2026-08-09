import { useEffect, useMemo, useState } from "react";
import { MagnifyingGlass } from "@phosphor-icons/react";
import { listModels, type Model } from "../lib/api";
import { ModelCard } from "../components/ModelCard";
import { Reveal } from "../components/Reveal";

const MAKER_LABEL: Record<string, string> = {
  qwen: "Qwen",
  moonshotai: "Moonshot AI",
  openai: "OpenAI",
  deepseek: "DeepSeek",
  xai: "xAI",
  google: "Google",
};

export function Models() {
  const [models, setModels] = useState<Model[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [query, setQuery] = useState("");
  const [maker, setMaker] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    listModels()
      .then((m) => live && setModels(m))
      .catch(() => live && setFailed(true));
    return () => {
      live = false;
    };
  }, []);

  const makers = useMemo(() => {
    if (!models) return [];
    const counts = new Map<string, number>();
    for (const m of models) counts.set(m.owned_by, (counts.get(m.owned_by) ?? 0) + 1);
    return [...counts.entries()].sort((a, b) => b[1] - a[1]);
  }, [models]);

  const shown = useMemo(() => {
    if (!models) return [];
    const q = query.trim().toLowerCase();
    return models.filter((m) => {
      if (maker && m.owned_by !== maker) return false;
      if (!q) return true;
      return m.id.toLowerCase().includes(q) || m.display_name.toLowerCase().includes(q);
    });
  }, [models, query, maker]);

  return (
    <div className="field py-16 md:py-20">
      <Reveal>
        <h1 className="h2 text-ink">The catalogue</h1>
        <p className="body mt-4">
          Every id below works on the same endpoint with the same key. Input
          support is declared per model, not assumed.
        </p>
      </Reveal>

      <Reveal delay={0.06} className="mt-9">
        <div className="flex flex-wrap items-center gap-3">
          <div
            className="flex h-10 min-w-[220px] flex-1 items-center gap-2 border border-rule px-3"
            style={{ borderRadius: "var(--r-sm)" }}
          >
            <MagnifyingGlass size={15} weight="bold" className="shrink-0 text-ink-3" />
            <label htmlFor="model-search" className="sr-only">
              Search models
            </label>
            <input
              id="model-search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search"
              className="w-full bg-transparent font-mono text-[13px] text-ink outline-none
                         placeholder:text-ink-3"
            />
          </div>

          <div className="flex flex-wrap gap-2">
            <FilterChip active={maker === null} onClick={() => setMaker(null)}>
              All {models ? models.length : ""}
            </FilterChip>
            {makers.map(([key, n]) => (
              <FilterChip
                key={key}
                active={maker === key}
                onClick={() => setMaker(maker === key ? null : key)}
              >
                {MAKER_LABEL[key] ?? key} {n}
              </FilterChip>
            ))}
          </div>
        </div>
      </Reveal>

      <div className="mt-8">
        {failed ? (
          <Empty
            title="The catalogue did not load."
            body="The account pool is unreachable. Reload to try again."
          />
        ) : !models ? (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {Array.from({ length: 6 }).map((_, i) => (
              <div
                key={i}
                className="h-[188px] animate-pulse border border-rule bg-[var(--paper-2)]"
                style={{ borderRadius: "var(--r-sm)" }}
              />
            ))}
          </div>
        ) : shown.length === 0 ? (
          <Empty
            title="No model matches that."
            body="Clear the search or pick a different company."
          />
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {shown.map((m, i) => (
              <Reveal key={m.id} delay={Math.min(i, 8) * 0.03}>
                <ModelCard model={m} />
              </Reveal>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function FilterChip({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`h-10 border px-3 font-mono text-[12px] transition-colors duration-200 ${
        active
          ? "border-ink bg-ink text-[var(--paper)]"
          : "border-rule text-ink-2 hover:border-ink hover:text-ink"
      }`}
      style={{ borderRadius: "var(--r-sm)" }}
    >
      {children}
    </button>
  );
}

function Empty({ title, body }: { title: string; body: string }) {
  return (
    <div
      className="border border-dashed border-rule-strong px-6 py-16 text-center"
      style={{ borderRadius: "var(--r-sm)" }}
    >
      <p className="h3 text-ink">{title}</p>
      <p className="body mx-auto mt-2 text-[13.5px]">{body}</p>
    </div>
  );
}

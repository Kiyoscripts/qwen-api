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
        <p className="mt-1.5 font-mono text-[11.5px] break-all text-ink-3">{m.id}</p>
      </div>
      <div className="mt-6">
        <div className="flex flex-wrap gap-1.5">
          <span className="border border-rule px-2 py-1 font-mono text-[10.5px] text-ink-2"
                style={{ borderRadius: "var(--r-sm)" }}>
            {labels.text}
          </span>
          {m.inputs.map((i) => (
            <span key={i}
              className="border border-[var(--signal)] bg-[var(--signal-wash)] px-2 py-1 font-mono
                         text-[10.5px] text-signal"
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

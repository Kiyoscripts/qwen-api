import { useMemo, useState } from "react";
import { MagnifyingGlass } from "@phosphor-icons/react";
import type { Voice } from "../lib/voices";

/**
 * Seventy-eight voices.
 *
 * At that size a grid of names is a wall, so this is search first, and every
 * row carries the one-line description upstream ships. That description is the
 * only thing that distinguishes "Cherry" from "Serena" for someone who has not
 * heard either, which makes it the content rather than decoration.
 */
export function VoicePicker({
  voices,
  value,
  onChange,
}: {
  voices: Voice[];
  value: string;
  onChange: (speaker: string) => void;
}) {
  const [query, setQuery] = useState("");
  const [kind, setKind] = useState<"all" | "audio" | "omni">("all");

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return voices.filter((v) => {
      if (kind !== "all" && v.kind !== kind) return false;
      if (!q) return true;
      return (
        v.name.toLowerCase().includes(q) ||
        v.description.toLowerCase().includes(q) ||
        v.gender.toLowerCase().includes(q)
      );
    });
  }, [voices, query, kind]);

  return (
    <div>
      <div className="flex gap-1.5">
        <div
          className="flex h-9 flex-1 items-center gap-2 border border-rule px-2.5"
          style={{ borderRadius: "var(--r-sm)" }}
        >
          <MagnifyingGlass size={13} weight="bold" className="shrink-0 text-ink-3" />
          <label htmlFor="voice-search" className="sr-only">
            Search voices
          </label>
          <input
            id="voice-search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search 78 voices"
            className="w-full bg-transparent font-mono text-[12px] text-ink outline-none
                       placeholder:text-ink-3"
          />
        </div>
        {(["all", "audio", "omni"] as const).map((k) => (
          <button
            key={k}
            onClick={() => setKind(k)}
            aria-pressed={kind === k}
            className={`h-9 border px-2.5 font-mono text-[11px] transition-colors duration-200 ${
              kind === k
                ? "border-ink bg-ink text-[var(--paper)]"
                : "border-rule text-ink-2 hover:border-ink hover:text-ink"
            }`}
            style={{ borderRadius: "var(--r-sm)" }}
          >
            {k}
          </button>
        ))}
      </div>

      <div
        className="mt-2 max-h-[260px] overflow-y-auto border border-rule"
        style={{ borderRadius: "var(--r-sm)" }}
      >
        {shown.length === 0 ? (
          <p className="px-3 py-8 text-center font-mono text-[12px] text-ink-3">
            No voice matches that.
          </p>
        ) : (
          shown.map((v, i) => (
            <button
              key={v.speaker}
              onClick={() => onChange(v.speaker)}
              aria-pressed={value === v.speaker}
              className={`flex w-full items-start gap-3 px-3 py-2.5 text-left transition-colors
                duration-150 hover:bg-[var(--paper-2)] ${i > 0 ? "border-t border-rule" : ""} ${
                value === v.speaker ? "bg-[var(--signal-wash)]" : ""
              }`}
            >
              <span className="min-w-0 flex-1">
                <span
                  className={`block text-[13px] ${
                    value === v.speaker ? "text-signal" : "text-ink"
                  }`}
                >
                  {v.name}
                </span>
                <span className="mt-0.5 block text-[12px] leading-snug text-ink-3">
                  {v.description}
                </span>
              </span>
              <span className="shrink-0 font-mono text-[10px] text-ink-3">
                {v.gender === "female" ? "F" : "M"} · {v.kind}
              </span>
            </button>
          ))
        )}
      </div>
      <p className="mt-1.5 font-mono text-[11px] text-ink-3">
        {shown.length} of {voices.length} voices
      </p>
    </div>
  );
}

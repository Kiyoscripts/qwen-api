"use client";

import { REASONING_EFFORT_LABELS, type ReasoningEffort } from "@/lib/reasoningEffort";

/**
 * Segmented control for multi-level reasoning_effort.
 *
 * Only rendered when the model advertises levels. Each button is one supported
 * value; order follows the model's list (already sorted by the API).
 */
export function EffortPicker({
  levels,
  value,
  onChange,
  label,
}: {
  levels: string[];
  value: string;
  onChange: (v: string) => void;
  /** Accessible group label. */
  label?: string;
}) {
  if (!levels.length) return null;
  return (
    <div
      className="flex flex-wrap items-center gap-1"
      role="group"
      aria-label={label || "Reasoning effort"}
    >
      {levels.map((level) => {
        const key = level.toLowerCase();
        const text =
          REASONING_EFFORT_LABELS[key as ReasoningEffort] ??
          level.charAt(0).toUpperCase() + level.slice(1);
        const on = value === key;
        return (
          <button
            key={key}
            type="button"
            onClick={() => onChange(key)}
            aria-pressed={on}
            title={key}
            className={`border px-2 py-1.5 font-mono text-[11px] transition-colors duration-200 ${
              on
                ? "border-signal text-signal"
                : "border-rule text-ink-3 hover:border-ink hover:text-ink"
            }`}
            style={{ borderRadius: "var(--r-sm)" }}
          >
            {text}
          </button>
        );
      })}
    </div>
  );
}

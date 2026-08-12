// Multi-level reasoning effort, as advertised on /v1/models and accepted on
// /v1/chat/completions as `reasoning_effort`.
//
// Levels are taken from OpenCode's model catalog (`opencode models --verbose`
// → `variants`). Empty variants means the model has no effort switch — do not
// list or send reasoning_effort for those models.
//
// Qwen remains a boolean (enable_thinking) and is not covered here.

/**
 * Canonical order for UI (low effort → high).
 *
 * "adaptive" leads because it is not a rung on the ladder: it hands the choice
 * to the model, which is what Solar's composer calls Auto. Only providers that
 * advertise it list it.
 */
export const REASONING_EFFORT_ORDER = [
  "adaptive",
  "none",
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
] as const;

export type ReasoningEffort = (typeof REASONING_EFFORT_ORDER)[number];

/** Short labels for the effort picker. */
export const REASONING_EFFORT_LABELS: Record<ReasoningEffort, string> = {
  adaptive: "Auto",
  none: "None",
  minimal: "Min",
  low: "Low",
  medium: "Med",
  high: "High",
  xhigh: "xHigh",
  max: "Max",
};

// --- Sets from OpenCode variants (Zen free models + TokenRouter Kimi) --------

/** opencode/laguna-s-2.1-free, opencode/longcat-2.0-free — low, medium, high */
export const LOW_MED_HIGH_EFFORT: ReasoningEffort[] = ["low", "medium", "high"];

/** opencode/north-mini-code-free — none, high */
export const NORTH_MINI_EFFORT: ReasoningEffort[] = ["none", "high"];

/**
 * TokenRouter / Moonshot Kimi K3 — low, high, max
 * (OpenCode Zen paid kimi-k3 only lists max; we use TokenRouter, not Zen.)
 */
export const KIMI_K3_EFFORT: ReasoningEffort[] = ["low", "high", "max"];

export function isReasoningEffort(v: unknown): v is ReasoningEffort {
  return typeof v === "string" && (REASONING_EFFORT_ORDER as readonly string[]).includes(v);
}

/** Sort a model's supported set into canonical UI order. */
export function sortEfforts(levels: readonly string[]): ReasoningEffort[] {
  const set = new Set(levels.map((s) => s.toLowerCase()));
  return REASONING_EFFORT_ORDER.filter((e) => set.has(e));
}

/**
 * Validate a request's reasoning_effort against a model.
 * Returns the normalised level, or null if the body omitted it.
 * Throws a message string if the value is present but invalid for the model.
 */
export function pickReasoningEffort(
  body: any,
  supported: readonly string[] | undefined | null
): string | null {
  const raw = body?.reasoning_effort;
  if (raw === undefined || raw === null || raw === "") return null;
  if (typeof raw !== "string") throw "reasoning_effort must be a string.";
  const level = raw.trim().toLowerCase();
  if (!supported || supported.length === 0) {
    throw `Model does not support reasoning_effort (got '${level}').`;
  }
  const ok = supported.map((s) => s.toLowerCase());
  if (!ok.includes(level)) {
    throw `reasoning_effort '${level}' is not supported. Use one of: ${ok.join(", ")}.`;
  }
  return level;
}

/** Default effort when the caller does not send one. Prefers none, else first. */
export function defaultEffort(supported: readonly string[] | undefined | null): string | undefined {
  if (!supported || supported.length === 0) return undefined;
  const sorted = sortEfforts(supported);
  if (sorted.includes("none")) return "none";
  return sorted[0];
}

/**
 * Runtime graphics budget.
 *
 * The backdrop is an animated full-viewport canvas under a 28px CSS blur, and a
 * dozen elements over it use backdrop-filter. That combination is what costs:
 * because the canvas changes every frame, every backdrop-filter layer above it
 * has to re-blur every frame too. On a discrete GPU it is invisible; on
 * integrated graphics it is the whole frame budget.
 *
 * Rather than pick one look for everyone, the page measures itself and steps
 * down until frames land on time:
 *
 *   full     — as designed: 60fps, full-resolution blur, grain, glass.
 *   reduced  — 30fps, coarser canvas, softer blur, no grain.
 *   lite     — one static frame, no animation loop, no backdrop-filter at all.
 *
 * The chosen tier is persisted, so a machine that needed `lite` starts there on
 * the next visit instead of paying a janky second to rediscover it.
 */

export type PerfTier = "full" | "reduced" | "lite";

const STORE = "qwen_perf_tier";
const ORDER: PerfTier[] = ["full", "reduced", "lite"];

export function nextTierDown(t: PerfTier): PerfTier | null {
  const i = ORDER.indexOf(t);
  return i >= 0 && i < ORDER.length - 1 ? ORDER[i + 1] : null;
}

/** Per-tier drawing budget, read by the Aurora loop. */
export const TIER_SETTINGS: Record<PerfTier, { fps: number; down: number; blurPx: number; animate: boolean }> = {
  full: { fps: 60, down: 4, blurPx: 28, animate: true },
  reduced: { fps: 30, down: 6, blurPx: 18, animate: true },
  lite: { fps: 0, down: 8, blurPx: 12, animate: false },
};

function isTier(v: unknown): v is PerfTier {
  return v === "full" || v === "reduced" || v === "lite";
}

/**
 * Where to start before any measurement.
 *
 * Reduced motion is a stated preference, not a guess, so it wins outright. Core
 * count is a coarse proxy but a useful one: it is the only capability signal
 * available synchronously at first paint, and starting a 4-core laptop at `full`
 * means showing it the expensive version for a second before stepping down.
 */
export function initialTier(): PerfTier {
  if (typeof window === "undefined") return "full";

  try {
    const saved = localStorage.getItem(STORE);
    if (isTier(saved)) return saved;
  } catch {
    /* private mode / storage disabled — fall through to detection */
  }

  if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return "lite";

  const cores = navigator.hardwareConcurrency ?? 8;
  const mem = (navigator as unknown as { deviceMemory?: number }).deviceMemory;
  if (cores <= 4 || (typeof mem === "number" && mem <= 4)) return "reduced";
  return "full";
}

export function applyTier(tier: PerfTier) {
  if (typeof document === "undefined") return;
  // CSS keys off this attribute to drop backdrop-filter and grain.
  document.documentElement.dataset.perf = tier;
  try {
    localStorage.setItem(STORE, tier);
  } catch {
    /* not fatal: the tier still applies for this page view */
  }
}

/**
 * Watches frame pacing and reports when the current tier is not being met.
 *
 * Judged against the tier's own target rather than a fixed 60fps, so a capped
 * tier is not mistaken for a slow one. A window of frames is used because
 * isolated long frames are normal — a GC pause or a route transition should not
 * permanently downgrade the page.
 */
export function createPaceMonitor(targetFps: number, onStruggle: () => void) {
  const target = targetFps > 0 ? 1000 / targetFps : 0;
  // 1.5x target: comfortably past jitter, well short of "occasional hitch".
  const slowFrame = target * 1.5;
  const WINDOW = 90;
  const TRIGGER = 0.4; // fraction of the window that must be late

  let count = 0;
  let late = 0;
  let fired = false;

  return {
    /** Feed the interval since the previous frame, in ms. */
    sample(deltaMs: number) {
      if (fired || target <= 0) return;
      // Ignore the pause after a hidden tab or a long stall: those say nothing
      // about steady-state cost and would trigger a spurious downgrade.
      if (deltaMs > 500) return;
      count++;
      if (deltaMs > slowFrame) late++;
      if (count < WINDOW) return;
      if (late / count >= TRIGGER) {
        fired = true;
        onStruggle();
      }
      count = 0;
      late = 0;
    },
  };
}

// The signal that drives the backdrop's intensity, kept separate from the
// drawing so it can be measured against the photosensitivity thresholds.
//
// Why this is its own file: the first version fed each streamed token straight
// into the brightness of the whole field. Token arrival rate is an uncontrolled
// input — it can easily sit in the 3–30 Hz band that provokes photosensitive
// seizures, and the affected area is the entire viewport. Whether that crossed
// the WCAG 2.3.1 flash threshold depended on arithmetic about palette and
// compositing, which is far too thin a margin for a safety property.
//
// So intensity is split in two:
//
//   luma   — anything that changes how BRIGHT the page is. Slew-limited, so it
//            physically cannot swing faster than LUMA_SLEW per second no matter
//            what the token stream does. A full-range swing takes >3s (<0.16 Hz),
//            two orders of magnitude below the 3 Hz floor.
//   motion — orbit speed and breathing depth. Free to react quickly, because
//            geometry moving is not luminance flashing.
//
// The page still visibly answers to the model working; the reaction is carried
// by movement rather than by strobing the background.

export type AuroraState = "ambient" | "idle" | "thinking" | "responding" | "done";

// Resting intensity per state. Deliberately leaves headroom below 1: the old
// table peaked at 0.92 while responding, which pinned the signal against the
// clamp and left activity nothing to express. Lower peaks are also simply
// dimmer, which is the direction safety wants.
export const ENERGY: Record<AuroraState, number> = {
  ambient: 0.32,
  idle: 0.12,
  thinking: 0.52,
  responding: 0.62,
  done: 0.4,
};

/** Max change in the brightness signal per second. The safety guarantee. */
const LUMA_SLEW = 0.3;
/** How much token activity is allowed to brighten things at all. */
const ACTIVITY_LUMA = 0.1;
/** How much it may drive movement — free to be larger, it isn't brightness. */
const ACTIVITY_MOTION = 0.8;
/** Movement is unbounded by brightness concerns; this is just a sanity ceiling. */
const MOTION_CAP = 1.6;
/** Token-rate smoothing, seconds. Long, so bursty output reads as one level. */
const ACTIVITY_TAU = 1.1;
/** Token rate (per second) treated as "fully busy". */
const FULL_RATE = 14;
/** Ripples are capped well under the 3 Hz floor, and are small and faint. */
export const RIPPLE_MIN_GAP_MS = 420;
export const RIPPLE_ALPHA = 0.16;

export class AuroraDrive {
  private energy: number;
  private activity = 0; // smoothed token rate, 0..1
  private rate = 0; // decaying token counter
  private luma: number; // slew-limited brightness signal
  private lastRipple = -1e9;

  constructor(initial: AuroraState = "ambient") {
    this.energy = ENERGY[initial] ?? ENERGY.ambient;
    this.luma = this.energy;
  }

  /**
   * Advance one frame.
   * @param dt      seconds since the previous frame
   * @param state   what the model is doing now
   * @param tokens  tokens observed since the previous frame
   * @param now     monotonic ms, for ripple spacing
   */
  step(dt: number, state: AuroraState, tokens: number, now: number) {
    // Guard against a hidden tab or a debugger pause producing a huge dt, which
    // would let the slew limiter jump further than a frame should allow.
    const d = Math.min(Math.max(dt, 0), 0.1);

    const target = ENERGY[state] ?? ENERGY.ambient;
    // Time-based easing so behaviour doesn't change with refresh rate.
    this.energy += (target - this.energy) * (1 - Math.exp(-d / 0.37));

    // Token rate -> 0..1, heavily smoothed.
    this.rate = this.rate * Math.exp(-d / 0.5) + tokens;
    const inst = Math.min(1, this.rate / (FULL_RATE * 0.5));
    this.activity += (inst - this.activity) * (1 - Math.exp(-d / ACTIVITY_TAU));

    // Brightness: proposed value, then rate-limited on the way there.
    const want = Math.min(1, this.energy + this.activity * ACTIVITY_LUMA);
    const maxStep = LUMA_SLEW * d;
    const delta = want - this.luma;
    this.luma += Math.abs(delta) <= maxStep ? delta : Math.sign(delta) * maxStep;

    // Movement may exceed 1 — it scales orbit speed and breathing depth, not
    // opacity, so there's no brightness consequence to running it hotter.
    const motion = Math.min(MOTION_CAP, this.energy + this.activity * ACTIVITY_MOTION);

    let ripple = false;
    if (tokens > 0 && now - this.lastRipple >= RIPPLE_MIN_GAP_MS) {
      this.lastRipple = now;
      ripple = true;
    }
    return { luma: this.luma, motion, ripple };
  }
}

/** Orb alpha for a given brightness signal. Linear, so luma bounds alpha. */
export const orbAlpha = (luma: number, i: number) => (0.1 + luma * 0.3) * (i === 0 ? 1 : 0.85);

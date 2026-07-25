// Photosensitivity check for the animated backdrop.
//
// WCAG 2.3.1 (Level A): nothing may flash more than three times per second
// unless it stays under the general flash threshold. A "flash" is a pair of
// opposing changes in relative luminance of >=10% of maximum relative
// luminance, where the darker state is below 0.80. The threshold only applies
// to a large enough area (>25% of the central 10 degrees) — which our backdrop
// plainly is, so we get no relief there and must clear the flash test itself.
//
// This models the drive signal exactly and the resulting screen luminance
// approximately (stated below). The frequency figures are exact — they come
// from the drive signal, not from the photometry — so the headline safety claim
// does not rest on the luminance model being precise.

import { AuroraDrive, orbAlpha, ENERGY, type AuroraState } from "../app/auroraDrive";

const FPS = 60;
const DT = 1 / FPS;

/* --- luminance model ------------------------------------------------------
   The four orbs composite additively ("lighter") over #07080e, each drawn with
   a radial gradient, then the whole canvas is blurred and a scrim darkens the
   edges. Relative luminance of the palette (sRGB -> linear -> Rec.709):
     violet #8b7dff 0.274   mint #4fd3ac 0.512   blue #5a8dff 0.281
   Orbs 1 and 4 are violet, 2 mint, 3 blue. `COVER` is the share of the central
   field each contributes after the gradient falloff — deliberately generous, so
   the estimate errs high rather than flattering the result. */
const ORB_LUM = [0.274, 0.512, 0.281, 0.274];
const COVER = 0.45;
const BASE = 0.0035; // #07080e

function screenLuminance(luma: number): number {
  let L = BASE;
  for (let i = 0; i < 4; i++) L += orbAlpha(luma, i) * ORB_LUM[i] * COVER;
  return Math.min(1, L);
}

/* --- flash counting ------------------------------------------------------- */

/** Local extrema of a signal, used to find opposing luminance changes. */
function extrema(sig: number[]): { i: number; v: number }[] {
  const out: { i: number; v: number }[] = [];
  let dir = 0;
  let lastIdx = 0;
  for (let i = 1; i < sig.length; i++) {
    const d = Math.sign(sig[i] - sig[lastIdx]);
    if (d === 0) continue;
    if (dir === 0) dir = d;
    else if (d !== dir) {
      out.push({ i: lastIdx, v: sig[lastIdx] });
      dir = d;
    }
    lastIdx = i;
  }
  out.push({ i: sig.length - 1, v: sig[sig.length - 1] });
  return out;
}

/** Max WCAG flashes in any 1s window of a luminance series. */
function maxFlashesPerSecond(lum: number[]): number {
  const ext = extrema(lum);
  const events: number[] = []; // frame index of each qualifying transition
  for (let k = 1; k < ext.length; k++) {
    const a = ext[k - 1];
    const b = ext[k];
    const lo = Math.min(a.v, b.v);
    if (Math.abs(b.v - a.v) >= 0.1 && lo < 0.8) events.push(b.i);
  }
  // A flash is a PAIR of opposing changes, so two transitions = one flash.
  let worst = 0;
  for (let i = 0; i < events.length; i++) {
    let n = 0;
    for (let j = i; j < events.length && events[j] - events[i] < FPS; j++) n++;
    worst = Math.max(worst, Math.floor(n / 2));
  }
  return worst;
}

/** Peak-to-trough swing of the drive signal within any 1s window. */
function maxSwingPerSecond(sig: number[]): number {
  let worst = 0;
  for (let i = 0; i < sig.length; i++) {
    let lo = sig[i];
    let hi = sig[i];
    for (let j = i; j < sig.length && j - i < FPS; j++) {
      lo = Math.min(lo, sig[j]);
      hi = Math.max(hi, sig[j]);
    }
    worst = Math.max(worst, hi - lo);
  }
  return worst;
}

/** Mean rate of direction changes per second — how fast the field modulates. */
function modulationHz(sig: number[], minAmp = 0.004): number {
  const ext = extrema(sig).filter((_, k, a) => k === 0 || Math.abs(a[k].v - a[k - 1].v) >= minAmp);
  if (ext.length < 2) return 0;
  const span = (ext[ext.length - 1].i - ext[0].i) / FPS;
  return span > 0 ? (ext.length - 1) / 2 / span : 0; // two extrema per cycle
}

/* --- the drive as originally shipped, for comparison ----------------------
   ENERGY.responding was 0.92 in that version; pinned here so the comparison
   stays historically accurate as the current table changes. */
const LEGACY_RESPONDING = 0.92;
const LEGACY_THINKING = 0.66;
function legacyRun(tokensPerSec: number, seconds: number, base = LEGACY_RESPONDING) {
  let energy = base;
  let kick = 0;
  const luma: number[] = [];
  let carry = 0;
  for (let f = 0; f < seconds * FPS; f++) {
    carry += tokensPerSec / FPS;
    const tokens = Math.floor(carry);
    carry -= tokens;
    energy += (base - energy) * 0.045;
    if (tokens > 0) kick = Math.min(1, kick + 0.35);
    kick *= 0.93;
    luma.push(Math.min(1, energy + kick * 0.5));
  }
  return luma;
}

/* --- the drive as it stands now -------------------------------------------- */
function currentRun(tokensPerSec: number, seconds: number, state: AuroraState = "responding") {
  const d = new AuroraDrive(state);
  const luma: number[] = [];
  const motion: number[] = [];
  let ripples = 0;
  let carry = 0;
  for (let f = 0; f < seconds * FPS; f++) {
    carry += tokensPerSec / FPS;
    const tokens = Math.floor(carry);
    carry -= tokens;
    const r = d.step(DT, state, tokens, (f / FPS) * 1000);
    luma.push(r.luma);
    motion.push(r.motion);
    if (r.ripple) ripples++;
  }
  return { luma, motion, ripples };
}

/* --- report ---------------------------------------------------------------- */

const RATES = [1, 3, 5, 8, 10, 12, 15, 20, 25, 30, 45, 60];
let fail = 0;
const rows: string[] = [];

rows.push("token/s │      LEGACY: swing   Hz  flash/s │     CURRENT: swing   Hz  flash/s  ripple/s");
rows.push("────────┼─────────────────────────────────┼──────────────────────────────────────────");

for (const rate of RATES) {
  const legacy = legacyRun(rate, 8);
  const legacyLum = legacy.map(screenLuminance);
  const legacySwing = maxSwingPerSecond(legacy);
  const legacyFlash = maxFlashesPerSecond(legacyLum);

  const cur = currentRun(rate, 8);
  const curLum = cur.luma.map(screenLuminance);
  const curSwing = maxSwingPerSecond(cur.luma);
  const curFlash = maxFlashesPerSecond(curLum);
  const ripplePerSec = cur.ripples / 8;

  const legacyHz = modulationHz(legacy);
  const curHz = modulationHz(cur.luma);
  rows.push(
    `${String(rate).padStart(7)} │ ${legacySwing.toFixed(3).padStart(18)} ${legacyHz.toFixed(1).padStart(4)} ${String(legacyFlash).padStart(8)} │ ` +
      `${curSwing.toFixed(3).padStart(17)} ${curHz.toFixed(1).padStart(4)} ${String(curFlash).padStart(8)} ${ripplePerSec.toFixed(2).padStart(9)}`
  );
  if (curHz > 3) { console.error(`FAIL: ${rate} tok/s modulates brightness at ${curHz.toFixed(1)} Hz`); fail++; }

  // Hard requirements on the shipped drive.
  if (curFlash > 0) { console.error(`FAIL: ${rate} tok/s produces ${curFlash} WCAG flashes/s`); fail++; }
  if (curSwing > 0.31) { console.error(`FAIL: ${rate} tok/s swings ${curSwing.toFixed(3)}/s, above the slew limit`); fail++; }
  if (ripplePerSec > 3) { console.error(`FAIL: ${rate} tok/s spawns ${ripplePerSec}/s ripples, over the 3 Hz floor`); fail++; }
}

console.log(rows.join("\n"));

// The legacy `responding` figures above look calm only because the signal was
// overdriven into the clamp and sat pinned at 1.0. `thinking` had headroom, so
// that is where the token-rate modulation actually showed. This is the case the
// rewrite exists to remove.
{
  const out: string[] = ["\nLEGACY in `thinking` (0.66 base — headroom below the clamp):", "token/s │  swing     Hz  flash/s"];
  for (const rate of [5, 10, 15, 20, 30]) {
    const sig = legacyRun(rate, 8, LEGACY_THINKING);
    const lum = sig.map(screenLuminance);
    out.push(`${String(rate).padStart(7)} │ ${maxSwingPerSecond(sig).toFixed(3)} ${modulationHz(sig).toFixed(1).padStart(6)} ${String(maxFlashesPerSecond(lum)).padStart(8)}`);
  }
  console.log(out.join("\n"));
}

// Bursty traffic: alternating idle and flat-out, the worst case for a smoother.
{
  const d = new AuroraDrive("responding");
  const luma: number[] = [];
  for (let f = 0; f < 8 * FPS; f++) {
    const burst = Math.floor(f / 6) % 2 === 0; // toggle every 100ms
    const r = d.step(DT, "responding", burst ? 2 : 0, (f / FPS) * 1000);
    luma.push(r.luma);
  }
  const swing = maxSwingPerSecond(luma);
  const flash = maxFlashesPerSecond(luma.map(screenLuminance));
  console.log(`\nbursty 10 Hz on/off: swing ${swing.toFixed(3)}/s, ${flash} flashes/s`);
  if (flash > 0 || swing > 0.31) { console.error("FAIL: bursty traffic"); fail++; }
}

// State transitions, the other thing that moves brightness.
{
  const d = new AuroraDrive("idle");
  const luma: number[] = [];
  const seq: AuroraState[] = ["idle", "thinking", "responding", "done", "idle"];
  for (let s = 0; s < seq.length; s++)
    for (let f = 0; f < 1.2 * FPS; f++) luma.push(d.step(DT, seq[s], 0, (s * 1.2 + f / FPS) * 1000).luma);
  const swing = maxSwingPerSecond(luma);
  const flash = maxFlashesPerSecond(luma.map(screenLuminance));
  console.log(`idle->thinking->responding->done->idle: swing ${swing.toFixed(3)}/s, ${flash} flashes/s`);
  if (flash > 0 || swing > 0.31) { console.error("FAIL: state transitions"); fail++; }
}

// The reaction must survive all this, or the fix is just "turn it off".
{
  const quiet = currentRun(0, 6).motion.at(-1)!;
  const busy = currentRun(20, 6).motion.at(-1)!;
  console.log(`\nmotion response: quiet ${quiet.toFixed(3)} -> busy ${busy.toFixed(3)} (+${((busy / quiet - 1) * 100).toFixed(0)}%)`);
  if (busy - quiet < 0.2) { console.error("FAIL: backdrop no longer reacts to output"); fail++; }
}

const peakLum = screenLuminance(1);
console.log(`\npeak modelled screen luminance: ${peakLum.toFixed(3)} (flash threshold needs a 0.100 swing)`);
console.log(fail ? `\n${fail} FAILED` : "\nall photosensitivity checks passed");
process.exit(fail ? 1 : 0);

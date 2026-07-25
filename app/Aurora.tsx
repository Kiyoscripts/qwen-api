"use client";

import { useEffect, useRef } from "react";

/**
 * The animated backdrop used on every page.
 *
 * Four soft light bodies drift on slow orbits over a curtain sweep. Two inputs
 * drive it:
 *   - `state` — how alive the scene is. `ambient` is the resting look for normal
 *     pages; /chat and /playground swap through the others as the model works.
 *   - `pulseRef` — a plain counter a caller bumps per streamed token. The loop
 *     diffs it each frame and answers with an energy kick plus a ripple, so
 *     output rate is visible without re-rendering React.
 *
 * Cheap by construction: the scene is drawn at 1/4 resolution into a small
 * canvas and the compositor blurs it, so pixel cost is a fraction of full-res
 * and the blur is free. Nothing is allocated per frame past the ripple list.
 */
export type AuroraState = "ambient" | "idle" | "thinking" | "responding" | "done";

const DOWN = 4; // render scale divisor
const MAX_RIPPLES = 12;

// Energy each state settles at. Energy drives brightness, orbit speed and spread.
const ENERGY: Record<AuroraState, number> = {
  ambient: 0.32,
  idle: 0.1,
  thinking: 0.66,
  responding: 0.92,
  done: 0.42,
};

type Rgb = readonly [number, number, number];

const VIOLET: Rgb = [139, 125, 255];
const MINT: Rgb = [79, 211, 172];
const BLUE: Rgb = [90, 141, 255];

interface Orb {
  c: Rgb;
  /** anchor, in fractions of the viewport */
  ax: number;
  ay: number;
  /** orbit radii, in fractions of the viewport */
  ox: number;
  oy: number;
  /** radius as a fraction of the larger viewport edge */
  r: number;
  /** angular speed (rad/ms) and starting phase */
  sp: number;
  ph: number;
}

const ORBS: Orb[] = [
  { c: VIOLET, ax: 0.2, ay: 0.2, ox: 0.1, oy: 0.08, r: 0.42, sp: 0.00013, ph: 0 },
  { c: MINT, ax: 0.82, ay: 0.3, ox: 0.09, oy: 0.12, r: 0.34, sp: -0.00017, ph: 1.7 },
  { c: BLUE, ax: 0.56, ay: 0.86, ox: 0.13, oy: 0.07, r: 0.4, sp: 0.00011, ph: 3.1 },
  { c: VIOLET, ax: 0.08, ay: 0.82, ox: 0.07, oy: 0.09, r: 0.27, sp: -0.00009, ph: 4.5 },
];

interface Ripple {
  x: number;
  y: number;
  born: number;
  c: Rgb;
}

const rgba = (c: Rgb, a: number) => `rgba(${c[0]},${c[1]},${c[2]},${a})`;

export default function Aurora({
  state = "ambient",
  pulseRef,
}: {
  state?: AuroraState;
  pulseRef?: React.MutableRefObject<number>;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const stateRef = useRef<AuroraState>(state);
  stateRef.current = state;

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;

    const still = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    let w = 0;
    let h = 0;
    const resize = () => {
      w = Math.max(1, Math.round(window.innerWidth / DOWN));
      h = Math.max(1, Math.round(window.innerHeight / DOWN));
      canvas.width = w;
      canvas.height = h;
    };
    resize();
    window.addEventListener("resize", resize);

    // Pointer parallax: the scene leans a little towards the cursor.
    let mx = 0.5;
    let my = 0.5;
    let px = 0.5;
    let py = 0.5;
    const onMove = (e: PointerEvent) => {
      mx = e.clientX / window.innerWidth;
      my = e.clientY / window.innerHeight;
    };
    if (!still) window.addEventListener("pointermove", onMove, { passive: true });

    // Pause entirely when the tab is hidden — no point burning frames.
    let hidden = document.hidden;
    const onVis = () => {
      hidden = document.hidden;
      if (!hidden && !still) raf = requestAnimationFrame(draw);
    };
    document.addEventListener("visibilitychange", onVis);

    let energy = ENERGY[state] ?? ENERGY.ambient;
    let kick = 0; // short-lived boost, one per token
    let seenPulse = pulseRef?.current ?? 0;
    let lastRipple = 0;
    const ripples: Ripple[] = [];
    let raf = 0;

    const draw = (t: number) => {
      if (hidden) return; // resumes from visibilitychange
      const S = Math.max(w, h);

      // --- drive ------------------------------------------------------------
      const target = ENERGY[stateRef.current] ?? ENERGY.ambient;
      energy += (target - energy) * 0.045;

      const pulse = pulseRef?.current ?? 0;
      if (pulse !== seenPulse) {
        seenPulse = pulse;
        kick = Math.min(1, kick + 0.35);
        if (t - lastRipple > 110 && ripples.length < MAX_RIPPLES) {
          lastRipple = t;
          const o = ORBS[(Math.random() * ORBS.length) | 0];
          ripples.push({
            x: (o.ax + (Math.random() - 0.5) * 0.3) * w,
            y: (o.ay + (Math.random() - 0.5) * 0.3) * h,
            born: t,
            c: o.c,
          });
        }
      }
      kick *= 0.93;

      px += (mx - px) * 0.05;
      py += (my - py) * 0.05;

      const live = Math.min(1, energy + kick * 0.5);

      // --- scene ------------------------------------------------------------
      ctx.globalCompositeOperation = "source-over";
      ctx.fillStyle = "#07080e";
      ctx.fillRect(0, 0, w, h);
      ctx.globalCompositeOperation = "lighter";

      const shiftX = (px - 0.5) * 0.05 * w;
      const shiftY = (py - 0.5) * 0.05 * h;

      for (let i = 0; i < ORBS.length; i++) {
        const o = ORBS[i];
        // Orbit speeds up with energy; the bodies also drift outward as it rises.
        const a = o.ph + t * o.sp * (0.5 + live * 2.6);
        const spread = 1 + live * 0.35;
        const x = o.ax * w + Math.cos(a) * o.ox * w * spread + shiftX;
        const y = o.ay * h + Math.sin(a) * o.oy * h * spread + shiftY;

        // Each body breathes on its own phase — much harder while the model is
        // working, so the whole field visibly beats.
        const breathe = 1 + Math.sin(t * 0.0011 + o.ph * 2) * (0.05 + live * 0.16);
        const r = o.r * S * breathe;
        const alpha = (0.1 + live * 0.3) * (i === 0 ? 1 : 0.85);

        const g = ctx.createRadialGradient(x, y, 0, x, y, r);
        g.addColorStop(0, rgba(o.c, alpha));
        g.addColorStop(0.45, rgba(o.c, alpha * 0.38));
        g.addColorStop(1, rgba(o.c, 0));
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(x, y, r, 0, Math.PI * 2);
        ctx.fill();
      }

      // Curtain: a wide soft band sweeping across. Reads as an aurora sheet once
      // the blur lands on it.
      if (live > 0.22) {
        const band = (live - 0.22) / 0.78;
        const cx = ((Math.sin(t * 0.00019) + 1) / 2) * w;
        const bw = w * 0.5;
        const g = ctx.createLinearGradient(cx - bw, 0, cx + bw, h);
        g.addColorStop(0, rgba(MINT, 0));
        g.addColorStop(0.5, rgba(MINT, 0.1 * band));
        g.addColorStop(1, rgba(MINT, 0));
        ctx.fillStyle = g;
        ctx.fillRect(0, 0, w, h);
      }

      // Token ripples: one expanding halo per streamed chunk.
      for (let i = ripples.length - 1; i >= 0; i--) {
        const rp = ripples[i];
        const age = (t - rp.born) / 1500;
        if (age >= 1) {
          ripples.splice(i, 1);
          continue;
        }
        const rad = age * S * 0.3;
        const a = (1 - age) * (1 - age) * 0.34;
        ctx.strokeStyle = rgba(rp.c, a);
        ctx.lineWidth = 3 + (1 - age) * 5;
        ctx.beginPath();
        ctx.arc(rp.x, rp.y, rad, 0, Math.PI * 2);
        ctx.stroke();
      }

      if (!still) raf = requestAnimationFrame(draw);
    };

    if (still) {
      draw(0); // one frame at rest, then leave it alone
    } else {
      raf = requestAnimationFrame(draw);
    }

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", resize);
      window.removeEventListener("pointermove", onMove);
      document.removeEventListener("visibilitychange", onVis);
    };
    // `state` is read through stateRef; it is only here to seed the first frame.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pulseRef]);

  return (
    <div className={`amb state-${state}`} aria-hidden="true">
      <canvas ref={canvasRef} />
      <div className="amb-grain" />
    </div>
  );
}

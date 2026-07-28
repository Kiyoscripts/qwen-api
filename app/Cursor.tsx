"use client";

import { useEffect, useRef, useState } from "react";

/**
 * Custom cursor: a ring that trails the pointer with a dot riding exactly on it.
 *
 * Everything happens on refs inside one requestAnimationFrame loop — no React
 * state, so pointer movement never re-renders the tree. Three things keep it at
 * 60fps that are easy to get wrong:
 *
 *   1. Both nodes are written ONCE PER FRAME, never from the pointer handler.
 *      Pointer events fire faster than frames (and coalesce higher still on a
 *      120Hz trackpad); writing `style.transform` from the handler forces style
 *      recalculation off-frame and throws most of that work away.
 *   2. `will-change: transform` promotes both nodes to their own compositor
 *      layer, so moving them never repaints the page underneath.
 *   3. Hover state is recomputed only when the pointer moves onto a DIFFERENT
 *      element. `closest()` walks up the DOM, and doing it twice per event was
 *      the single most expensive thing here.
 *
 * The trail is time-based rather than per-frame, so it converges at the same
 * rate on a 60Hz and a 120Hz display instead of feeling twice as fast on one.
 *
 * Only ever installed for a fine pointer. Touch keeps the native behaviour, and
 * nothing here is load-bearing — the `cursor: none` rule is gated behind the
 * class this sets, so if the effect never runs the system cursor is still there.
 */

const INTERACTIVE = "a,button,select,summary,[role=button],[role=option],label.c-icon-btn,label.pgx-attach";
const TEXTUAL = "input:not([type=checkbox]):not([type=file]),textarea,[contenteditable=true]";

/** Seconds for the ring to close most of the gap. Lower = tighter to the pointer. */
const TRAIL_TAU = 0.045;

export default function Cursor() {
  const ringRef = useRef<HTMLDivElement>(null);
  const dotRef = useRef<HTMLDivElement>(null);
  // Re-runs the effect when the toggle flips, so turning it off tears the loop
  // and its listeners down rather than leaving them running invisibly.
  const [enabled, setEnabled] = useState(true);

  useEffect(() => {
    const read = () => setEnabled(document.documentElement.getAttribute("data-cursor") !== "off");
    read();
    const obs = new MutationObserver(read);
    obs.observe(document.documentElement, { attributes: true, attributeFilter: ["data-cursor"] });
    return () => obs.disconnect();
  }, []);

  useEffect(() => {
    if (!enabled) return;
    const ring = ringRef.current;
    const dot = dotRef.current;
    if (!ring || !dot) return;
    // Coarse pointers have nothing to track, and a no-hover device would be left
    // with an unreachable UI if the native cursor were hidden.
    if (!window.matchMedia("(pointer: fine)").matches) return;

    const root = document.documentElement;
    root.classList.add("has-cursor");

    const still = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    let x = window.innerWidth / 2;
    let y = window.innerHeight / 2;
    let rx = x;
    let ry = y;
    let shown = false;
    let raf = 0;
    let last = 0;
    // Only the pointer position is touched by the event; everything else waits
    // for the frame.
    let lastTarget: Element | null = null;

    const onMove = (e: PointerEvent) => {
      x = e.clientX;
      y = e.clientY;

      if (!shown) {
        shown = true;
        ring.classList.remove("hide");
        dot.classList.remove("hide");
      }

      // closest() walks ancestors; skip it entirely while the pointer stays over
      // the same element, which is the overwhelming majority of events.
      const el = e.target instanceof Element ? e.target : null;
      if (el !== lastTarget) {
        lastTarget = el;
        const textual = Boolean(el?.closest(TEXTUAL));
        ring.classList.toggle("text", textual);
        ring.classList.toggle("link", !textual && Boolean(el?.closest(INTERACTIVE)));
      }
    };

    const hide = () => {
      shown = false;
      ring.classList.add("hide");
      dot.classList.add("hide");
    };
    const down = () => ring.classList.add("down");
    const up = () => ring.classList.remove("down");

    const tick = (t: number) => {
      const dt = last ? Math.min((t - last) / 1000, 0.05) : 1 / 60;
      last = t;

      // Frame-rate independent easing: the same time constant on any display.
      const k = still ? 1 : 1 - Math.exp(-dt / TRAIL_TAU);
      rx += (x - rx) * k;
      ry += (y - ry) * k;

      // Both writes in the same frame, after all input for it has arrived.
      ring.style.transform = `translate3d(${rx}px, ${ry}px, 0)`;
      dot.style.transform = `translate3d(${x}px, ${y}px, 0)`;

      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);

    window.addEventListener("pointermove", onMove, { passive: true });
    window.addEventListener("pointerdown", down, { passive: true });
    window.addEventListener("pointerup", up, { passive: true });
    window.addEventListener("blur", up);
    document.addEventListener("mouseleave", hide);

    return () => {
      cancelAnimationFrame(raf);
      root.classList.remove("has-cursor");
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerdown", down);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("blur", up);
      document.removeEventListener("mouseleave", hide);
    };
  }, [enabled]);

  if (!enabled) return null;
  return (
    <>
      <div ref={ringRef} className="cur-ring hide" aria-hidden="true"><i /></div>
      <div ref={dotRef} className="cur-dot hide" aria-hidden="true" />
    </>
  );
}

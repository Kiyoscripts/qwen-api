"use client";

import { useEffect, useRef } from "react";

/**
 * Custom cursor: a ring that trails the pointer with a dot riding exactly on it.
 *
 * Three reactions:
 *   - press-and-hold  → the ring shrinks under your finger
 *   - interactive     → the ring opens up and picks up the mint accent
 *   - text field      → the ring collapses into a caret bar
 *
 * Only ever installed for a fine pointer (mouse/trackpad). Touch and pen keep
 * the native behaviour, and nothing here is load-bearing — if the effect never
 * runs, the system cursor is still visible because the `cursor: none` rule is
 * gated behind the class this sets.
 */

const INTERACTIVE = "a,button,select,summary,[role=button],[role=option],label.c-icon-btn,label.pgx-attach";
const TEXTUAL = "input:not([type=checkbox]):not([type=file]),textarea,[contenteditable=true]";

export default function Cursor() {
  const ringRef = useRef<HTMLDivElement>(null);
  const dotRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const ring = ringRef.current;
    const dot = dotRef.current;
    if (!ring || !dot) return;
    // Coarse pointers (touch) have nothing to track, and no-hover devices would
    // be left with an unreachable UI if we hid the native cursor.
    if (!window.matchMedia("(pointer: fine)").matches) return;

    const root = document.documentElement;
    root.classList.add("has-cursor");

    // With reduced motion the ring rides the pointer exactly instead of trailing.
    const still = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const ease = still ? 1 : 0.22;

    let x = window.innerWidth / 2;
    let y = window.innerHeight / 2;
    let rx = x;
    let ry = y;
    let shown = false;
    let raf = 0;

    const onMove = (e: PointerEvent) => {
      x = e.clientX;
      y = e.clientY;
      dot.style.transform = `translate3d(${x}px, ${y}px, 0)`;
      if (!shown) {
        shown = true;
        ring.classList.remove("hide");
        dot.classList.remove("hide");
      }
      const el = e.target instanceof Element ? e.target : null;
      ring.classList.toggle("text", Boolean(el?.closest(TEXTUAL)));
      ring.classList.toggle("link", Boolean(el?.closest(INTERACTIVE)) && !el?.closest(TEXTUAL));
    };

    const hide = () => {
      shown = false;
      ring.classList.add("hide");
      dot.classList.add("hide");
    };
    const down = () => ring.classList.add("down");
    const up = () => ring.classList.remove("down");

    const tick = () => {
      rx += (x - rx) * ease;
      ry += (y - ry) * ease;
      ring.style.transform = `translate3d(${rx}px, ${ry}px, 0)`;
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);

    window.addEventListener("pointermove", onMove, { passive: true });
    window.addEventListener("pointerdown", down);
    window.addEventListener("pointerup", up);
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
  }, []);

  return (
    <>
      <div ref={ringRef} className="cur-ring hide" aria-hidden="true"><i /></div>
      <div ref={dotRef} className="cur-dot hide" aria-hidden="true" />
    </>
  );
}

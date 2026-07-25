"use client";

import { useEffect } from "react";

/**
 * Drives the specular highlight on every `.glass` surface from the pointer.
 *
 * One document-level listener and one rAF loop for the whole page, rather than
 * a handler per card: with dozens of glass surfaces, per-element listeners are
 * what turns a nice effect into a scroll stutter.
 *
 * It writes two custom properties (`--mx`, `--my`) on the hovered surface only.
 * Custom properties used solely inside a `background` gradient repaint that one
 * element — no layout, no reflow of anything around it.
 */
export default function Sheen() {
  useEffect(() => {
    if (!window.matchMedia("(pointer: fine)").matches) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    let target: HTMLElement | null = null;
    let px = 0;
    let py = 0;
    let queued = false;

    const paint = () => {
      queued = false;
      if (!target) return;
      const r = target.getBoundingClientRect();
      if (!r.width || !r.height) return;
      target.style.setProperty("--mx", `${((px - r.left) / r.width) * 100}%`);
      target.style.setProperty("--my", `${((py - r.top) / r.height) * 100}%`);
    };

    const onMove = (e: PointerEvent) => {
      px = e.clientX;
      py = e.clientY;

      const el = e.target instanceof Element ? (e.target.closest(".glass") as HTMLElement | null) : null;
      if (el !== target) {
        // Leave the previous surface at its resting highlight rather than
        // stranding it wherever the pointer happened to exit.
        target?.style.removeProperty("--mx");
        target?.style.removeProperty("--my");
        target = el;
      }
      if (!target || queued) return;
      queued = true;
      requestAnimationFrame(paint);
    };

    document.addEventListener("pointermove", onMove, { passive: true });
    return () => {
      document.removeEventListener("pointermove", onMove);
      target?.style.removeProperty("--mx");
      target?.style.removeProperty("--my");
    };
  }, []);

  return null;
}

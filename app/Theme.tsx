"use client";

import { useEffect, useState } from "react";
import { Circle, Drop, Sun } from "@phosphor-icons/react";

export type ThemeName = "midnight" | "daylight" | "contrast";

const THEMES: { id: ThemeName; label: string; hint: string; icon: React.ReactNode }[] = [
  { id: "midnight", label: "Midnight", hint: "Dark liquid glass", icon: <Drop size={15} weight="fill" /> },
  { id: "daylight", label: "Daylight", hint: "Light liquid glass", icon: <Sun size={15} weight="fill" /> },
  { id: "contrast", label: "Contrast", hint: "High contrast, no blur", icon: <Circle size={15} weight="fill" /> },
];

const STORE = "qwen_theme";

/** Applied before paint by the inline script in layout.tsx; kept in sync here. */
function apply(t: ThemeName) {
  document.documentElement.setAttribute("data-theme", t);
  try {
    localStorage.setItem(STORE, t);
  } catch {
    /* private mode */
  }
}

export default function ThemeSwitcher({ compact }: { compact?: boolean }) {
  // `null` until mounted: the server has no idea which theme is stored, and
  // rendering a guess would flash the wrong pill and mismatch on hydration.
  const [theme, setTheme] = useState<ThemeName | null>(null);

  useEffect(() => {
    const stored = (document.documentElement.getAttribute("data-theme") as ThemeName) || "midnight";
    setTheme(stored);
  }, []);

  function pick(t: ThemeName) {
    setTheme(t);
    apply(t);
  }

  return (
    <div className={`themesw ${compact ? "compact" : ""}`} role="radiogroup" aria-label="Colour theme">
      {THEMES.map((t) => {
        const on = theme === t.id;
        return (
          <button
            key={t.id}
            role="radio"
            aria-checked={on}
            aria-label={`${t.label} — ${t.hint}`}
            title={`${t.label} · ${t.hint}`}
            className={`themesw-opt ${on ? "on" : ""}`}
            onClick={() => pick(t.id)}
          >
            {/* The moving pill is a sibling that translates, so switching never
                animates layout — only transform and opacity. */}
            <span className="themesw-ic">{t.icon}</span>
            {!compact && <span className="themesw-label">{t.label}</span>}
          </button>
        );
      })}
      <span className={`themesw-pill i${theme ? THEMES.findIndex((t) => t.id === theme) : 0}`} aria-hidden="true" />
    </div>
  );
}

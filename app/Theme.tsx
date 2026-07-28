"use client";

import { useEffect, useState } from "react";
import { Circle, Drop, Sun } from "@phosphor-icons/react";
import { useT } from "./I18n";
import type { Dict } from "@/lib/i18n";

export type ThemeName = "midnight" | "daylight" | "contrast";

// label/hint are translation KEYS, resolved at render — typing them as keyof
// Dict makes a stale key a compile error rather than a silent English string.
const THEMES: { id: ThemeName; label: keyof Dict; hint: keyof Dict; icon: React.ReactNode }[] = [
  { id: "midnight", label: "theme_midnight", hint: "theme_midnight_hint", icon: <Drop size={15} weight="fill" /> },
  { id: "daylight", label: "theme_daylight", hint: "theme_daylight_hint", icon: <Sun size={15} weight="fill" /> },
  { id: "contrast", label: "theme_contrast", hint: "theme_contrast_hint", icon: <Circle size={15} weight="fill" /> },
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
  const t = useT();
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
    <div className={`themesw ${compact ? "compact" : ""}`} role="radiogroup" aria-label={t("nav_theme")}>
      {THEMES.map((th) => {
        const on = theme === th.id;
        return (
          <button
            key={th.id}
            role="radio"
            aria-checked={on}
            aria-label={`${t(th.label)} — ${t(th.hint)}`}
            title={`${t(th.label)} · ${t(th.hint)}`}
            className={`themesw-opt ${on ? "on" : ""}`}
            onClick={() => pick(th.id)}
          >
            {/* The moving pill is a sibling that translates, so switching never
                animates layout — only transform and opacity. */}
            <span className="themesw-ic">{th.icon}</span>
            {!compact && <span className="themesw-label">{t(th.label)}</span>}
          </button>
        );
      })}
      <span className={`themesw-pill i${theme ? THEMES.findIndex((t) => t.id === theme) : 0}`} aria-hidden="true" />
    </div>
  );
}

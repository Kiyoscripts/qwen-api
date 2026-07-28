"use client";

import { useEffect, useState } from "react";
import { Cursor as CursorIcon } from "@phosphor-icons/react";
import { useT } from "./I18n";

export const CURSOR_STORE = "qwen_cursor";

/**
 * Whether the custom cursor is on. Defaults to ON — an unset key means "not
 * chosen yet", which is different from having chosen off, so only the explicit
 * string "off" disables it.
 */
export function cursorEnabled(): boolean {
  try {
    return localStorage.getItem(CURSOR_STORE) !== "off";
  } catch {
    return true; // private mode: fall back to the default rather than off
  }
}

function apply(on: boolean) {
  // The Cursor component watches this attribute, and the pre-paint script in
  // layout.tsx sets it before first paint so the native cursor never flashes.
  document.documentElement.setAttribute("data-cursor", on ? "on" : "off");
  try {
    localStorage.setItem(CURSOR_STORE, on ? "on" : "off");
  } catch {
    /* private mode: the choice applies for this page view only */
  }
}

export default function CursorToggle({ compact }: { compact?: boolean }) {
  const t = useT();
  // `null` until mounted, matching ThemeSwitcher: the server cannot know the
  // stored value, and guessing would mismatch on hydration.
  const [on, setOn] = useState<boolean | null>(null);

  useEffect(() => {
    setOn(document.documentElement.getAttribute("data-cursor") !== "off");
  }, []);

  function toggle() {
    const next = !(on ?? true);
    setOn(next);
    apply(next);
  }

  const active = on ?? true;
  return (
    <button
      type="button"
      role="switch"
      aria-checked={active}
      aria-label={t("nav_cursor")}
      title={active ? "Custom cursor on — click to use the system cursor" : "Custom cursor off — click to turn it on"}
      className={`curtog ${active ? "on" : ""} ${compact ? "compact" : ""}`}
      onClick={toggle}
    >
      <CursorIcon size={15} weight={active ? "fill" : "regular"} />
      {!compact && <span>{t("cursor_short")}</span>}
    </button>
  );
}

"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Globe, Check } from "@phosphor-icons/react";
import { LOCALES, LOCALE_COOKIE, LOCALE_STORE, dirFor, localeMeta, type LocaleCode } from "@/lib/i18n";
import { useLocale } from "./I18n";

/**
 * Language picker.
 *
 * Writing the cookie is what actually changes the language: the pages that
 * matter are server-rendered, so the choice has to reach the server. router
 * .refresh() then re-renders them in place — a full reload would work too, but
 * would throw away chat state on the pages where it is most annoying to lose.
 *
 * localStorage and the <html> attributes are updated at the same time so the
 * pre-paint script can set lang/dir on the next load without waiting for React.
 */
export default function LanguageSelector({ compact }: { compact?: boolean }) {
  const current = useLocale();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("pointerdown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  function pick(code: LocaleCode) {
    setOpen(false);
    if (code === current) return;

    // One year, site-wide, Lax: it is a display preference, not a credential.
    document.cookie = `${LOCALE_COOKIE}=${code}; path=/; max-age=31536000; samesite=lax`;
    try {
      localStorage.setItem(LOCALE_STORE, code);
    } catch {
      /* private mode: the cookie still carries the choice */
    }
    // Flip immediately so RTL does not wait for the server round trip.
    document.documentElement.lang = code;
    document.documentElement.dir = dirFor(code);
    router.refresh();
  }

  const meta = localeMeta(current);

  return (
    <div className={`langsel ${compact ? "compact" : ""}`} ref={wrapRef}>
      <button
        type="button"
        className="langsel-btn"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label="Language"
        title={`Language — ${meta.english}`}
        onClick={() => setOpen((v) => !v)}
      >
        <Globe size={15} weight="regular" />
        {!compact && <span>{meta.native}</span>}
      </button>

      {open && (
        <ul className="langsel-menu glass" role="listbox" aria-label="Language">
          {LOCALES.map((l) => {
            const on = l.code === current;
            return (
              <li key={l.code}>
                <button
                  type="button"
                  role="option"
                  aria-selected={on}
                  className={`langsel-opt ${on ? "on" : ""}`}
                  onClick={() => pick(l.code)}
                  // The entry is written in its own language, so it stays
                  // readable regardless of the page's current direction.
                  dir={l.dir}
                  lang={l.code}
                >
                  <span className="langsel-native">{l.native}</span>
                  <span className="langsel-en">{l.english}</span>
                  {on && <Check size={13} weight="bold" />}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

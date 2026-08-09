"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Sun, Moon, List, X, Translate, Check } from "@phosphor-icons/react";
import { useT } from "../I18n";
import { LOCALES } from "@/lib/i18n";
import { avatarUrl, type Me } from "../Account";

/**
 * The shell nav.
 *
 * Everything the old header carried is here: routes, theme, language and
 * account. What is gone is the glass and the aurora behind it, which is the
 * point of the redesign rather than an omission.
 *
 * One line at desktop, 64px tall, and it never wraps: the route labels are
 * short enough that adding one more would be the thing to reconsider, not the
 * height.
 */

const ROUTES = [
  { href: "/models", key: "nav_models" },
  { href: "/playground", key: "nav_playground" },
  { href: "/chat", key: "nav_chat" },
  { href: "/docs", key: "nav_docs" },
] as const;

function Mark() {
  return (
    <Link href="/" className="group flex items-center gap-2.5">
      <span
        className="grid size-6 place-items-center bg-ink text-[var(--paper)] transition-colors
                   duration-200 group-hover:bg-signal group-hover:text-[var(--on-signal)]"
        style={{ borderRadius: "var(--r-sm)" }}
        aria-hidden
      >
        <span className="font-mono text-[13px] font-medium leading-none">S</span>
      </span>
      <span className="font-mono text-[13px] font-medium tracking-tight text-ink">syde</span>
    </Link>
  );
}

export function Nav() {
  const t = useT();
  const path = usePathname();
  const [dark, setDark] = useState(false);
  const [menu, setMenu] = useState(false);
  const [langOpen, setLangOpen] = useState(false);
  const [me, setMe] = useState<Me | null | undefined>(undefined);

  useEffect(() => {
    const stored = localStorage.getItem("theme");
    const prefers = window.matchMedia("(prefers-color-scheme: dark)").matches;
    const isDark = stored ? stored === "dark" : prefers;
    setDark(isDark);
    document.documentElement.dataset.theme = isDark ? "dark" : "light";
  }, []);

  useEffect(() => {
    let live = true;
    fetch("/api/auth/me")
      .then((r) => (r.ok ? r.json() : { user: null }))
      .then((j) => live && setMe(j.user ?? null))
      .catch(() => live && setMe(null));
    return () => {
      live = false;
    };
  }, []);

  useEffect(() => {
    setMenu(false);
    setLangOpen(false);
  }, [path]);

  const toggleTheme = () => {
    const next = !dark;
    setDark(next);
    document.documentElement.dataset.theme = next ? "dark" : "light";
    localStorage.setItem("theme", next ? "dark" : "light");
  };

  const setLocale = (code: string) => {
    document.cookie = `locale=${code}; path=/; max-age=31536000; samesite=lax`;
    window.location.reload();
  };

  return (
    <header className="sticky top-0 z-40 border-b border-rule bg-[var(--paper)]">
      <div className="field">
        <div className="flex h-16 items-center justify-between gap-6">
          <Mark />

          <nav className="hidden items-center gap-1 md:flex">
            {ROUTES.map((r) => (
              <Link
                key={r.href}
                href={r.href}
                className={`px-3 py-2 font-mono text-[13px] transition-colors duration-200 ${
                  path === r.href ? "text-signal" : "text-ink-2 hover:text-ink"
                }`}
              >
                {t(r.key)}
              </Link>
            ))}
          </nav>

          <div className="flex items-center gap-2">
            <div className="relative">
              <button
                type="button"
                onClick={() => setLangOpen((v) => !v)}
                aria-label="Language"
                aria-expanded={langOpen}
                className="grid size-9 place-items-center border border-rule text-ink-2
                           transition-colors duration-200 hover:border-ink hover:text-ink"
                style={{ borderRadius: "var(--r-sm)" }}
              >
                <Translate size={15} weight="bold" />
              </button>
              {langOpen && (
                <div
                  className="absolute right-0 z-50 mt-1 max-h-[320px] w-[190px] overflow-y-auto
                             border border-rule-strong bg-[var(--paper)] py-1 shadow-lg"
                  style={{ borderRadius: "var(--r-sm)" }}
                >
                  {LOCALES.map((l) => (
                    <button
                      key={l.code}
                      onClick={() => setLocale(l.code)}
                      className="flex w-full items-center justify-between gap-2 px-3 py-1.5 text-left
                                 text-[13px] text-ink transition-colors duration-150
                                 hover:bg-[var(--paper-2)]"
                    >
                      {l.native}
                      <span className="font-mono text-[10.5px] text-ink-3">{l.code}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>

            <button
              type="button"
              onClick={toggleTheme}
              aria-label={dark ? "Switch to light" : "Switch to dark"}
              className="grid size-9 place-items-center border border-rule text-ink-2
                         transition-colors duration-200 hover:border-ink hover:text-ink"
              style={{ borderRadius: "var(--r-sm)" }}
            >
              {dark ? <Moon size={15} weight="bold" /> : <Sun size={15} weight="bold" />}
            </button>

            {me === undefined ? (
              <span className="size-9" aria-hidden />
            ) : me ? (
              <Link
                href="/keys"
                className="flex items-center gap-2 border border-rule px-2 py-1.5
                           transition-colors duration-200 hover:border-ink"
                style={{ borderRadius: "var(--r-sm)" }}
              >
                <Avatar me={me} />
                <span className="hidden font-mono text-[12px] text-ink sm:inline">
                  {me.username ?? "account"}
                </span>
              </Link>
            ) : (
              <Link href="/login" className="btn btn-primary hidden sm:inline-flex">
                {t("nav_login")}
              </Link>
            )}

            <button
              type="button"
              onClick={() => setMenu((v) => !v)}
              aria-label={menu ? "Close menu" : "Open menu"}
              aria-expanded={menu}
              className="grid size-9 place-items-center border border-rule text-ink md:hidden"
              style={{ borderRadius: "var(--r-sm)" }}
            >
              {menu ? <X size={15} weight="bold" /> : <List size={15} weight="bold" />}
            </button>
          </div>
        </div>
      </div>

      {menu && (
        <div className="border-t border-rule md:hidden">
          <div className="field flex flex-col py-2">
            {ROUTES.map((r) => (
              <Link
                key={r.href}
                href={r.href}
                className="border-b border-rule py-3 font-mono text-sm text-ink last:border-0"
              >
                {t(r.key)}
              </Link>
            ))}
            {!me && (
              <Link href="/login" className="py-3 font-mono text-sm text-signal">
                {t("nav_login")}
              </Link>
            )}
          </div>
        </div>
      )}
    </header>
  );
}

/**
 * The Discord picture, with the initial as the fallback.
 *
 * Two ways to end up without an image: the account has no avatar set, and the
 * CDN request fails. Both land on the same initial, so a broken image never
 * shows as the browser's placeholder glyph.
 */
function Avatar({ me }: { me: Me }) {
  const src = avatarUrl(me);
  const [failed, setFailed] = useState(false);
  const initial = (me.username ?? "?").slice(0, 1).toUpperCase();

  if (!src || failed)
    return (
      <span
        className="grid size-6 shrink-0 place-items-center bg-signal font-mono text-[11px]
                   text-[var(--on-signal)]"
        style={{ borderRadius: "var(--r-sm)" }}
        aria-hidden
      >
        {initial}
      </span>
    );

  return (
    <img
      src={`${src}?size=64`}
      alt=""
      width={24}
      height={24}
      onError={() => setFailed(true)}
      className="size-6 shrink-0 object-cover"
      style={{ borderRadius: "var(--r-sm)" }}
    />
  );
}

/** Marks the active locale in a list. Exported for the settings surfaces. */
export function LocaleCheck({ on }: { on: boolean }) {
  return on ? <Check size={12} weight="bold" className="text-signal" /> : null;
}

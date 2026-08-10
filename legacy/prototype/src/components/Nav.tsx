import { useEffect, useState } from "react";
import { Sun, Moon, List, X } from "@phosphor-icons/react";
import { Link, useRoute } from "../lib/router";
import { Account } from "./Account";

const ROUTES = [
  { to: "/models", label: "Models" },
  { to: "/playground", label: "Playground" },
  { to: "/chat", label: "Chat" },
  { to: "/docs", label: "Docs" },
];

/** The wordmark. A square that inverts on hover, and the version of the name
    that fits: no logo file, no hand-drawn glyph. */
function Mark() {
  return (
    <Link to="/" className="group flex items-center gap-2.5 no-underline">
      <span
        className="grid size-6 place-items-center bg-ink text-paper transition-colors
                   duration-200 group-hover:bg-signal group-hover:text-[var(--on-signal)]"
        style={{ borderRadius: "var(--r-sm)" }}
        aria-hidden
      >
        <span className="font-mono text-[13px] font-medium leading-none">S</span>
      </span>
      <span className="font-mono text-[13px] font-medium tracking-tight text-ink">
        syde
      </span>
    </Link>
  );
}

export function Nav() {
  const { path } = useRoute();
  const [dark, setDark] = useState(false);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const stored = localStorage.getItem("theme");
    const prefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
    const isDark = stored ? stored === "dark" : prefersDark;
    setDark(isDark);
    document.documentElement.dataset.theme = isDark ? "dark" : "light";
  }, []);

  const toggle = () => {
    const next = !dark;
    setDark(next);
    document.documentElement.dataset.theme = next ? "dark" : "light";
    localStorage.setItem("theme", next ? "dark" : "light");
  };

  useEffect(() => setOpen(false), [path]);

  return (
    <header className="sticky top-0 z-40 border-b border-rule bg-[var(--paper)]/85 backdrop-saturate-150">
      <div className="field">
        {/* 64px, single line, always. */}
        <div className="flex h-16 items-center justify-between gap-6">
          <Mark />

          <nav className="hidden items-center gap-1 md:flex">
            {ROUTES.map((r) => {
              const active = path === r.to;
              return (
                <Link
                  key={r.to}
                  to={r.to}
                  className={`px-3 py-2 font-mono text-[13px] no-underline transition-colors duration-200
                    ${active ? "text-signal" : "text-ink-2 hover:text-ink"}`}
                >
                  {r.label}
                </Link>
              );
            })}
          </nav>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={toggle}
              aria-label={dark ? "Switch to light" : "Switch to dark"}
              className="grid size-9 place-items-center border border-rule text-ink-2
                         transition-colors duration-200 hover:border-ink hover:text-ink"
              style={{ borderRadius: "var(--r-sm)" }}
            >
              {dark ? <Moon size={15} weight="bold" /> : <Sun size={15} weight="bold" />}
            </button>

            <Account />

            <button
              type="button"
              onClick={() => setOpen((v) => !v)}
              aria-label={open ? "Close menu" : "Open menu"}
              aria-expanded={open}
              className="grid size-9 place-items-center border border-rule text-ink md:hidden"
              style={{ borderRadius: "var(--r-sm)" }}
            >
              {open ? <X size={15} weight="bold" /> : <List size={15} weight="bold" />}
            </button>
          </div>
        </div>
      </div>

      {open && (
        <div className="border-t border-rule md:hidden">
          <div className="field flex flex-col py-2">
            {ROUTES.map((r) => (
              <Link
                key={r.to}
                to={r.to}
                className="border-b border-rule py-3 font-mono text-sm text-ink no-underline last:border-0"
              >
                {r.label}
              </Link>
            ))}
          </div>
        </div>
      )}
    </header>
  );
}

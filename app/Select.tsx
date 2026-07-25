"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { CaretDown, Check } from "@phosphor-icons/react";

export interface SelectOption {
  value: string;
  label: string;
  /** Second line under the label, for capability blurbs. */
  hint?: string;
}

/**
 * Custom dropdown, so selects carry the same glass language as the rest of the
 * site instead of the OS widget. Behaves like a listbox: click or Enter/Space to
 * open, arrows to move, Enter to commit, Escape or an outside click to dismiss.
 *
 * The menu is `position: fixed`, placed from the trigger's measured rect, and
 * portalled to <body>. The portal is not optional: several ancestors here carry
 * `backdrop-filter`, which establishes a containing block for fixed-position
 * descendants — left in place the menu would be positioned against the composer
 * or the parameter rail and clipped by their overflow. It flips above the
 * trigger when there's more room up there.
 */
export default function Select({
  value,
  onChange,
  options,
  disabled,
  compact,
  ariaLabel,
  placeholder = "Select…",
}: {
  value: string;
  onChange: (v: string) => void;
  options: SelectOption[];
  disabled?: boolean;
  /** Pill-sized trigger, for inline use in a composer row. */
  compact?: boolean;
  ariaLabel?: string;
  placeholder?: string;
}) {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const [pos, setPos] = useState<React.CSSProperties>({});
  const btnRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  const selected = options.find((o) => o.value === value);

  const place = useCallback(() => {
    const btn = btnRef.current;
    if (!btn) return;
    const r = btn.getBoundingClientRect();
    // Only give up if the trigger itself has scrolled out of sight.
    if (r.bottom < 0 || r.top > window.innerHeight) {
      setOpen(false);
      return;
    }
    const width = Math.max(r.width, compact ? 150 : 230);
    const below = window.innerHeight - r.bottom - 12;
    const above = r.top - 12;
    const up = below < 200 && above > below;
    const left = Math.max(12, Math.min(r.left, window.innerWidth - width - 12));
    setPos({
      width,
      left,
      maxHeight: Math.min(320, up ? above : below),
      ...(up ? { bottom: window.innerHeight - r.top + 6 } : { top: r.bottom + 6 }),
    });
  }, [compact]);

  useLayoutEffect(() => {
    if (open) place();
  }, [open, place]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (!btnRef.current?.contains(t) && !menuRef.current?.contains(t)) setOpen(false);
    };
    // Scrolling a parent moves the trigger, so follow it rather than dismissing.
    // The menu's own scrolling is ignored — that's the user reading the list.
    const onScroll = (e: Event) => {
      const t = e.target as Node | null;
      if (t && menuRef.current && (menuRef.current === t || menuRef.current.contains(t))) return;
      place();
    };
    document.addEventListener("mousedown", onDown);
    // capture: scroll doesn't bubble, so this is the only way to see ancestors
    window.addEventListener("scroll", onScroll, true);
    window.addEventListener("resize", place);
    return () => {
      document.removeEventListener("mousedown", onDown);
      window.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("resize", place);
    };
  }, [open, place]);

  // Keep the highlighted row in view when arrowing through a long list.
  useEffect(() => {
    if (!open || active < 0) return;
    menuRef.current?.children[active]?.scrollIntoView({ block: "nearest" });
  }, [open, active]);

  function commit(v: string) {
    onChange(v);
    setOpen(false);
    btnRef.current?.focus();
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if (disabled) return;
    if (!open) {
      if (e.key === "Enter" || e.key === " " || e.key === "ArrowDown") {
        e.preventDefault();
        setActive(Math.max(0, options.findIndex((o) => o.value === value)));
        setOpen(true);
      }
      return;
    }
    if (e.key === "Escape") { e.preventDefault(); setOpen(false); btnRef.current?.focus(); }
    else if (e.key === "ArrowDown") { e.preventDefault(); setActive((i) => Math.min(options.length - 1, i + 1)); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setActive((i) => Math.max(0, i - 1)); }
    else if (e.key === "Home") { e.preventDefault(); setActive(0); }
    else if (e.key === "End") { e.preventDefault(); setActive(options.length - 1); }
    else if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      if (options[active]) commit(options[active].value);
    }
  }

  return (
    <>
      <button
        ref={btnRef}
        type="button"
        className={`ui-sel ${compact ? "compact" : ""} ${open ? "open" : ""}`}
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={ariaLabel}
        onClick={() => {
          if (disabled) return;
          setActive(Math.max(0, options.findIndex((o) => o.value === value)));
          setOpen((o) => !o);
        }}
        onKeyDown={onKeyDown}
      >
        <span className="ui-sel-val">{selected?.label ?? value ?? placeholder}</span>
        <CaretDown size={13} weight="bold" />
      </button>

      {open &&
        createPortal(
          <div ref={menuRef} className="ui-sel-menu" role="listbox" style={pos} onKeyDown={onKeyDown} tabIndex={-1}>
            {options.length === 0 && <div className="ui-sel-empty">Nothing to choose from</div>}
            {options.map((o, i) => (
              <button
                key={o.value}
                type="button"
                role="option"
                aria-selected={o.value === value}
                className={`ui-sel-opt ${i === active ? "active" : ""}`}
                onMouseEnter={() => setActive(i)}
                onClick={() => commit(o.value)}
              >
                <span className="ui-sel-opt-txt">
                  <span className="ui-sel-opt-label">{o.label}</span>
                  {o.hint && <span className="ui-sel-opt-hint">{o.hint}</span>}
                </span>
                {o.value === value && <Check size={15} weight="bold" className="ui-sel-check" />}
              </button>
            ))}
          </div>,
          document.body
        )}
    </>
  );
}

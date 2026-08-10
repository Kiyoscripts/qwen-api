"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Plus, Warning } from "@phosphor-icons/react";
import { useT } from "./I18n";


type Pool = "qwen" | "onecompiler";

/**
 * When a pooled token stops being valid, read from the JWT itself.
 *
 * Deliberately a local copy rather than an import from lib/tokens: that module
 * reaches the Supabase admin client and node:crypto, and pulling it into a
 * client component drags all of it into the browser bundle. This is the only
 * part the browser needs, and it is pure string work.
 */
function tokenExpiry(token: string): number | null {
  const parts = (token || "").split(".");
  if (parts.length !== 3) return null;
  try {
    const json = atob(parts[1].replace(/-/g, "+").replace(/_/g, "/"));
    const exp = JSON.parse(json)?.exp;
    return typeof exp === "number" ? exp * 1000 : null;
  } catch {
    return null;
  }
}
interface Tok {
  id: string; label?: string | null; token?: string; active: boolean;
  error_count?: number; last_used_at?: string | null;
}

/**
 * Account pools.
 *
 * Expiry is a first-class column because it is the question an operator
 * actually has: Qwen session tokens are JWTs with a roughly two week life, and
 * a pool that quietly ages out all at once looks exactly like a ban.
 */
export function AdminPanel() {
  const t = useT();
  const [me, setMe] = useState<any>(undefined);
  const [pool, setPool] = useState<Pool>("qwen");
  const [tokens, setTokens] = useState<Tok[] | null>(null);
  const [paste, setPaste] = useState("");
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/auth/me").then((r) => (r.ok ? r.json() : { user: null })).then((j) => setMe(j.user ?? null));
  }, []);

  const load = () => {
    setTokens(null);
    const url = pool === "qwen" ? "/api/admin/tokens" : "/api/admin/onecompiler-tokens";
    fetch(url).then((r) => (r.ok ? r.json() : { tokens: [] })).then((j) => setTokens(j.tokens ?? []));
  };
  useEffect(load, [pool]);

  if (me === undefined) return null;

  const role = me?.role;
  if (!me || (role !== "owner" && role !== "admin"))
    return (
      <div className="py-20 text-center">
        <h1 className="h2 text-ink">{t("admin_need_role")}</h1>
        <Link href="/" className="btn btn-ghost mt-6">{t("admin_back_dashboard")}</Link>
      </div>
    );

  const add = async () => {
    const rows = paste.split("\n").map((s) => s.trim()).filter(Boolean);
    if (!rows.length) return;
    setBusy(true); setNote(null);
    try {
      const url = pool === "qwen" ? "/api/admin/tokens" : "/api/admin/onecompiler-tokens";
      const r = await fetch(url, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tokens: rows }),
      });
      const j = await r.json();
      setNote(r.ok ? `${j.added ?? rows.length} added` : j.error || t("error"));
      if (r.ok) { setPaste(""); load(); }
    } catch { setNote(t("error")); } finally { setBusy(false); }
  };

  const live = tokens?.filter((x) => x.active).length ?? 0;
  const soon = (tokens ?? []).filter((x) => {
    const exp = x.token ? tokenExpiry(x.token) : null;
    return exp !== null && exp - Date.now() < 3 * 86400_000;
  }).length;

  return (
    <>
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="h2 text-ink">{t("admin_title")}</h1>
          <p className="body mt-3 text-[14px]">{t("admin_subtitle")}</p>
        </div>
        <div className="flex gap-1" role="tablist" aria-label="Pool">
          {([["qwen", t("admin_qwen_pool")], ["onecompiler", t("admin_oc_pool")]] as const).map(([id, label]) => (
            <button key={id} role="tab" aria-selected={pool === id} onClick={() => setPool(id as Pool)}
              className={`h-9 border px-3 font-mono text-[12px] transition-colors duration-200 ${
                pool === id ? "border-ink bg-ink text-[var(--paper)]"
                            : "border-rule text-ink-2 hover:border-ink hover:text-ink"}`}
              style={{ borderRadius: "var(--r-sm)" }}>
              {label}
            </button>
          ))}
        </div>
      </div>

      <dl className="mt-8 grid gap-4 sm:grid-cols-3">
        {[[String(tokens?.length ?? "-"), t("admin_tokens_count")],
          [String(live), t("admin_active")],
          [String(soon), "expiring within 3 days"]].map(([f, l]) => (
          <div key={l} className="border border-rule px-4 py-4" style={{ borderRadius: "var(--r-sm)" }}>
            <dd className="num text-[1.7rem] leading-none font-medium text-ink">{f}</dd>
            <dt className="mt-2 text-[12.5px] text-ink-2">{l}</dt>
          </div>
        ))}
      </dl>

      <div className="mt-8">
        <label htmlFor="paste" className="mb-2 block font-mono text-[11px] tracking-wide text-ink-3 uppercase">
          {t("admin_add")}
        </label>
        <textarea id="paste" rows={3} value={paste} onChange={(e) => setPaste(e.target.value)}
          placeholder={t("admin_bulk_placeholder")}
          className="w-full resize-y border border-rule bg-transparent px-3 py-2.5 font-mono text-[12.5px]
                     text-ink outline-none placeholder:text-ink-3 focus:border-signal"
          style={{ borderRadius: "var(--r-sm)" }} />
        <button onClick={add} disabled={busy || !paste.trim()} className="btn btn-primary mt-3 disabled:opacity-40">
          <Plus size={13} weight="bold" />{busy ? t("loading") : t("admin_add_all")}
        </button>
        {note && <p className="mt-3 flex items-center gap-2 text-[13px] text-signal"><Warning size={14} weight="bold" />{note}</p>}
      </div>

      <div className="mt-8">
        {!tokens ? (
          <div className="space-y-2">
            {Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="h-12 animate-pulse border border-rule bg-[var(--paper-2)]" style={{ borderRadius: "var(--r-sm)" }} />
            ))}
          </div>
        ) : (
          <div className="overflow-x-auto border border-rule" style={{ borderRadius: "var(--r-sm)" }}>
            <table className="w-full min-w-[620px] text-left">
              <thead>
                <tr className="border-b border-rule">
                  {[t("admin_label"), t("admin_active"), t("admin_errors"), t("admin_last_used"), "expires"].map((h) => (
                    <th key={h} className="px-4 py-2.5 font-mono text-[11px] tracking-wide text-ink-3 uppercase">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {tokens.map((x) => {
                  const exp = x.token ? tokenExpiry(x.token) : null;
                  const days = exp === null ? null : Math.round((exp - Date.now()) / 86400_000);
                  return (
                    <tr key={x.id} className="border-b border-rule last:border-0">
                      <td className="px-4 py-3 font-mono text-[12.5px] text-ink">{x.label || x.id.slice(0, 8)}</td>
                      <td className="px-4 py-3 text-[12.5px]">
                        <span className={x.active ? "text-ink-2" : "text-signal"}>
                          {x.active ? t("admin_active") : t("admin_disabled")}
                        </span>
                      </td>
                      <td className="num px-4 py-3 text-[12.5px] text-ink-2">{x.error_count ?? 0}</td>
                      <td className="num px-4 py-3 text-[12.5px] text-ink-3">
                        {x.last_used_at ? new Date(x.last_used_at).toLocaleDateString() : t("keys_never")}
                      </td>
                      <td className="num px-4 py-3 text-[12.5px]">
                        {days === null ? <span className="text-ink-3">-</span>
                          : <span className={days < 3 ? "text-signal" : "text-ink-2"}>{days}d</span>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </>
  );
}

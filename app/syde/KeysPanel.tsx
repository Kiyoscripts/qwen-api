"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Plus, Copy, Check, Warning, SignOut } from "@phosphor-icons/react";
import { useT } from "../I18n";

interface Key {
  id: string; name: string | null; key_prefix: string;
  created_at: string; last_used_at: string | null; request_count: number; revoked: boolean;
}
interface Usage { total: number; series: { day: string; count: number }[] }

/**
 * Keys and usage.
 *
 * The one thing this has to get right is that a new key is shown exactly once:
 * it comes back on create and is never stored readable. Hence a banner that
 * waits to be dismissed, not a toast that times out.
 */
export function KeysPanel() {
  const t = useT();
  const router = useRouter();
  const [me, setMe] = useState<any>(undefined);
  const [keys, setKeys] = useState<Key[] | null>(null);
  const [usage, setUsage] = useState<Usage | null>(null);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [fresh, setFresh] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    fetch("/api/auth/me").then((r) => (r.ok ? r.json() : { user: null })).then((j) => {
      if (!live) return;
      setMe(j.user ?? null);
      if (!j.user) return;
      fetch("/api/account/keys").then((r) => r.json()).then((j) => live && setKeys(j.keys ?? []));
      fetch("/api/account/usage").then((r) => r.json()).then((j) => live && setUsage(j));
    });
    return () => { live = false; };
  }, []);

  if (me === undefined) return <Skeleton />;

  if (me === null)
    return (
      <div className="py-16 text-center">
        <h1 className="h2 text-ink">{t("login_title")}</h1>
        <p className="body mx-auto mt-3 text-[14px]">{t("login_no_account")}</p>
        <Link href="/login" className="btn btn-primary mt-6">{t("login_submit")}</Link>
      </div>
    );

  const create = async () => {
    setBusy(true); setError(null);
    try {
      const r = await fetch("/api/account/keys", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: name.trim() }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error);
      setFresh(j.key);
      setName("");
      const list = await (await fetch("/api/account/keys")).json();
      setKeys(list.keys ?? []);
    } catch { setError(t("error")); } finally { setBusy(false); }
  };

  const revoke = async (id: string) => {
    setKeys((p) => (p ?? []).map((k) => (k.id === id ? { ...k, revoked: true } : k)));
    await fetch("/api/account/keys/revoke", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id }),
    }).catch(() => {});
  };

  const series = usage?.series ?? [];
  const peak = Math.max(1, ...series.map((d) => d.count));

  return (
    <>
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="h2 text-ink">{t("keys_title")}</h1>
          <p className="body mt-3 text-[14px]">
            {t("admin_signed_in_as")} <span className="text-ink">{me.username}</span>
          </p>
        </div>
        <button
          onClick={async () => { await fetch("/api/auth/logout", { method: "POST" }); router.push("/"); router.refresh(); }}
          className="btn btn-ghost h-9 px-4">
          <SignOut size={13} weight="bold" />{t("keys_sign_out")}
        </button>
      </div>

      {fresh && (
        <div className="mt-7 border border-[var(--signal)] bg-[var(--signal-wash)] px-4 py-4"
             style={{ borderRadius: "var(--r-sm)" }}>
          <p className="text-[13.5px] font-medium text-signal">{t("keys_shown_once")}</p>
          <div className="mt-3 flex items-center gap-2">
            <code className="min-w-0 flex-1 truncate border border-[var(--signal)] bg-[var(--paper)] px-3 py-2
                             font-mono text-[12.5px] text-ink" style={{ borderRadius: "var(--r-sm)" }}>
              {fresh}
            </code>
            <button onClick={async () => { await navigator.clipboard.writeText(fresh); setCopied(true); setTimeout(() => setCopied(false), 1600); }}
                    className="btn btn-primary h-9 shrink-0 px-3">
              {copied ? <Check size={13} weight="bold" /> : <Copy size={13} weight="bold" />}
              {copied ? t("keys_copied") : t("keys_copy")}
            </button>
          </div>
          <button onClick={() => setFresh(null)} className="mt-3 font-mono text-[11.5px] text-signal underline underline-offset-2">
            {t("close")}
          </button>
        </div>
      )}

      {series.length > 0 && (
        <div className="mt-8 border border-rule p-5" style={{ borderRadius: "var(--r-sm)" }}>
          <div className="flex items-baseline justify-between">
            <span className="font-mono text-[11.5px] text-ink-3">{t("usage_requests_over_time")}</span>
            <span className="num text-[13px] text-ink">{(usage?.total ?? 0).toLocaleString()}</span>
          </div>
          <div className="mt-4 flex h-20 items-end gap-1">
            {series.map((d) => (
              <div key={d.day} title={`${d.day}: ${d.count}`} className="flex-1 bg-signal"
                   style={{ height: `${Math.max(3, (d.count / peak) * 100)}%` }} />
            ))}
          </div>
        </div>
      )}

      <div className="mt-8 flex flex-wrap items-end gap-3">
        <div className="min-w-[220px] flex-1">
          <label htmlFor="keyname" className="mb-2 block font-mono text-[11px] tracking-wide text-ink-3 uppercase">
            {t("keys_label_optional")}
          </label>
          <input id="keyname" value={name} onChange={(e) => setName(e.target.value)}
            placeholder={t("keys_name_placeholder")}
            className="h-10 w-full border border-rule bg-transparent px-3 font-mono text-[12.5px]
                       text-ink outline-none placeholder:text-ink-3 focus:border-signal"
            style={{ borderRadius: "var(--r-sm)" }} />
        </div>
        <button onClick={create} disabled={busy} className="btn btn-primary disabled:opacity-40">
          <Plus size={13} weight="bold" />{busy ? t("loading") : t("keys_create_btn")}
        </button>
      </div>
      {error && <p className="mt-3 flex items-center gap-2 text-[13px] text-signal"><Warning size={14} weight="bold" />{error}</p>}

      <div className="mt-8">
        {!keys ? <Skeleton /> : keys.length === 0 ? (
          <div className="border border-dashed border-rule-strong px-6 py-14 text-center" style={{ borderRadius: "var(--r-sm)" }}>
            <p className="h3 text-ink">{t("keys_none")}</p>
            <p className="body mx-auto mt-2 text-[13.5px]">{t("keys_none_create")}</p>
          </div>
        ) : (
          <div className="border border-rule" style={{ borderRadius: "var(--r-sm)" }}>
            {keys.map((k, i) => (
              <div key={k.id} className={`flex flex-wrap items-center gap-4 px-4 py-3.5 ${i > 0 ? "border-t border-rule" : ""}`}>
                <div className="min-w-0 flex-1">
                  <p className={`text-[13.5px] ${k.revoked ? "text-ink-3 line-through" : "text-ink"}`}>
                    {k.name || t("keys_label_optional")}
                  </p>
                  <p className="font-mono text-[11.5px] text-ink-3">{k.key_prefix}</p>
                </div>
                <span className="num text-[12px] text-ink-3">{k.request_count.toLocaleString()} {t("usage_req_short")}</span>
                {k.revoked ? (
                  <span className="font-mono text-[11px] text-ink-3">{t("keys_revoked")}</span>
                ) : (
                  <button onClick={() => revoke(k.id)}
                          className="font-mono text-[11.5px] text-ink-3 transition-colors duration-200 hover:text-signal">
                    {t("keys_revoke")}
                  </button>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </>
  );
}

function Skeleton() {
  return (
    <div className="space-y-2">
      {Array.from({ length: 3 }).map((_, i) => (
        <div key={i} className="h-14 animate-pulse border border-rule bg-[var(--paper-2)]"
             style={{ borderRadius: "var(--r-sm)" }} />
      ))}
    </div>
  );
}

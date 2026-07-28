"use client";

import { useCallback, useEffect, useState } from "react";
import { useT } from "../I18n";
import type { Dict } from "@/lib/i18n";

interface TokenRow {
  id: string;
  label: string | null;
  active: boolean;
  masked: string;
  created_at: string;
  last_used_at: string | null;
  error_count: number;
}
interface KeyRow {
  id: string;
  name: string | null;
  key_prefix: string;
  created_at: string;
  last_used_at: string | null;
  revoked: boolean;
  request_count: number;
}
// Shape returned by /api/auth/me — note it flattens the discord_* columns.
interface Me {
  id: string;
  username: string | null;
  role: string | null;
}

// The two pools are managed identically but must never share state or an
// endpoint: a token filed into the wrong pool can only ever fail upstream.
interface PoolSpec {
  key: "qwen" | "onecompiler";
  title: keyof Dict;
  endpoint: string;
  blurb: string;
  placeholder: string;
  emptyNote: string;
}

const POOLS: PoolSpec[] = [
  {
    key: "qwen",
    title: "admin_qwen_pool",
    endpoint: "/api/admin/tokens",
    blurb: "Rotated per request so no single account gets rate-limited or flagged.",
    placeholder: "Paste a single Qwen account token…",
    emptyNote: "No pooled tokens yet — the env QWEN_TOKEN is used as fallback.",
  },
  {
    key: "onecompiler",
    title: "admin_oc_pool",
    endpoint: "/api/admin/onecompiler-tokens",
    blurb:
      "Each Free account has a hard daily cap, so the pool rotates away from spent accounts until they reset. Paste the bearer token (a leading “Bearer ” is stripped for you).",
    placeholder: "Paste a single OneCompiler bearer token…",
    emptyNote: "No pooled tokens yet — the env ONECOMPILER_TOKEN is used as fallback.",
  },
];

export default function Admin() {
  const t = useT();
  const [me, setMe] = useState<Me | null>(null);
  const [state, setState] = useState<"loading" | "ok" | "unauthenticated" | "forbidden">("loading");
  const [error, setError] = useState<string | null>(null);
  const [pools, setPools] = useState<Record<string, TokenRow[]>>({ qwen: [], onecompiler: [] });
  const [keys, setKeys] = useState<KeyRow[]>([]);
  const [blacklist, setBlacklist] = useState<{ ip: string; reason: string | null; keys_deleted: number; created_at: string }[]>([]);
  const [busy, setBusy] = useState(false);

  // Per-pool form state, keyed by pool so the two forms cannot bleed into each
  // other — the failure mode being a Qwen token submitted to OneCompiler.
  const [single, setSingle] = useState<Record<string, string>>({});
  const [labels, setLabels] = useState<Record<string, string>>({});
  const [bulk, setBulk] = useState<Record<string, string>>({});

  // Auth now rides on the session cookie, so no header and no stored secret.
  const load = useCallback(async () => {
    setError(null);
    const [meRes, ...rest] = await Promise.all([
      fetch("/api/auth/me"),
      ...POOLS.map((p) => fetch(p.endpoint)),
      fetch("/api/admin/keys"),
      fetch("/api/admin/blacklist"),
    ]);

    const poolRes = rest.slice(0, POOLS.length);
    const [k, b] = rest.slice(POOLS.length);

    if (poolRes[0].status === 401) return setState("unauthenticated");
    if (poolRes[0].status === 403) {
      setMe((await meRes.json().catch(() => ({}))).user ?? null);
      return setState("forbidden");
    }

    setMe((await meRes.json().catch(() => ({}))).user ?? null);
    const next: Record<string, TokenRow[]> = {};
    await Promise.all(
      POOLS.map(async (p, i) => {
        next[p.key] = (await poolRes[i].json().catch(() => ({}))).tokens || [];
      })
    );
    setPools(next);
    setKeys((await k.json().catch(() => ({}))).keys || []);
    setBlacklist((await b.json().catch(() => ({}))).blacklist || []);
    setState("ok");
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function addToken(pool: PoolSpec) {
    const token = (single[pool.key] || "").trim();
    if (!token) return;
    setBusy(true);
    try {
      const r = await fetch(pool.endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, label: labels[pool.key] || null }),
      });
      if (!r.ok) setError((await r.json().catch(() => ({}))).error || "Failed to add token");
      else {
        setSingle((s) => ({ ...s, [pool.key]: "" }));
        setLabels((s) => ({ ...s, [pool.key]: "" }));
        await load();
      }
    } finally {
      setBusy(false);
    }
  }

  async function addBulk(pool: PoolSpec) {
    const text = (bulk[pool.key] || "").trim();
    if (!text) return;
    setBusy(true);
    try {
      const r = await fetch(pool.endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tokens: text }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) setError(j.error || "Bulk add failed");
      else {
        setBulk((s) => ({ ...s, [pool.key]: "" }));
        setError(null);
      }
      await load();
    } finally {
      setBusy(false);
    }
  }

  async function toggle(pool: PoolSpec, id: string, active: boolean) {
    await fetch(pool.endpoint, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, active }),
    });
    await load();
  }
  async function remove(pool: PoolSpec, id: string) {
    await fetch(`${pool.endpoint}?id=${encodeURIComponent(id)}`, { method: "DELETE" });
    await load();
  }
  async function unban(ip: string) {
    await fetch(`/api/admin/blacklist?ip=${encodeURIComponent(ip)}`, { method: "DELETE" });
    await load();
  }
  async function purgeSpam() {
    if (!confirm("Delete all unused keys named 'batch-…' (the spam keys)?")) return;
    setBusy(true);
    try {
      const r = await fetch("/api/admin/keys?spam=batch-", { method: "DELETE" });
      setError(r.ok ? null : (await r.json().catch(() => ({}))).error);
      await load();
    } finally {
      setBusy(false);
    }
  }
  async function removeKey(id: string) {
    await fetch(`/api/admin/keys?id=${id}`, { method: "DELETE" });
    await load();
  }
  async function revokeAll() {
    if (!confirm("Delete ALL API keys? Every existing key will stop working immediately. This cannot be undone.")) return;
    if (!confirm("Are you absolutely sure? This revokes every key including your own.")) return;
    setBusy(true);
    try {
      const r = await fetch("/api/admin/keys?all=true", { method: "DELETE" });
      setError(r.ok ? null : (await r.json().catch(() => ({}))).error);
      await load();
    } finally {
      setBusy(false);
    }
  }

  if (state === "loading") {
    return (
      <div className="wrap" style={{ maxWidth: 420 }}>
        <p className="muted">{t("admin_checking")}</p>
      </div>
    );
  }

  // Not signed in and signed-in-but-not-an-admin are different problems with
  // different fixes, so they get different screens rather than one "denied".
  if (state === "unauthenticated") {
    return (
      <div className="wrap" style={{ maxWidth: 460 }}>
        <h1 style={{ fontSize: 28 }}>{t("admin_title")}</h1>
        <p className="lead" style={{ fontSize: 15 }}>{t("admin_need_signin")}</p>
        <a className="btn" href="/login">{t("login_with_discord")}</a>
      </div>
    );
  }

  if (state === "forbidden") {
    const who = me?.username || "your account";
    return (
      <div className="wrap" style={{ maxWidth: 460 }}>
        <h1 style={{ fontSize: 28 }}>{t("admin_title")}</h1>
        <p className="lead" style={{ fontSize: 15 }}>
          {t("admin_signed_in_as")} {who}, but {t("admin_need_role")}
          {me?.role ? ` Your role is “${me.role}”.` : ""}
        </p>
        <a className="btn" href="/keys">{t("admin_back_dashboard")}</a>
      </div>
    );
  }

  const who = me?.username || "admin";

  return (
    <div className="wrap" style={{ maxWidth: 900 }}>
      <h1 style={{ fontSize: 28, marginBottom: 4 }}>{t("admin_title")}</h1>
      <p className="lead" style={{ fontSize: 14 }}>
        {t("admin_signed_in_as")} {who}
        {me?.role ? ` · ${me.role}` : ""} — {t("admin_subtitle")}
      </p>
      {error && <p className="err">{error}</p>}

      {POOLS.map((pool) => {
        const rows = pools[pool.key] || [];
        const bulkText = bulk[pool.key] || "";
        return (
          <section key={pool.key} style={{ marginTop: 28 }}>
            <h2 style={{ marginBottom: 2 }}>
              {t(pool.title)} ({rows.filter((t) => t.active).length} active / {rows.length})
            </h2>
            <p className="muted" style={{ fontSize: 13, marginTop: 0, marginBottom: 10 }}>{pool.blurb}</p>

            <div className="card" style={{ marginBottom: 12 }}>
              <div className="row" style={{ marginBottom: 10 }}>
                <input
                  className="input"
                  placeholder="Label (optional)"
                  value={labels[pool.key] || ""}
                  onChange={(e) => setLabels((s) => ({ ...s, [pool.key]: e.target.value }))}
                  style={{ maxWidth: 180 }}
                />
                <input
                  className="input"
                  placeholder={pool.placeholder}
                  value={single[pool.key] || ""}
                  onChange={(e) => setSingle((s) => ({ ...s, [pool.key]: e.target.value }))}
                />
                <button className="btn" onClick={() => addToken(pool)} disabled={busy || !(single[pool.key] || "").trim()}>{t("admin_add")}</button>
              </div>
              <textarea
                className="input"
                style={{ width: "100%", minHeight: 90, fontFamily: "ui-monospace, monospace", fontSize: 12 }}
                placeholder={t("admin_bulk_placeholder")}
                value={bulkText}
                onChange={(e) => setBulk((s) => ({ ...s, [pool.key]: e.target.value }))}
              />
              <div className="row" style={{ marginTop: 8, justifyContent: "flex-end" }}>
                <span className="muted" style={{ alignSelf: "center", fontSize: 12 }}>
                  {bulkText.trim() ? `${bulkText.split(/\r?\n/).filter((l) => l.trim()).length} t("admin_tokens_count")}` : ""}
                </span>
                <button className="btn" onClick={() => addBulk(pool)} disabled={busy || !bulkText.trim()}>{t("admin_add_all")}</button>
              </div>
            </div>

            <table className="tbl">
              <thead>
                <tr><th>{t("admin_label")}</th><th>{t("admin_token")}</th><th>{t("admin_active")}</th><th>{t("admin_last_used")}</th><th>{t("admin_errors")}</th><th></th></tr>
              </thead>
              <tbody>
                {rows.length === 0 && <tr><td colSpan={6} className="muted">{pool.emptyNote}</td></tr>}
                {rows.map((th) => (
                  <tr key={th.id}>
                    <td>{th.label || <span className="muted">—</span>}</td>
                    <td><code>{th.masked}</code></td>
                    <td>
                      <button className={`pill ${th.active ? "on" : "off"}`} onClick={() => toggle(pool, th.id, !th.active)}>
                        {th.active ? t("keys_active") : t("admin_disabled")}
                      </button>
                    </td>
                    <td className="muted">{th.last_used_at ? new Date(th.last_used_at).toLocaleString() : "—"}</td>
                    <td className="muted">{th.error_count}</td>
                    <td><button className="pill del" onClick={() => remove(pool, th.id)}>{t("admin_delete")}</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        );
      })}

      <div className="pg-controls" style={{ marginTop: 32, marginBottom: 4, justifyContent: "space-between" }}>
        <h2 style={{ margin: 0 }}>{t("admin_api_keys")} ({keys.length})</h2>
        <div className="pg-modes">
          <button className="pill del" onClick={purgeSpam} disabled={busy}>{t("admin_delete_spam")}</button>
          <button className="pill del" onClick={revokeAll} disabled={busy}>{t("admin_revoke_all")}</button>
        </div>
      </div>
      <table className="tbl">
        <thead>
          <tr><th>{t("admin_name")}</th><th>{t("admin_prefix")}</th><th>{t("admin_requests")}</th><th>{t("admin_last_used")}</th><th>{t("admin_status")}</th><th></th></tr>
        </thead>
        <tbody>
          {keys.map((k) => (
            <tr key={k.id}>
              <td>{k.name || <span className="muted">—</span>}</td>
              <td><code>{k.key_prefix}</code></td>
              <td>{k.request_count}</td>
              <td className="muted">{k.last_used_at ? new Date(k.last_used_at).toLocaleString() : "—"}</td>
              <td>{k.revoked ? <span className="pill off">revoked</span> : <span className="pill on">active</span>}</td>
              <td><button className="pill del" onClick={() => removeKey(k.id)}>{t("admin_delete")}</button></td>
            </tr>
          ))}
        </tbody>
      </table>

      <h2>{t("admin_blacklisted")} ({blacklist.length})</h2>
      <table className="tbl">
        <thead>
          <tr><th>IP</th><th>{t("admin_reason")}</th><th>{t("admin_keys_deleted")}</th><th>{t("admin_when")}</th><th></th></tr>
        </thead>
        <tbody>
          {blacklist.length === 0 && <tr><td colSpan={5} className="muted">{t("admin_none_banned")}</td></tr>}
          {blacklist.map((b) => (
            <tr key={b.ip}>
              <td><code>{b.ip}</code></td>
              <td className="muted">{b.reason || "—"}</td>
              <td className="muted">{b.keys_deleted}</td>
              <td className="muted">{new Date(b.created_at).toLocaleString()}</td>
              <td><button className="pill" onClick={() => unban(b.ip)}>{t("admin_unban")}</button></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

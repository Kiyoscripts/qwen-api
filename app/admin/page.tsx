"use client";

import { useCallback, useEffect, useState } from "react";

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

export default function Admin() {
  const [secret, setSecret] = useState("");
  const [unlocked, setUnlocked] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tokens, setTokens] = useState<TokenRow[]>([]);
  const [keys, setKeys] = useState<KeyRow[]>([]);
  const [newToken, setNewToken] = useState("");
  const [newLabel, setNewLabel] = useState("");
  const [busy, setBusy] = useState(false);

  const authFetch = useCallback(
    (url: string, init: RequestInit = {}) =>
      fetch(url, { ...init, headers: { ...(init.headers || {}), "x-admin-secret": secret, "Content-Type": "application/json" } }),
    [secret]
  );

  const load = useCallback(async () => {
    setError(null);
    const [t, k] = await Promise.all([authFetch("/api/admin/tokens"), authFetch("/api/admin/keys")]);
    if (t.status === 401) {
      setUnlocked(false);
      setError("Wrong password.");
      return;
    }
    setTokens((await t.json()).tokens || []);
    setKeys((await k.json()).keys || []);
    setUnlocked(true);
  }, [authFetch]);

  useEffect(() => {
    const saved = sessionStorage.getItem("qwen_admin_secret");
    if (saved) setSecret(saved);
  }, []);

  async function unlock() {
    setBusy(true);
    try {
      await load();
      if (secret) sessionStorage.setItem("qwen_admin_secret", secret);
    } finally {
      setBusy(false);
    }
  }

  async function addToken() {
    if (!newToken.trim()) return;
    setBusy(true);
    try {
      const r = await authFetch("/api/admin/tokens", { method: "POST", body: JSON.stringify({ token: newToken.trim(), label: newLabel || null }) });
      if (!r.ok) {
        setError((await r.json()).error || "Failed to add token");
      } else {
        setNewToken("");
        setNewLabel("");
        await load();
      }
    } finally {
      setBusy(false);
    }
  }

  async function toggle(id: string, active: boolean) {
    await authFetch("/api/admin/tokens", { method: "PATCH", body: JSON.stringify({ id, active }) });
    await load();
  }
  async function remove(id: string) {
    await authFetch(`/api/admin/tokens?id=${id}`, { method: "DELETE" });
    await load();
  }
  async function purgeSpam() {
    if (!confirm("Delete all unused keys named 'batch-…' (the spam keys)?")) return;
    setBusy(true);
    try {
      const r = await authFetch("/api/admin/keys?spam=batch-", { method: "DELETE" });
      const j = await r.json();
      setError(r.ok ? null : j.error);
      await load();
    } finally {
      setBusy(false);
    }
  }
  async function removeKey(id: string) {
    await authFetch(`/api/admin/keys?id=${id}`, { method: "DELETE" });
    await load();
  }
  async function revokeAll() {
    if (!confirm("Delete ALL API keys? Every existing key will stop working immediately. This cannot be undone.")) return;
    if (!confirm("Are you absolutely sure? This revokes every key including your own.")) return;
    setBusy(true);
    try {
      const r = await authFetch("/api/admin/keys?all=true", { method: "DELETE" });
      const j = await r.json();
      setError(r.ok ? null : j.error);
      await load();
    } finally {
      setBusy(false);
    }
  }

  if (!unlocked) {
    return (
      <div className="wrap" style={{ maxWidth: 420 }}>
        <h1 style={{ fontSize: 28 }}>Admin</h1>
        <p className="lead" style={{ fontSize: 15 }}>Enter the admin password to manage the token pool.</p>
        <div className="row">
          <input
            className="input"
            type="password"
            placeholder="Admin password"
            value={secret}
            onChange={(e) => setSecret(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && unlock()}
          />
          <button className="btn" onClick={unlock} disabled={busy || !secret}>Unlock</button>
        </div>
        {error && <p className="err">{error}</p>}
      </div>
    );
  }

  return (
    <div className="wrap" style={{ maxWidth: 900 }}>
      <h1 style={{ fontSize: 28, marginBottom: 4 }}>Admin</h1>
      <p className="lead" style={{ fontSize: 14 }}>Pooled Qwen account tokens & issued API keys.</p>
      {error && <p className="err">{error}</p>}

      <h2>Qwen token pool ({tokens.filter((t) => t.active).length} active / {tokens.length})</h2>
      <div className="card" style={{ marginBottom: 12 }}>
        <div className="row">
          <input className="input" placeholder="Label (optional)" value={newLabel} onChange={(e) => setNewLabel(e.target.value)} style={{ maxWidth: 180 }} />
          <input className="input" placeholder="Paste a Qwen account token…" value={newToken} onChange={(e) => setNewToken(e.target.value)} />
          <button className="btn" onClick={addToken} disabled={busy || !newToken.trim()}>Add</button>
        </div>
      </div>
      <table className="tbl">
        <thead>
          <tr><th>Label</th><th>Token</th><th>Active</th><th>Last used</th><th>Errors</th><th></th></tr>
        </thead>
        <tbody>
          {tokens.length === 0 && <tr><td colSpan={6} className="muted">No pooled tokens yet — the env QWEN_TOKEN is used as fallback.</td></tr>}
          {tokens.map((t) => (
            <tr key={t.id}>
              <td>{t.label || <span className="muted">—</span>}</td>
              <td><code>{t.masked}</code></td>
              <td>
                <button className={`pill ${t.active ? "on" : "off"}`} onClick={() => toggle(t.id, !t.active)}>{t.active ? "active" : "disabled"}</button>
              </td>
              <td className="muted">{t.last_used_at ? new Date(t.last_used_at).toLocaleString() : "—"}</td>
              <td className="muted">{t.error_count}</td>
              <td><button className="pill del" onClick={() => remove(t.id)}>delete</button></td>
            </tr>
          ))}
        </tbody>
      </table>

      <div className="pg-controls" style={{ marginTop: 32, marginBottom: 4, justifyContent: "space-between" }}>
        <h2 style={{ margin: 0 }}>API keys ({keys.length})</h2>
        <div className="pg-modes">
          <button className="pill del" onClick={purgeSpam} disabled={busy}>Delete spam (batch-…)</button>
          <button className="pill del" onClick={revokeAll} disabled={busy}>Revoke ALL</button>
        </div>
      </div>
      <table className="tbl">
        <thead>
          <tr><th>Name</th><th>Prefix</th><th>Requests</th><th>Last used</th><th>Status</th><th></th></tr>
        </thead>
        <tbody>
          {keys.map((k) => (
            <tr key={k.id}>
              <td>{k.name || <span className="muted">—</span>}</td>
              <td><code>{k.key_prefix}</code></td>
              <td>{k.request_count}</td>
              <td className="muted">{k.last_used_at ? new Date(k.last_used_at).toLocaleString() : "—"}</td>
              <td>{k.revoked ? <span className="pill off">revoked</span> : <span className="pill on">active</span>}</td>
              <td><button className="pill del" onClick={() => removeKey(k.id)}>delete</button></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

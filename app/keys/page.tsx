"use client";

import { useEffect, useState } from "react";
import Aurora from "../Aurora";
import UsageCharts from "../UsageCharts";

interface Key {
  id: string;
  name: string | null;
  key_prefix: string;
  created_at: string;
  last_used_at: string | null;
  request_count: number;
  revoked: boolean;
}

const REVEAL_SECONDS = 60;

interface Me {
  username: string | null;
  avatar: string | null;
  discord_id: string | null;
  role: string;
}

export default function KeysDashboard() {
  const [me, setMe] = useState<Me | null>(null);
  const [loading, setLoading] = useState(true);
  const [keys, setKeys] = useState<Key[]>([]);
  const [name, setName] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const [fresh, setFresh] = useState<{ key: string; left: number } | null>(null);

  useEffect(() => {
    (async () => {
      const meRes = await fetch("/api/auth/me");
      if (!meRes.ok) { window.location.href = "/login"; return; }
      setMe((await meRes.json()).user);
      await load();
      setLoading(false);
    })();
  }, []);

  // countdown for a freshly-created key
  useEffect(() => {
    if (!fresh) return;
    if (fresh.left <= 0) { setFresh(null); return; }
    const t = setTimeout(() => setFresh((f) => (f ? { ...f, left: f.left - 1 } : f)), 1000);
    return () => clearTimeout(t);
  }, [fresh]);

  async function load() {
    const r = await fetch("/api/account/keys");
    if (r.ok) setKeys((await r.json()).keys);
  }

  async function createKey() {
    setMsg(null);
    const r = await fetch("/api/account/keys", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: name || undefined }),
    });
    const j = await r.json();
    if (!r.ok) { setMsg(j.error || "Could not create key."); return; }
    setName("");
    setFresh({ key: j.key, left: REVEAL_SECONDS });
    load();
  }

  async function revoke(id: string) {
    await fetch("/api/account/keys/revoke", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id }) });
    load();
  }

  async function logout() {
    await fetch("/api/auth/logout", { method: "POST" });
    window.location.href = "/";
  }

  if (loading) {
    return (<><Aurora /><div className="dash"><p className="auth-sub" style={{ padding: 40 }}>Loading…</p></div></>);
  }

  return (
    <>
      <Aurora />
      <div className="dash">
        <nav className="lp-nav glass">
          <a className="lp-brand" href="/" style={{ textDecoration: "none" }}><span className="lp-logo" /> Qwen3.8&nbsp;API</a>
          <div className="lp-navcta">
            {me && (
              <div className="dash-me">
                {me.avatar
                  ? <img src={me.avatar.startsWith("http") ? me.avatar : `https://cdn.discordapp.com/avatars/${me.discord_id}/${me.avatar}.png`} alt="" />
                  : <span className="auth-avatar-fallback" />}
                <span className="dash-me-name">{me.username || "Account"}</span>
                {me.role && me.role !== "member" && <span className={`role-tag ${me.role}`}>{me.role}</span>}
              </div>
            )}
            <button className="g-btn outline" onClick={logout}>Sign out</button>
          </div>
        </nav>

        <div className="dash-body">
          <h1 className="lp-h2" style={{ textAlign: "left" }}>Usage</h1>
          <p className="auth-sub">Requests across all your keys, over the last 30 days.</p>
          <UsageCharts />

          <h2 className="lp-h2" style={{ textAlign: "left", fontSize: 24, marginTop: 44 }}>API keys</h2>
          <p className="auth-sub">Create and manage your API keys here.</p>

          {fresh && (
            <div className="dash-fresh glass">
              <div className="kg-key" style={{ background: "transparent", border: "none", padding: 0 }}>
                <code>{fresh.key}</code>
                <button className="kg-copy" onClick={() => navigator.clipboard?.writeText(fresh.key)}>Copy</button>
              </div>
              <p className="kg-count">Copy now — visible for {fresh.left}s, then hidden forever (we only store a hash).</p>
            </div>
          )}

          <div className="dash-actions">
            <div className="dash-act glass">
              <label className="auth-label">Create a new key</label>
              <div className="kg-row">
                <input className="kg-input" placeholder="Label (optional)" value={name} maxLength={80} onChange={(e) => setName(e.target.value)} />
                <button className="g-btn" onClick={createKey}>Create</button>
              </div>
            </div>
          </div>
          {msg && <p className="auth-sub" style={{ color: "var(--accent-2)" }}>{msg}</p>}

          <div className="dash-list glass">
            {keys.length === 0 && <p className="auth-sub" style={{ padding: 18, margin: 0 }}>No keys yet. Create one above.</p>}
            {keys.map((k) => (
              <div key={k.id} className={`dash-row ${k.revoked ? "revoked" : ""}`}>
                <div className="dash-row-main">
                  <div className="dash-row-name">{k.name || "Untitled key"}{k.revoked && <span className="dash-tag">revoked</span>}</div>
                  <code className="dash-row-prefix">{k.key_prefix}</code>
                </div>
                <div className="dash-row-meta">
                  <span>{k.request_count.toLocaleString()} req</span>
                  <span>{k.last_used_at ? `used ${new Date(k.last_used_at).toLocaleDateString()}` : "never used"}</span>
                </div>
                {!k.revoked && <button className="dash-revoke" onClick={() => revoke(k.id)}>Revoke</button>}
              </div>
            ))}
          </div>
        </div>
      </div>
    </>
  );
}

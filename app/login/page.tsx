"use client";

import { useEffect, useState } from "react";
import Aurora from "../Aurora";
import { useT } from "../I18n";

const INVITE = "https://discord.gg/Wcw95ZR8KU";

export default function LoginPage() {
  const t = useT();
  const [tab, setTab] = useState<"login" | "link">("login");

  // login
  const [key, setKey] = useState("");
  const [loginErr, setLoginErr] = useState<string | null>(null);
  const [loggingIn, setLoggingIn] = useState(false);

  // link
  const [code, setCode] = useState("");
  const [linkErr, setLinkErr] = useState<string | null>(null);
  const [linking, setLinking] = useState(false);
  const [linked, setLinked] = useState<{ username: string; avatar?: string; role: string; relay: string } | null>(null);
  const [dmStatus, setDmStatus] = useState<"sending" | "sent" | "dms_closed" | "failed">("sending");

  // After linking, poll for whether the bot delivered the DM (or DMs are closed).
  useEffect(() => {
    if (!linked || dmStatus === "sent" || dmStatus === "dms_closed") return;
    let alive = true;
    let tries = 0;
    const id = setInterval(async () => {
      tries++;
      try {
        const r = await fetch(`/api/auth/discord/dm-status?relay=${encodeURIComponent(linked.relay)}`);
        const j = await r.json();
        if (!alive) return;
        if (j.status === "sent" || j.status === "dms_closed" || j.status === "failed") setDmStatus(j.status);
      } catch { /* keep polling */ }
      if (tries >= 15) clearInterval(id); // ~30s then stop
    }, 2000);
    return () => { alive = false; clearInterval(id); };
  }, [linked, dmStatus]);

  async function login(e: React.FormEvent) {
    e.preventDefault();
    if (loggingIn) return;
    setLoggingIn(true); setLoginErr(null);
    try {
      const r = await fetch("/api/auth/discord/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ key }) });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || "Login failed.");
      // Bring any anonymous key from this browser along.
      const localKey = localStorage.getItem("qwen_api_key");
      if (localKey) await fetch("/api/account/keys/claim", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ key: localKey }) }).catch(() => {});
      window.location.href = "/keys";
    } catch (e: any) { setLoginErr(e.message); setLoggingIn(false); }
  }

  async function verify(e: React.FormEvent) {
    e.preventDefault();
    if (linking) return;
    setLinking(true); setLinkErr(null);
    try {
      const r = await fetch("/api/auth/discord/verify", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ code }) });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || "Could not verify.");
      setDmStatus("sending");
      setLinked({ username: j.discord.username, avatar: j.discord.avatar, role: j.discord.role, relay: j.relay });
    } catch (e: any) { setLinkErr(e.message); } finally { setLinking(false); }
  }

  async function reDm() {
    if (!linked) return;
    setDmStatus("sending");
    await fetch("/api/auth/discord/redm", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ relay: linked.relay }) }).catch(() => {});
  }

  const avatarUrl = linked?.avatar
    ? (linked.avatar.startsWith("http") ? linked.avatar : `https://cdn.discordapp.com/avatars/${linked.avatar}`)
    : null;

  return (
    <>
      <Aurora />
      <div className="auth-wrap">
        <a className="auth-brand" href="/"><span className="lp-logo" /> Qwen3.8&nbsp;API</a>
        <div className="auth-card glass">
          <div className="auth-tabs">
            <button className={tab === "login" ? "on" : ""} onClick={() => setTab("login")}>{t("login_title")}</button>
            <button className={tab === "link" ? "on" : ""} onClick={() => setTab("link")}>{t("login_link_discord")}</button>
          </div>

          {tab === "login" ? (
            <form onSubmit={login}>
              <h1>{t("login_title")}</h1>
              <p className="auth-sub">{t("login_enter_dm_key")}</p>
              <label className="auth-label">{t("login_key_label")}</label>
              <input className="kg-input" type="password" placeholder="qkey_…" value={key} onChange={(e) => setKey(e.target.value)} autoComplete="off" required />
              {loginErr && <p className="kg-err" style={{ marginTop: 12 }}>{loginErr}</p>}
              <button className="g-btn lg" type="submit" disabled={loggingIn} style={{ width: "100%", justifyContent: "center", marginTop: 18 }}>
                {loggingIn ? "…" : "Log in"}
              </button>
              <p className="auth-alt">{t("login_no_account")} <a onClick={() => setTab("link")} style={{ cursor: "pointer" }}>{t("login_link_your_discord")}</a></p>
            </form>
          ) : (
            <div>
              <h1>{t("login_link_your_discord")}</h1>
              {!linked ? (
                <>
                  <ol className="auth-steps">
                    <li>{t("login_join_the")} <a href={INVITE} target="_blank" rel="noreferrer">{t("login_discord_server")}</a>.</li>
                    <li>{t("login_run")} <code>/link</code> in the link channel — the bot DMs/replies with a code.</li>
                    <li>{t("login_enter_code_below")}</li>
                  </ol>
                  <form onSubmit={verify}>
                    <label className="auth-label">{t("login_your_link_code")}</label>
                    <input className="kg-input" placeholder="QW-XXXXXX" value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} autoComplete="off" required />
                    {linkErr && <p className="kg-err" style={{ marginTop: 12 }}>{linkErr}</p>}
                    <button className="g-btn lg" type="submit" disabled={linking} style={{ width: "100%", justifyContent: "center", marginTop: 18 }}>
                      {linking ? "…" : "Verify & link"}
                    </button>
                  </form>
                </>
              ) : (
                <div className="auth-linked">
                  <div className="auth-profile">
                    {avatarUrl ? <img src={avatarUrl} alt="" /> : <span className="auth-avatar-fallback" />}
                    <div>
                      <div className="auth-profile-name">{linked.username} {linked.role !== "member" && <span className={`role-tag ${linked.role}`}>{linked.role}</span>}</div>
                      <div className="auth-sub" style={{ margin: 0 }}>{t("login_linked")}</div>
                    </div>
                  </div>
                  {dmStatus === "sent" ? (
                    <p className="auth-ok">📬 Login key sent to your Discord DMs. Copy it, then <a onClick={() => setTab("login")} style={{ cursor: "pointer" }}>log in</a>.</p>
                  ) : dmStatus === "dms_closed" ? (
                    <p className="auth-warn">⚠️ Your DMs are off, so we couldn't send it. In the server: <b>right-click the server → Privacy Settings → enable Direct Messages</b>, then Re-DM.</p>
                  ) : (
                    <p className="auth-ok">⏳ Sending your login key to your Discord DMs… (this needs the bot online — give it a few seconds.)</p>
                  )}
                  <div style={{ display: "flex", gap: 10, marginTop: 12 }}>
                    <button className="g-btn outline" onClick={reDm}>{t("login_redm")}</button>
                    <button className="g-btn" onClick={() => setTab("login")}>{t("login_have_key")}</button>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </>
  );
}

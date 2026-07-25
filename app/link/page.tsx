"use client";

// "Bring your own token" page — clean, light, high-contrast. Establishes its own
// light canvas (the rest of the app is dark). A user links their API key to their
// own chat.deepseek.com token so their deepseek-* traffic runs on their own account.

import { useEffect, useState } from "react";
import Aurora from "../Aurora";

const KEY_STORE = "qwen_api_key"; // shared with the other pages

export default function LinkPage() {
  const [apiKey, setApiKey] = useState("");
  const [token, setToken] = useState("");
  const [busy, setBusy] = useState(false);
  const [linked, setLinked] = useState<boolean | null>(null);
  const [msg, setMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(null);

  useEffect(() => {
    const k = localStorage.getItem(KEY_STORE) || "";
    setApiKey(k);
    if (k) checkStatus(k);
  }, []);

  async function checkStatus(key: string) {
    try {
      const r = await fetch("/api/link/deepseek", { headers: { Authorization: `Bearer ${key}` } });
      const j = await r.json();
      setLinked(r.ok ? Boolean(j.linked) : null);
    } catch {
      setLinked(null);
    }
  }

  async function link() {
    if (!apiKey.trim() || !token.trim() || busy) return;
    setBusy(true);
    setMsg(null);
    try {
      localStorage.setItem(KEY_STORE, apiKey.trim());
      const r = await fetch("/api/link/deepseek", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ apiKey: apiKey.trim(), token: token.trim() }),
      });
      const j = await r.json();
      if (r.ok) {
        setMsg({ kind: "ok", text: j.message || "Linked!" });
        setLinked(true);
        setToken("");
      } else {
        setMsg({ kind: "err", text: j.error || "Something went wrong." });
      }
    } catch (e: any) {
      setMsg({ kind: "err", text: e.message || "Network error." });
    } finally {
      setBusy(false);
    }
  }

  async function unlink() {
    if (!apiKey.trim() || busy) return;
    setBusy(true);
    setMsg(null);
    try {
      const r = await fetch("/api/link/deepseek", { method: "DELETE", headers: { Authorization: `Bearer ${apiKey.trim()}` } });
      if (r.ok) {
        setLinked(false);
        setMsg({ kind: "ok", text: "Unlinked. Your token was removed." });
      } else {
        const j = await r.json();
        setMsg({ kind: "err", text: j.error || "Could not unlink." });
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="lk-root">
      <style>{css}</style>
      <Aurora />
      <div className="lk-col">
        <nav className="lk-nav">
          <a href="/">← Home</a>
          <a href="/models">Browse models →</a>
        </nav>

        <span className="lk-badge">Bring your own token</span>
        <h1 className="lk-title">Link your DeepSeek account</h1>
        <p className="lk-lead">
          The <code>deepseek-*</code> models run on <b>your own</b> chat.deepseek.com account. Link it to your API key once —
          then DeepSeek works everywhere you use your key: the API, playground, and chat.
        </p>

        <div className="lk-warn">
          <span className="lk-warn-ico">⚠️</span>
          <div>
            <div className="lk-warn-title">Your DeepSeek account may get banned</div>
            <p>
              This automates the DeepSeek web app, which is against their Terms — under heavy use an account can be
              rate-limited or suspended. Use an account you don&apos;t mind losing, never your main one. Everything runs on the
              account <i>you</i> link; no one else&apos;s is touched.
            </p>
          </div>
        </div>

        <div className="lk-card">
          <label className="lk-label" htmlFor="lk-key">Your API key</label>
          <input id="lk-key" className="lk-input" type="password" placeholder="qwen_sk_…" value={apiKey} onChange={(e) => setApiKey(e.target.value)} />
          <div className="lk-hint">No key yet? <a href="/keys">Create one</a> first.</div>

          <label className="lk-label" htmlFor="lk-tok" style={{ marginTop: 20 }}>Your DeepSeek token</label>
          <input id="lk-tok" className="lk-input" type="password" placeholder="paste your chat.deepseek.com token" value={token} onChange={(e) => setToken(e.target.value)} onKeyDown={(e) => e.key === "Enter" && link()} />

          <div className="lk-actions">
            <button className="lk-btn" onClick={link} disabled={busy || !apiKey.trim() || !token.trim()}>
              {busy ? "Linking…" : linked ? "Update token" : "Link account"}
            </button>
            {linked && <button className="lk-btn ghost" onClick={unlink} disabled={busy}>Unlink</button>}
          </div>

          {msg ? (
            <div className={`lk-status ${msg.kind}`}>{msg.kind === "ok" ? "✓ " : "✕ "}{msg.text}</div>
          ) : linked === true ? (
            <div className="lk-status ok">✓ This API key is linked to a DeepSeek account.</div>
          ) : linked === false ? (
            <div className="lk-status neutral">Not linked yet.</div>
          ) : null}
        </div>

        <h2 className="lk-h2">How to get your DeepSeek token</h2>

        <ol className="lk-steps">
          <li className="lk-step">
            <span className="lk-num">1</span>
            <div>
              <div className="lk-step-title">Log in at chat.deepseek.com</div>
              <p>Open <a href="https://chat.deepseek.com" target="_blank" rel="noreferrer">chat.deepseek.com</a> and sign in with the account you want to use.</p>
            </div>
          </li>

          <li className="lk-step">
            <span className="lk-num">2</span>
            <div>
              <div className="lk-step-title">Open DevTools → Network</div>
              <p>Press <kbd>F12</kbd>, click the <b>Network</b> tab, then send any message in the chat so requests appear.</p>
              <div className="lk-mock">
                <div className="lk-mock-bar"><span>Elements</span><span className="on">Network</span><span>Console</span></div>
                <div className="lk-mock-body">
                  <span>POST&nbsp;&nbsp;chat_session/create</span>
                  <span>POST&nbsp;&nbsp;create_pow_challenge</span>
                  <span className="hl">POST&nbsp;&nbsp;completion&nbsp;&nbsp;← click one of these</span>
                </div>
              </div>
            </div>
          </li>

          <li className="lk-step">
            <span className="lk-num">3</span>
            <div>
              <div className="lk-step-title">Copy the token from the request headers</div>
              <p>In the request&apos;s <b>Headers</b> → <b>Request Headers</b>, find <code>authorization</code> and copy everything after <code>Bearer&nbsp;</code>.</p>
              <div className="lk-code">authorization: Bearer <b>eyJhbGci…f3Kp9q</b> <span className="lk-dim">← copy this</span></div>
            </div>
          </li>

          <li className="lk-step">
            <span className="lk-num">4</span>
            <div>
              <div className="lk-step-title">Paste it above &amp; Link</div>
              <p>We test the token against DeepSeek before saving, so a stale one fails right away — just grab a fresh one and retry.</p>
            </div>
          </li>
        </ol>

        <details className="lk-alt">
          <summary>Quicker, but sometimes stale: Application → Local Storage</summary>
          <p>
            DevTools → <b>Application</b> → <b>Local Storage</b> → <code>chat.deepseek.com</code> → click <code>userToken</code> →
            copy the <code>value</code>. Faster, but it can be an expired token; if linking fails, use the Network-tab method above.
          </p>
        </details>

        <p className="lk-foot">
          Your token is stored server-side and used only to talk to DeepSeek on your behalf — never shown to anyone or returned
          by the API. Unlink any time.
        </p>
      </div>
    </div>
  );
}

const css = `
.lk-root { position:relative; min-height:100dvh; color:var(--text); -webkit-font-smoothing:antialiased; }
.lk-col { position:relative; z-index:1; max-width:580px; margin:0 auto; padding:40px 22px 96px; }
.lk-root code { font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace; font-size:0.86em; background:rgba(255,255,255,.06); border:1px solid var(--glass-brd); border-radius:5px; padding:1.5px 5px; color:#cdd2e6; }
.lk-root a { color:var(--accent-2); text-decoration:none; font-weight:500; }
.lk-root a:hover { text-decoration:underline; }
.lk-root b { font-weight:600; color:var(--text); }

.lk-nav { display:flex; justify-content:space-between; font-size:13.5px; margin-bottom:36px; }
.lk-nav a { color:var(--muted); font-weight:500; }

.lk-badge { display:inline-block; font-size:12px; font-weight:600; color:var(--accent-2); background:var(--glass); border:1px solid var(--glass-brd); border-radius:999px; padding:5px 12px; margin-bottom:18px; backdrop-filter:blur(10px); }
.lk-title { font-size:34px; line-height:1.1; letter-spacing:-0.03em; font-weight:730; margin:0 0 14px; }
.lk-title { background:linear-gradient(100deg,#fff,var(--accent) 55%,var(--accent-2)); -webkit-background-clip:text; background-clip:text; color:transparent; }
.lk-lead { font-size:16px; line-height:1.65; color:var(--muted); margin:0 0 30px; }

.lk-warn { display:flex; gap:12px; align-items:flex-start; background:rgba(255,176,60,.08); border:1px solid rgba(255,176,60,.28); border-radius:14px; padding:15px 17px; margin:0 0 30px; }
.lk-warn-ico { font-size:16px; line-height:1.5; }
.lk-warn-title { font-size:14px; font-weight:650; color:#ffca8a; }
.lk-warn p { margin:5px 0 0; font-size:13.5px; line-height:1.6; color:#e6c9a0; }
.lk-warn b { color:#ffdca8; }

.lk-card { background:var(--glass); border:1px solid var(--glass-brd); border-radius:16px; padding:24px; margin:0 0 44px; backdrop-filter:blur(16px); -webkit-backdrop-filter:blur(16px); }
.lk-label { display:block; font-size:13px; font-weight:600; color:#cdd2e6; margin-bottom:7px; }
.lk-input { width:100%; box-sizing:border-box; background:rgba(0,0,0,.28); border:1px solid var(--glass-brd); border-radius:10px; padding:11px 13px; font-size:14.5px; color:var(--text); outline:none; transition:border-color .12s, box-shadow .12s; font-family:inherit; }
.lk-input::placeholder { color:#6b7189; }
.lk-input:focus { border-color:var(--accent); box-shadow:0 0 0 3.5px rgba(124,108,255,0.18); }
.lk-hint { font-size:12.5px; color:var(--muted); margin-top:7px; }

.lk-actions { display:flex; gap:10px; margin-top:22px; }
.lk-btn { background:linear-gradient(90deg,var(--accent),var(--accent-2)); color:#07080d; font-weight:600; font-size:14px; border:none; border-radius:10px; padding:11px 20px; cursor:pointer; transition:transform .12s; font-family:inherit; box-shadow:var(--shadow-glow); }
.lk-btn:hover:not(:disabled) { transform:translateY(-1px); }
.lk-btn:disabled { opacity:.5; cursor:default; }
.lk-btn.ghost { background:var(--glass); color:var(--text); border:1px solid var(--glass-brd); box-shadow:none; font-weight:500; }
.lk-btn.ghost:hover:not(:disabled) { background:var(--glass-strong); }

.lk-status { margin-top:16px; font-size:13.5px; padding:11px 13px; border-radius:10px; line-height:1.5; }
.lk-status.ok { background:rgba(56,224,176,.10); border:1px solid rgba(56,224,176,.32); color:#7ff0cf; }
.lk-status.err { background:rgba(255,120,120,.10); border:1px solid rgba(255,120,120,.32); color:#ff9a9a; }
.lk-status.neutral { background:rgba(255,255,255,.04); border:1px solid var(--glass-brd); color:var(--muted); }

.lk-h2 { font-size:17px; font-weight:650; color:var(--text); margin:0 0 22px; letter-spacing:-0.01em; }
.lk-steps { list-style:none; margin:0 0 28px; padding:0; display:flex; flex-direction:column; gap:24px; }
.lk-step { display:flex; gap:15px; }
.lk-num { flex:none; width:28px; height:28px; border-radius:999px; background:var(--glass); border:1px solid var(--glass-brd); color:var(--accent-2); font-weight:700; font-size:13.5px; display:flex; align-items:center; justify-content:center; }
.lk-step-title { font-size:15px; font-weight:600; color:var(--text); margin-bottom:5px; }
.lk-step p { margin:0; font-size:14px; line-height:1.62; color:var(--muted); }

.lk-mock { margin-top:12px; border:1px solid var(--glass-brd); border-radius:10px; overflow:hidden; }
.lk-mock-bar { display:flex; gap:3px; padding:7px 9px; background:rgba(0,0,0,.28); border-bottom:1px solid var(--glass-brd); }
.lk-mock-bar span { padding:3px 9px; border-radius:6px; color:var(--muted); font-size:12px; }
.lk-mock-bar span.on { background:rgba(255,255,255,.08); color:var(--accent-2); font-weight:600; }
.lk-mock-body { padding:10px 12px; background:rgba(0,0,0,.2); font-family:ui-monospace,Menlo,Consolas,monospace; font-size:12.5px; color:#a7adbf; display:flex; flex-direction:column; gap:5px; }
.lk-mock-body .hl { color:var(--accent-2); font-weight:600; }

.lk-code { margin-top:11px; background:rgba(0,0,0,.28); border:1px solid var(--glass-brd); border-radius:10px; padding:11px 13px; font-family:ui-monospace,Menlo,Consolas,monospace; font-size:12.5px; color:#a7adbf; word-break:break-all; }
.lk-code b { color:var(--accent-2); font-weight:700; }
.lk-dim { color:#6b7189; }
.lk-root kbd { background:rgba(255,255,255,.06); border:1px solid var(--glass-brd); border-bottom-width:2px; border-radius:6px; padding:1px 6px; font-size:12px; font-family:inherit; color:#cdd2e6; }

.lk-alt { font-size:13.5px; color:var(--muted); margin-bottom:34px; border-top:1px solid var(--glass-brd); padding-top:20px; }
.lk-alt summary { cursor:pointer; color:#cdd2e6; font-weight:600; }
.lk-alt p { margin:10px 0 0; line-height:1.62; }

.lk-foot { font-size:12.5px; color:var(--muted); line-height:1.6; margin:0; border-top:1px solid var(--glass-brd); padding-top:20px; }
`;

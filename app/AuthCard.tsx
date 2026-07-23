"use client";

import { useState } from "react";
import Aurora from "./Aurora";

export default function AuthCard({ mode }: { mode: "login" | "signup" }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isSignup = mode === "signup";

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const r = await fetch(`/api/auth/${mode}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || "Something went wrong.");
      // Bring any anonymous key from this browser along so it's not lost.
      const localKey = localStorage.getItem("qwen_api_key");
      if (localKey) {
        await fetch("/api/account/keys/claim", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ key: localKey }),
        }).catch(() => {});
      }
      window.location.href = "/keys";
    } catch (e: any) {
      setError(e.message);
      setBusy(false);
    }
  }

  return (
    <>
      <Aurora state="idle" />
      <div className="auth-wrap">
        <a className="auth-brand" href="/"><span className="lp-logo" /> Qwen3.8&nbsp;API</a>
        <form className="auth-card glass" onSubmit={submit}>
          <h1>{isSignup ? "Create your account" : "Welcome back"}</h1>
          <p className="auth-sub">{isSignup ? "No email verification — you're in instantly." : "Sign in to manage your API keys."}</p>

          <label className="auth-label">Email</label>
          <input className="kg-input" type="email" autoComplete="email" value={email}
            onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" required />

          <label className="auth-label" style={{ marginTop: 14 }}>Password</label>
          <input className="kg-input" type="password" autoComplete={isSignup ? "new-password" : "current-password"}
            value={password} onChange={(e) => setPassword(e.target.value)}
            placeholder={isSignup ? "At least 8 characters" : "Your password"} required minLength={8} />

          {error && <p className="kg-err" style={{ marginTop: 12 }}>{error}</p>}

          <button className="g-btn lg" type="submit" disabled={busy} style={{ width: "100%", justifyContent: "center", marginTop: 18 }}>
            {busy ? "…" : isSignup ? "Create account" : "Sign in"}
          </button>

          <p className="auth-alt">
            {isSignup ? <>Already have an account? <a href="/login">Sign in</a></> : <>New here? <a href="/signup">Create an account</a></>}
          </p>
        </form>
      </div>
    </>
  );
}

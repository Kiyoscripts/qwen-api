"use client";

import { useEffect, useRef, useState } from "react";

// Seconds the full key stays visible/copyable after generation. After this it's
// permanently masked — we only store a hash, so it genuinely can't be shown again.
const REVEAL_SECONDS = 60;

export default function KeyGenerator() {
  const [name, setName] = useState("");
  const [loading, setLoading] = useState(false);
  const [key, setKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [left, setLeft] = useState(0); // seconds left in the reveal window
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => () => { if (timer.current) clearInterval(timer.current); }, []);

  async function generate() {
    setLoading(true);
    setError(null);
    setKey(null);
    setCopied(false);
    try {
      const r = await fetch("/api/keys", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: name || undefined }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || "Failed to create key");
      setKey(j.key);
      // Remember it in this browser so signing up can auto-link it to the account.
      try { localStorage.setItem("qwen_api_key", j.key); } catch {}
      // start the reveal countdown
      setLeft(REVEAL_SECONDS);
      if (timer.current) clearInterval(timer.current);
      timer.current = setInterval(() => {
        setLeft((s) => {
          if (s <= 1) {
            if (timer.current) clearInterval(timer.current);
            return 0; // window closed -> key gets masked
          }
          return s - 1;
        });
      }, 1000);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }

  async function copy() {
    if (!key) return;
    try {
      await navigator.clipboard.writeText(key);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard blocked; user can select manually while visible */
    }
  }

  const revealed = key && left > 0;
  const masked = key ? `${key.slice(0, 11)}${"•".repeat(18)}${key.slice(-4)}` : "";

  return (
    <div className="kg">
      <div className="kg-row">
        <input
          className="kg-input"
          placeholder="Label (optional) — e.g. my app"
          value={name}
          maxLength={80}
          onChange={(e) => setName(e.target.value)}
          disabled={loading}
        />
        <button className="g-btn" onClick={generate} disabled={loading}>
          {loading ? "Generating…" : "Generate key"}
        </button>
      </div>

      {error && <p className="kg-err">Error: {error}</p>}

      {revealed && (
        <>
          <div className="kg-key">
            <code>{key}</code>
            <button className="kg-copy" onClick={copy}>{copied ? "Copied ✓" : "Copy"}</button>
          </div>
          <p className="kg-count">
            Copy it now — visible for {left}s, then it&apos;s hidden forever (we only store a hash).
          </p>
        </>
      )}

      {key && !revealed && (
        <div className="kg-hidden">
          Key created &amp; now hidden for good. <code>{masked}</code>
          <br />If you didn&apos;t copy it, generate a new one.
        </div>
      )}
    </div>
  );
}

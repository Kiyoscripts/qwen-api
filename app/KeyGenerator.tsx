"use client";

import { useState } from "react";

export default function KeyGenerator() {
  const [name, setName] = useState("");
  const [loading, setLoading] = useState(false);
  const [key, setKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

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
      /* clipboard may be blocked; user can select manually */
    }
  }

  return (
    <div className="keygen">
      <div className="row">
        <input
          className="input"
          placeholder="Label (optional), e.g. my app"
          value={name}
          maxLength={80}
          onChange={(e) => setName(e.target.value)}
          disabled={loading}
        />
        <button className="btn" onClick={generate} disabled={loading}>
          {loading ? "Generating…" : "Generate key"}
        </button>
      </div>

      {error && <p className="err">Error: {error}</p>}

      {key && (
        <div className="keybox">
          <code className="keyval">{key}</code>
          <button className="btn ghost" onClick={copy}>
            {copied ? "Copied" : "Copy"}
          </button>
          <p className="hint">
            Save this now — it&apos;s shown only once. Use it as{" "}
            <code>Authorization: Bearer &lt;key&gt;</code>.
          </p>
        </div>
      )}
    </div>
  );
}

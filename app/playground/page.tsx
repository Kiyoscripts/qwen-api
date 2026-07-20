"use client";

import { useEffect, useRef, useState } from "react";

const MODEL = "qwen3.8-max-preview";

interface Turn {
  role: "user" | "assistant";
  content: string;
  reasoning?: string;
  image?: string; // data URL, user turns only
}

// Build the OpenAI-style messages array from display turns.
function toApiMessages(turns: Turn[]) {
  return turns.map((t) => {
    if (t.role === "user" && t.image) {
      return {
        role: "user",
        content: [
          { type: "text", text: t.content },
          { type: "image_url", image_url: { url: t.image } },
        ],
      };
    }
    return { role: t.role, content: t.content };
  });
}

export default function Playground() {
  const [apiKey, setApiKey] = useState("");
  const [input, setInput] = useState("");
  const [image, setImage] = useState<string | null>(null);
  const [turns, setTurns] = useState<Turn[]>([]);
  const [busy, setBusy] = useState(false);
  const [showThinking, setShowThinking] = useState(true);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const k = localStorage.getItem("qwen_api_key");
    if (k) setApiKey(k);
  }, []);
  useEffect(() => {
    if (apiKey) localStorage.setItem("qwen_api_key", apiKey);
  }, [apiKey]);
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [turns]);

  async function onImage(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => setImage(reader.result as string);
    reader.readAsDataURL(file);
  }

  async function send() {
    const text = input.trim();
    if ((!text && !image) || busy) return;
    if (!apiKey) return;

    const userTurn: Turn = { role: "user", content: text || "(image)", image: image || undefined };
    const history = [...turns, userTurn];
    setTurns([...history, { role: "assistant", content: "", reasoning: "" }]);
    setInput("");
    setImage(null);
    setBusy(true);

    try {
      const res = await fetch("/v1/chat/completions", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
        body: JSON.stringify({ model: MODEL, stream: true, messages: toApiMessages(history) }),
      });
      if (!res.ok || !res.body) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j?.error?.message || `HTTP ${res.status}`);
      }
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let content = "";
      let reasoning = "";
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        let idx: number;
        while ((idx = buffer.indexOf("\n")) !== -1) {
          const line = buffer.slice(0, idx).trim();
          buffer = buffer.slice(idx + 1);
          if (!line.startsWith("data:")) continue;
          const data = line.slice(5).trim();
          if (data === "[DONE]") continue;
          try {
            const evt = JSON.parse(data);
            const d = evt?.choices?.[0]?.delta;
            if (d?.reasoning_content) reasoning += d.reasoning_content;
            if (d?.content) content += d.content;
            setTurns((prev) => {
              const copy = [...prev];
              copy[copy.length - 1] = { role: "assistant", content, reasoning };
              return copy;
            });
          } catch {
            /* ignore */
          }
        }
      }
    } catch (e: any) {
      setTurns((prev) => {
        const copy = [...prev];
        copy[copy.length - 1] = { role: "assistant", content: `⚠️ ${e.message}` };
        return copy;
      });
    } finally {
      setBusy(false);
    }
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  }

  return (
    <div className="pg">
      <header className="pg-head">
        <a href="/" className="pg-back">← Qwen3.8 API</a>
        <span className="pg-title">Playground</span>
        <label className="pg-toggle">
          <input type="checkbox" checked={showThinking} onChange={(e) => setShowThinking(e.target.checked)} />
          Show thinking
        </label>
      </header>

      <div className="pg-key">
        <input
          className="input"
          type="password"
          placeholder="Paste your API key (qwen_sk_…)"
          value={apiKey}
          onChange={(e) => setApiKey(e.target.value)}
        />
        <a className="btn ghost" href="/#get-a-key">Get a key</a>
      </div>

      <div className="pg-chat" ref={scrollRef}>
        {turns.length === 0 && <p className="pg-empty">Start chatting — attach an image to try vision.</p>}
        {turns.map((t, i) => (
          <div key={i} className={`bubble ${t.role}`}>
            {t.image && <img className="bubble-img" src={t.image} alt="attachment" />}
            {t.role === "assistant" && showThinking && t.reasoning ? (
              <details className="thinking" open>
                <summary>Thinking</summary>
                <div>{t.reasoning}</div>
              </details>
            ) : null}
            <div className="bubble-text">{t.content || (t.role === "assistant" && busy ? "…" : "")}</div>
          </div>
        ))}
      </div>

      <div className="pg-composer">
        {image && (
          <div className="pg-attach">
            <img src={image} alt="to send" />
            <button onClick={() => setImage(null)}>×</button>
          </div>
        )}
        <div className="pg-inputrow">
          <label className="btn ghost pg-attach-btn">
            + Image
            <input type="file" accept="image/*" onChange={onImage} hidden />
          </label>
          <textarea
            className="pg-textarea"
            placeholder={apiKey ? "Message…  (Enter to send, Shift+Enter for newline)" : "Enter your API key above first"}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={onKeyDown}
            rows={1}
            disabled={!apiKey}
          />
          <button className="btn" onClick={send} disabled={busy || !apiKey || (!input.trim() && !image)}>
            {busy ? "…" : "Send"}
          </button>
        </div>
      </div>
    </div>
  );
}

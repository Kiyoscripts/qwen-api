"use client";

import { useCallback, useEffect, useRef, useState } from "react";

type Mode = "chat" | "image" | "video";

interface ModelOpt {
  id: string;
  name: string;
  chatTypes: string[];
}
interface Turn {
  role: "user" | "assistant";
  content: string;
  reasoning?: string;
  image?: string; // user attachment (data URL)
  mediaUrl?: string; // assistant result
  mediaType?: "image" | "video";
  pending?: boolean;
}

export default function Playground() {
  const [apiKey, setApiKey] = useState("");
  const [models, setModels] = useState<ModelOpt[]>([]);
  const [model, setModel] = useState("qwen3.8-max-preview");
  const [mode, setMode] = useState<Mode>("chat");
  const [input, setInput] = useState("");
  const [image, setImage] = useState<string | null>(null);
  const [turns, setTurns] = useState<Turn[]>([]);
  const [busy, setBusy] = useState(false);
  const [showThinking, setShowThinking] = useState(true);
  const scrollRef = useRef<HTMLDivElement>(null);

  const current = models.find((m) => m.id === model);
  const canImage = current?.chatTypes.includes("t2i") ?? true;
  const canVideo = current?.chatTypes.includes("t2v") ?? true;

  const loadModels = useCallback(async (key: string) => {
    if (!key) return;
    try {
      const r = await fetch("/v1/models", { headers: { Authorization: `Bearer ${key}` } });
      if (!r.ok) return;
      const j = await r.json();
      const opts: ModelOpt[] = (j.data || []).map((m: any) => ({
        id: m.id,
        name: m.display_name || m.id,
        chatTypes: m.capabilities?.chat_types || ["t2t"],
      }));
      setModels(opts);
      if (opts.length && !opts.find((o) => o.id === model)) setModel(opts[0].id);
    } catch {
      /* ignore */
    }
  }, [model]);

  useEffect(() => {
    const k = localStorage.getItem("qwen_api_key");
    if (k) {
      setApiKey(k);
      loadModels(k);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    if (apiKey) localStorage.setItem("qwen_api_key", apiKey);
  }, [apiKey]);
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [turns]);
  // If current model can't do the selected mode, fall back to chat.
  useEffect(() => {
    if (mode === "image" && !canImage) setMode("chat");
    if (mode === "video" && !canVideo) setMode("chat");
  }, [model, mode, canImage, canVideo]);

  function onImage(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => setImage(reader.result as string);
    reader.readAsDataURL(file);
  }

  function toApiMessages(list: Turn[]) {
    return list.map((t) => {
      if (t.role === "user" && t.image) {
        return { role: "user", content: [{ type: "text", text: t.content }, { type: "image_url", image_url: { url: t.image } }] };
      }
      return { role: t.role, content: t.content };
    });
  }

  async function sendChat(history: Turn[]) {
    const res = await fetch("/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({ model, stream: true, messages: toApiMessages(history) }),
    });
    if (!res.ok || !res.body) {
      const j = await res.json().catch(() => ({}));
      throw new Error(j?.error?.message || `HTTP ${res.status}`);
    }
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "", content = "", reasoning = "";
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
          const d = JSON.parse(data)?.choices?.[0]?.delta;
          if (d?.reasoning_content) reasoning += d.reasoning_content;
          if (d?.content) content += d.content;
          setTurns((prev) => {
            const c = [...prev];
            c[c.length - 1] = { role: "assistant", content, reasoning };
            return c;
          });
        } catch {}
      }
    }
  }

  async function sendGeneration(prompt: string, kind: "image" | "video") {
    const url = kind === "image" ? "/v1/images/generations" : "/v1/videos/generations";
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({ model, prompt }),
    });
    const j = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(j?.error?.message || `HTTP ${res.status}`);
    const mediaUrl = j?.data?.[0]?.url;
    if (!mediaUrl) throw new Error("No media returned");
    setTurns((prev) => {
      const c = [...prev];
      c[c.length - 1] = { role: "assistant", content: "", mediaUrl, mediaType: kind };
      return c;
    });
  }

  async function send() {
    const text = input.trim();
    if ((!text && !image) || busy || !apiKey) return;

    const userTurn: Turn = { role: "user", content: text || (mode === "chat" ? "(image)" : ""), image: image || undefined };
    const history = [...turns, userTurn];
    const pendingLabel = mode === "video" ? "Generating video… (up to a few minutes)" : mode === "image" ? "Generating image…" : "";
    setTurns([...history, { role: "assistant", content: pendingLabel, pending: true }]);
    setInput("");
    setImage(null);
    setBusy(true);
    try {
      if (mode === "chat") await sendChat(history);
      else await sendGeneration(text, mode);
    } catch (e: any) {
      setTurns((prev) => {
        const c = [...prev];
        c[c.length - 1] = { role: "assistant", content: `⚠️ ${e.message}` };
        return c;
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

  const placeholder = !apiKey
    ? "Enter your API key above first"
    : mode === "image"
    ? "Describe an image to generate…"
    : mode === "video"
    ? "Describe a video to generate…"
    : "Message…  (Enter to send)";

  return (
    <div className="pg">
      <header className="pg-head">
        <a href="/" className="pg-back">← Qwen3.8 API</a>
        <span className="pg-title">Playground</span>
        {mode === "chat" && (
          <label className="pg-toggle">
            <input type="checkbox" checked={showThinking} onChange={(e) => setShowThinking(e.target.checked)} />
            Show thinking
          </label>
        )}
      </header>

      <div className="pg-key">
        <input
          className="input"
          type="password"
          placeholder="Paste your API key (qwen_sk_…)"
          value={apiKey}
          onChange={(e) => setApiKey(e.target.value)}
          onBlur={() => loadModels(apiKey)}
        />
        <a className="btn ghost" href="/#get-a-key">Get a key</a>
      </div>

      <div className="pg-controls">
        <select className="input pg-select" value={model} onChange={(e) => setModel(e.target.value)}>
          {models.length === 0 && <option value={model}>{model}</option>}
          {models.map((m) => (
            <option key={m.id} value={m.id}>{m.name}</option>
          ))}
        </select>
        <div className="pg-modes">
          <button className={`pill ${mode === "chat" ? "on" : ""}`} onClick={() => setMode("chat")}>Chat</button>
          <button className={`pill ${mode === "image" ? "on" : ""}`} onClick={() => setMode("image")} disabled={!canImage} title={canImage ? "" : "This model can't generate images"}>Image</button>
          <button className={`pill ${mode === "video" ? "on" : ""}`} onClick={() => setMode("video")} disabled={!canVideo} title={canVideo ? "" : "This model can't generate video"}>Video</button>
        </div>
      </div>

      <div className="pg-chat" ref={scrollRef}>
        {turns.length === 0 && <p className="pg-empty">Pick a model and mode, then start. Chat supports image input; Image/Video generate media.</p>}
        {turns.map((t, i) => (
          <div key={i} className={`bubble ${t.role}`}>
            {t.image && <img className="bubble-img" src={t.image} alt="attachment" />}
            {t.role === "assistant" && showThinking && t.reasoning ? (
              <details className="thinking" open>
                <summary>Thinking</summary>
                <div>{t.reasoning}</div>
              </details>
            ) : null}
            {t.mediaUrl && t.mediaType === "image" && <img className="bubble-media" src={t.mediaUrl} alt="generated" />}
            {t.mediaUrl && t.mediaType === "video" && <video className="bubble-media" src={t.mediaUrl} controls />}
            {t.content && <div className="bubble-text">{t.content}</div>}
            {t.pending && <span className="spin" />}
          </div>
        ))}
      </div>

      <div className="pg-composer">
        {mode === "chat" && image && (
          <div className="pg-attach">
            <img src={image} alt="to send" />
            <button onClick={() => setImage(null)}>×</button>
          </div>
        )}
        <div className="pg-inputrow">
          {mode === "chat" && (
            <label className="btn ghost pg-attach-btn">
              + Image
              <input type="file" accept="image/*" onChange={onImage} hidden />
            </label>
          )}
          <textarea
            className="pg-textarea"
            placeholder={placeholder}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={onKeyDown}
            rows={1}
            disabled={!apiKey || busy}
          />
          <button className="btn" onClick={send} disabled={busy || !apiKey || (!input.trim() && !(mode === "chat" && image))}>
            {busy ? "…" : mode === "chat" ? "Send" : "Generate"}
          </button>
        </div>
      </div>
    </div>
  );
}

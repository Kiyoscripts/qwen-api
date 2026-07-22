"use client";

// Test harness for the reverse-engineered DeepSeek backend. Hits the same
// OpenAI-compatible /v1/chat/completions endpoint (which dispatches deepseek-*
// models to chat.deepseek.com), so it exercises the real integration end to end:
// model selection (Flash / Pro / Vision), the DeepThink toggle (reasoning_content),
// streaming, and image upload for vision.

import { useEffect, useRef, useState } from "react";

interface Msg {
  role: "user" | "assistant";
  content: string;
  reasoning?: string;
  image?: string;
}

const KEY_STORE = "qwen_api_key"; // shared with /chat
const MODELS = [
  { id: "deepseek-v4-flash", name: "Flash", desc: "Instant", vision: false },
  { id: "deepseek-v4-pro", name: "Pro", desc: "Expert · reasoning", vision: false },
  { id: "deepseek-v4-vision", name: "Vision", desc: "Image understanding (beta)", vision: true },
];

export default function DeepSeekChat() {
  const [apiKey, setApiKey] = useState("");
  const [keyDraft, setKeyDraft] = useState("");
  const [model, setModel] = useState("deepseek-v4-flash");
  const [thinking, setThinking] = useState(false);
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [image, setImage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const scrollRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const activeModel = MODELS.find((m) => m.id === model)!;

  useEffect(() => {
    const k = localStorage.getItem(KEY_STORE) || "";
    setApiKey(k);
    setKeyDraft(k);
  }, []);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, busy]);

  function saveKey() {
    const k = keyDraft.trim();
    setApiKey(k);
    localStorage.setItem(KEY_STORE, k);
  }

  function onImage(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => setImage(reader.result as string);
    reader.readAsDataURL(file);
    e.target.value = "";
  }

  function toApi(list: Msg[]): Record<string, unknown>[] {
    return list.map((m) => {
      if (m.role === "user" && m.image) {
        return {
          role: "user",
          content: [
            { type: "text", text: m.content },
            { type: "image_url", image_url: { url: m.image } },
          ],
        };
      }
      return { role: m.role, content: m.content || m.reasoning || "" };
    });
  }

  async function send() {
    const text = input.trim();
    if ((!text && !image) || busy || !apiKey) return;

    const userMsg: Msg = { role: "user", content: text || "(image)", image: image || undefined };
    const history = [...messages, userMsg];
    setMessages([...history, { role: "assistant", content: "", reasoning: "" }]);
    setInput("");
    setImage(null);
    setError(null);
    setBusy(true);

    const ctrl = new AbortController();
    abortRef.current = ctrl;
    let content = "";
    let reasoning = "";

    try {
      const res = await fetch("/v1/chat/completions", {
        method: "POST",
        signal: ctrl.signal,
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
        body: JSON.stringify({ model, stream: true, thinking, messages: toApi(history) }),
      });
      if (!res.ok || !res.body) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j?.error?.message || `Request failed (${res.status})`);
      }
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
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
            setMessages((prev) => {
              const next = [...prev];
              next[next.length - 1] = { role: "assistant", content, reasoning };
              return next;
            });
          } catch {
            /* partial frame */
          }
        }
      }
    } catch (e: any) {
      if (e.name !== "AbortError") {
        setError(e.message);
        setMessages((prev) => {
          const next = [...prev];
          if (next[next.length - 1]?.role === "assistant" && !next[next.length - 1].content && !next[next.length - 1].reasoning) next.pop();
          return next;
        });
      }
    } finally {
      setBusy(false);
      abortRef.current = null;
    }
  }

  return (
    <div className="ds-app">
      <style>{css}</style>

      <header className="ds-top">
        <div className="ds-brand">
          <img className="ds-logo" src="/deepseek.svg" alt="" width={20} height={20} /> DeepSeek
        </div>
        <div className="ds-key">
          <input
            type="password"
            placeholder="qwen_sk_… API key"
            value={keyDraft}
            onChange={(e) => setKeyDraft(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && saveKey()}
          />
          <button onClick={saveKey}>{apiKey ? "Saved" : "Save"}</button>
        </div>
      </header>

      <div className="ds-controls">
        <div className="ds-models">
          {MODELS.map((m) => (
            <button
              key={m.id}
              className={`ds-model ${m.id === model ? "on" : ""}`}
              onClick={() => setModel(m.id)}
              title={m.desc}
            >
              <span className="ds-model-name">{m.name}</span>
              <span className="ds-model-desc">{m.desc}</span>
            </button>
          ))}
        </div>
        <button className={`ds-toggle ${thinking ? "on" : ""}`} onClick={() => setThinking((t) => !t)}>
          🧠 DeepThink {thinking ? "ON" : "OFF"}
        </button>
        <button className="ds-new" onClick={() => { setMessages([]); setError(null); }}>New chat</button>
      </div>

      <div className="ds-scroll" ref={scrollRef}>
        <div className="ds-thread">
        {messages.length === 0 && (
          <div className="ds-empty">
            <p>Testing <b>{activeModel.name}</b> — {activeModel.desc}.</p>
            <p className="ds-hint">
              {apiKey ? "Send a message below." : "Add your API key (top right) first."}{" "}
              Toggle DeepThink to see <code>reasoning_content</code> stream.
            </p>
          </div>
        )}
        {messages.map((m, i) => (
          <div key={i} className={`ds-msg ${m.role}`}>
            {m.image && <img className="ds-img" src={m.image} alt="attached" />}
            {m.reasoning ? (
              <details className="ds-think" open={busy && i === messages.length - 1 && !m.content}>
                <summary>💭 Thinking</summary>
                <div className="ds-think-body">{m.reasoning}</div>
              </details>
            ) : null}
            {m.role === "assistant" && !m.content && !m.reasoning && busy && i === messages.length - 1 ? (
              <div className="ds-dots">…</div>
            ) : (
              <div className="ds-text">{m.content}</div>
            )}
          </div>
        ))}
        {error && <div className="ds-error">{error}</div>}
        </div>
      </div>

      <div className="ds-composer">
        {image && (
          <div className="ds-attach">
            <img src={image} alt="to send" />
            <button onClick={() => setImage(null)}>✕</button>
          </div>
        )}
        <textarea
          placeholder={apiKey ? `Message ${activeModel.name}…` : "Add your API key first"}
          value={input}
          disabled={!apiKey}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              send();
            }
          }}
        />
        <div className="ds-composer-row">
          <label className="ds-attach-btn" title="Attach image (uses Vision)">
            📎
            <input type="file" accept="image/*" hidden onChange={onImage} disabled={!apiKey} />
          </label>
          <div className="ds-spacer" />
          {busy ? (
            <button className="ds-send stop" onClick={() => abortRef.current?.abort()}>■</button>
          ) : (
            <button className="ds-send" onClick={send} disabled={!apiKey || (!input.trim() && !image)}>↑</button>
          )}
        </div>
      </div>
    </div>
  );
}

const css = `
.ds-app{width:100%;height:100dvh;display:flex;flex-direction:column;background:#fbfbfd;color:#14161b;font-family:ui-sans-serif,system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;-webkit-font-smoothing:antialiased}
.ds-top{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:12px 24px;border-bottom:1px solid #ececf1;background:#fff}
.ds-brand{display:flex;align-items:center;gap:7px;font-weight:600;font-size:15px;color:#14161b}
.ds-logo{display:block}
.ds-key{display:flex;gap:6px}
.ds-key input{width:230px;max-width:40vw;padding:8px 11px;border:1px solid #d9dbe2;border-radius:8px;background:#fff;color:#14161b;font-size:13px;outline:none}
.ds-key input:focus{border-color:#4d6bfe;box-shadow:0 0 0 3px rgba(77,107,254,.12)}
.ds-key button{padding:8px 14px;border:none;border-radius:8px;background:#4d6bfe;color:#fff;font-size:13px;font-weight:600;cursor:pointer}
.ds-controls{display:flex;align-items:center;gap:10px;flex-wrap:wrap;padding:11px 24px;border-bottom:1px solid #ececf1;background:#fff}
.ds-models{display:flex;gap:6px}
.ds-model{display:flex;flex-direction:column;align-items:flex-start;padding:6px 13px;border:1px solid #dcdee4;border-radius:10px;background:#fff;color:#14161b;cursor:pointer;line-height:1.25;font-family:inherit}
.ds-model:hover{background:#f7f8fa}
.ds-model.on{border-color:#4d6bfe;background:rgba(77,107,254,.08)}
.ds-model-name{font-size:13px;font-weight:600}
.ds-model-desc{font-size:10.5px;color:#818792}
.ds-toggle,.ds-new{padding:8px 13px;border:1px solid #dcdee4;border-radius:10px;background:#fff;color:#14161b;font-size:13px;cursor:pointer;font-family:inherit}
.ds-toggle:hover,.ds-new:hover{background:#f7f8fa}
.ds-toggle.on{border-color:#4d6bfe;background:rgba(77,107,254,.08);color:#4d6bfe;font-weight:600}
.ds-new{margin-left:auto}
.ds-scroll{flex:1;overflow-y:auto}
.ds-thread{max-width:768px;margin:0 auto;padding:26px 20px;display:flex;flex-direction:column;gap:20px}
.ds-empty{margin:auto;text-align:center;color:#818792;font-size:14px;max-width:440px;padding-top:8vh}
.ds-empty b{color:#14161b}
.ds-hint{font-size:13px;color:#9a9fa8;margin-top:8px}
.ds-hint code{background:#f1f2f5;border-radius:5px;padding:1px 5px;font-size:.9em}
.ds-msg{display:flex;flex-direction:column;gap:8px;max-width:100%}
.ds-msg.user{align-items:flex-end}
.ds-msg.user .ds-text{background:#4d6bfe;color:#fff;padding:10px 15px;border-radius:16px;max-width:80%;white-space:pre-wrap;line-height:1.5}
.ds-msg.assistant .ds-text{white-space:pre-wrap;line-height:1.65;color:#1f2229}
.ds-img{max-width:240px;border-radius:12px}
.ds-think{background:#f5f6f8;border:1px solid #ececf1;border-radius:10px;padding:8px 13px;font-size:13px}
.ds-think summary{cursor:pointer;color:#565c69;user-select:none;font-weight:500}
.ds-think-body{margin-top:8px;white-space:pre-wrap;color:#6b7280;font-size:13px;line-height:1.6;border-left:2px solid #dcdee4;padding-left:11px}
.ds-dots{color:#b0b4bd;font-size:22px}
.ds-error{color:#b42318;background:#fef3f2;border:1px solid #fdccc7;padding:10px 14px;border-radius:10px;font-size:13px}
.ds-composer{max-width:768px;width:calc(100% - 40px);margin:0 auto 22px;border:1px solid #d9dbe2;border-radius:16px;padding:11px 13px;background:#fff;box-shadow:0 1px 2px rgba(16,24,40,.04),0 4px 14px rgba(16,24,40,.05)}
.ds-composer textarea{width:100%;border:none;background:transparent;color:#14161b;resize:none;font-size:15px;font-family:inherit;outline:none;min-height:24px;max-height:200px;line-height:1.5}
.ds-composer textarea::placeholder{color:#a0a4ae}
.ds-composer-row{display:flex;align-items:center;margin-top:6px}
.ds-attach-btn{cursor:pointer;font-size:18px;opacity:.65}
.ds-spacer{flex:1}
.ds-send{width:34px;height:34px;border:none;border-radius:50%;background:#4d6bfe;color:#fff;font-size:16px;cursor:pointer;display:flex;align-items:center;justify-content:center}
.ds-send:disabled{opacity:.4;cursor:default}
.ds-send.stop{background:#888}
.ds-attach{display:inline-flex;position:relative;margin-bottom:8px}
.ds-attach img{max-height:64px;border-radius:8px}
.ds-attach button{position:absolute;top:-6px;right:-6px;width:18px;height:18px;border:none;border-radius:50%;background:#000;color:#fff;font-size:10px;cursor:pointer}
`;

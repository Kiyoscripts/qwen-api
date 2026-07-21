"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  ArrowUp,
  CaretDown,
  CaretRight,
  ChatCircle,
  Check,
  Copy,
  Gear,
  ImageSquare,
  Key,
  NotePencil,
  Paperclip,
  Sidebar as SidebarIcon,
  Stop,
  Trash,
  X,
} from "@phosphor-icons/react";
import { Markdown } from "./Markdown";

interface Msg {
  role: "user" | "assistant";
  content: string;
  reasoning?: string;
  image?: string;
}
interface Conversation {
  id: string;
  title: string;
  messages: Msg[];
  model: string;
}
interface ModelOpt {
  id: string;
  name: string;
  vision: boolean;
  thinking: boolean;
  chatTypes: string[];
}

// Short capability line under each model name, ChatGPT-style.
function describeModel(m: ModelOpt): string {
  const bits: string[] = [];
  if (m.thinking) bits.push("reasoning");
  if (m.vision) bits.push("vision");
  if (m.chatTypes.includes("t2i")) bits.push("image");
  if (m.chatTypes.includes("t2v")) bits.push("video");
  if (bits.length === 0) return "Text generation";
  return "Text, " + bits.join(", ");
}

const STORE = "qwen_chat_conversations";
const KEY_STORE = "qwen_api_key";
const DEFAULT_MODEL = "qwen3.8-max-preview";

// Shown at the top level of the picker, in this order. Everything else is
// tucked behind "Other models".
const PRIMARY_IDS = ["qwen3.8-max-preview", "qwen3.7-plus", "qwen3.7-max"];

const EXAMPLES = [
  "Explain closures in JavaScript with a short example",
  "Write a SQL query to find duplicate rows",
  "Summarise the tradeoffs of REST vs GraphQL",
  "Refactor this into async/await",
];

// crypto.randomUUID() only exists in a secure context (https / localhost), so it
// is missing when the app is served over plain http (LAN previews). Fall back.
function uid(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") return crypto.randomUUID();
  return `id-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function newConversation(model: string): Conversation {
  return { id: uid(), title: "New chat", messages: [], model };
}

export default function Chat() {
  const [apiKey, setApiKey] = useState("");
  const [keyDraft, setKeyDraft] = useState("");
  const [models, setModels] = useState<ModelOpt[]>([]);
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [activeId, setActiveId] = useState<string>("");
  const [input, setInput] = useState("");
  const [image, setImage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copiedIdx, setCopiedIdx] = useState<number | null>(null);
  const [modelMenu, setModelMenu] = useState(false);
  const [showOthers, setShowOthers] = useState(false);

  const scrollRef = useRef<HTMLDivElement>(null);
  const taRef = useRef<HTMLTextAreaElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const modelRef = useRef<HTMLDivElement>(null);

  const active = conversations.find((c) => c.id === activeId);
  const messages = active?.messages ?? [];

  // --- boot: restore key + conversations ---
  useEffect(() => {
    const k = localStorage.getItem(KEY_STORE) || "";
    setApiKey(k);
    setKeyDraft(k);
    try {
      const saved: Conversation[] = JSON.parse(localStorage.getItem(STORE) || "[]");
      if (saved.length) {
        setConversations(saved);
        setActiveId(saved[0].id);
        return;
      }
    } catch {
      /* corrupt store -> start fresh */
    }
    const c = newConversation(DEFAULT_MODEL);
    setConversations([c]);
    setActiveId(c.id);
  }, []);

  // persist
  useEffect(() => {
    if (conversations.length) localStorage.setItem(STORE, JSON.stringify(conversations));
  }, [conversations]);

  const loadModels = useCallback(async (key: string) => {
    if (!key) return;
    try {
      const r = await fetch("/v1/models", { headers: { Authorization: `Bearer ${key}` } });
      if (!r.ok) return;
      const j = await r.json();
      setModels(
        (j.data || []).map((m: any) => ({
          id: m.id,
          name: m.display_name || m.id,
          vision: Boolean(m.capabilities?.vision),
          thinking: Boolean(m.capabilities?.thinking),
          chatTypes: m.capabilities?.chat_types || [],
        }))
      );
    } catch {
      /* offline */
    }
  }, []);
  useEffect(() => {
    if (apiKey) loadModels(apiKey);
  }, [apiKey, loadModels]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages.length, busy]);

  // If the active model lives under "Other models", open that section so the
  // current selection is visible when the menu opens.
  useEffect(() => {
    if (modelMenu) setShowOthers(!PRIMARY_IDS.includes(active?.model || ""));
  }, [modelMenu, active?.model]);

  // Close the model menu on outside click or Escape.
  useEffect(() => {
    if (!modelMenu) return;
    function onDown(e: MouseEvent) {
      if (modelRef.current && !modelRef.current.contains(e.target as Node)) setModelMenu(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setModelMenu(false);
    }
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [modelMenu]);

  function patchActive(fn: (c: Conversation) => Conversation) {
    setConversations((prev) => prev.map((c) => (c.id === activeId ? fn(c) : c)));
  }

  function startNewChat() {
    const c = newConversation(active?.model || DEFAULT_MODEL);
    setConversations((prev) => [c, ...prev]);
    setActiveId(c.id);
    setSidebarOpen(false);
    setError(null);
  }

  function deleteConversation(id: string) {
    setConversations((prev) => {
      const next = prev.filter((c) => c.id !== id);
      if (next.length === 0) {
        const c = newConversation(DEFAULT_MODEL);
        setActiveId(c.id);
        return [c];
      }
      if (id === activeId) setActiveId(next[0].id);
      return next;
    });
  }

  function onImage(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => setImage(reader.result as string);
    reader.readAsDataURL(file);
    e.target.value = "";
  }

  function autoGrow() {
    const el = taRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = Math.min(el.scrollHeight, 200) + "px";
  }

  function toApi(list: Msg[]) {
    return list.map((m) =>
      m.role === "user" && m.image
        ? { role: "user", content: [{ type: "text", text: m.content }, { type: "image_url", image_url: { url: m.image } }] }
        : { role: m.role, content: m.content }
    );
  }

  async function send(text?: string) {
    const body = (text ?? input).trim();
    if ((!body && !image) || busy || !apiKey || !active) return;

    const userMsg: Msg = { role: "user", content: body || "(image)", image: image || undefined };
    const history = [...messages, userMsg];
    const isFirst = messages.length === 0;

    patchActive((c) => ({
      ...c,
      title: isFirst ? body.slice(0, 40) || "Image" : c.title,
      messages: [...history, { role: "assistant", content: "" }],
    }));
    setInput("");
    setImage(null);
    setError(null);
    setBusy(true);
    requestAnimationFrame(autoGrow);

    const ctrl = new AbortController();
    abortRef.current = ctrl;

    try {
      const res = await fetch("/v1/chat/completions", {
        method: "POST",
        signal: ctrl.signal,
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
        body: JSON.stringify({ model: active.model, stream: true, messages: toApi(history) }),
      });
      if (!res.ok || !res.body) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j?.error?.message || `Request failed (${res.status})`);
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
            const d = JSON.parse(data)?.choices?.[0]?.delta;
            if (d?.reasoning_content) reasoning += d.reasoning_content;
            if (d?.content) content += d.content;
            patchActive((c) => {
              const msgs = [...c.messages];
              msgs[msgs.length - 1] = { role: "assistant", content, reasoning };
              return { ...c, messages: msgs };
            });
          } catch {
            /* partial frame */
          }
        }
      }
    } catch (e: any) {
      if (e.name === "AbortError") {
        setError(null);
      } else {
        setError(e.message);
        patchActive((c) => {
          const msgs = [...c.messages];
          if (msgs[msgs.length - 1]?.role === "assistant" && !msgs[msgs.length - 1].content) msgs.pop();
          return { ...c, messages: msgs };
        });
      }
    } finally {
      setBusy(false);
      abortRef.current = null;
    }
  }

  function stop() {
    abortRef.current?.abort();
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  }

  async function copyMessage(text: string, idx: number) {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedIdx(idx);
      setTimeout(() => setCopiedIdx(null), 1600);
    } catch {
      /* clipboard may be blocked */
    }
  }

  function saveKey() {
    const k = keyDraft.trim();
    setApiKey(k);
    localStorage.setItem(KEY_STORE, k);
    setSettingsOpen(false);
  }

  const canSend = Boolean(apiKey) && (input.trim() || image) && !busy;
  const isEmpty = messages.length === 0;

  // Featured models first (in PRIMARY_IDS order), the rest behind "Other models".
  const primaryModels = PRIMARY_IDS.map((id) => models.find((m) => m.id === id)).filter(Boolean) as ModelOpt[];
  const otherModels = models.filter((m) => !PRIMARY_IDS.includes(m.id));

  const renderModelItem = (m: ModelOpt) => {
    const selected = m.id === active?.model;
    return (
      <button
        key={m.id}
        role="option"
        aria-selected={selected}
        className="c-model-item"
        onClick={() => {
          patchActive((c) => ({ ...c, model: m.id }));
          setModelMenu(false);
        }}
      >
        <img className="c-model-icon" src="/qwen.svg" alt="" width={20} height={20} />
        <span className="c-model-text">
          <span className="c-model-name">{m.name}</span>
          <span className="c-model-desc">{describeModel(m)}</span>
        </span>
        {selected && <Check size={16} weight="bold" className="c-model-check" />}
      </button>
    );
  };

  // One composer, placed either centred (empty chat) or pinned at the bottom.
  const composer = (
    <div className="c-composer-wrap">
      <div className="c-composer">
        {image && (
          <div className="c-attach">
            <img src={image} alt="to send" />
            <button onClick={() => setImage(null)} aria-label="Remove image"><X size={12} weight="bold" /></button>
          </div>
        )}
        <textarea
          ref={taRef}
          className="c-input"
          rows={1}
          placeholder={apiKey ? "Ask anything" : "Add your API key in Settings first"}
          value={input}
          disabled={!apiKey}
          onChange={(e) => {
            setInput(e.target.value);
            autoGrow();
          }}
          onKeyDown={onKeyDown}
        />
        <div className="c-composer-row">
          <label className="c-icon-btn" aria-label="Attach image">
            <Paperclip size={19} />
            <input type="file" accept="image/*" hidden onChange={onImage} disabled={!apiKey} />
          </label>
          <div className="c-spacer" />
          {busy ? (
            <button className="c-send stop" onClick={stop} aria-label="Stop generating">
              <Stop size={15} weight="fill" />
            </button>
          ) : (
            <button className="c-send" onClick={() => send()} disabled={!canSend} aria-label="Send message">
              <ArrowUp size={18} weight="bold" />
            </button>
          )}
        </div>
      </div>
      {!isEmpty && <p className="c-disclaimer">Qwen can make mistakes. Check important info.</p>}
    </div>
  );

  return (
    <div className="c-app">
      {/* ---------- sidebar ---------- */}
      <aside className={`c-side ${sidebarOpen ? "open" : ""}`}>
        <div className="c-side-top">
          <a href="/" className="c-brand">
            <img src="/qwen.svg" alt="" width={22} height={22} />
            Qwen3.8
          </a>
          <button className="c-icon-btn c-side-close" onClick={() => setSidebarOpen(false)} aria-label="Close menu">
            <X size={18} />
          </button>
        </div>

        <button className="c-newchat" onClick={startNewChat}>
          <NotePencil size={17} /> New chat
        </button>

        <nav className="c-convos">
          {conversations.map((c) => (
            <div key={c.id} className={`c-convo ${c.id === activeId ? "active" : ""}`}>
              <button
                className="c-convo-btn"
                onClick={() => {
                  setActiveId(c.id);
                  setSidebarOpen(false);
                }}
              >
                <ChatCircle size={15} />
                <span>{c.title}</span>
              </button>
              <button className="c-icon-btn c-convo-del" onClick={() => deleteConversation(c.id)} aria-label="Delete chat">
                <Trash size={14} />
              </button>
            </div>
          ))}
        </nav>

        <div className="c-side-foot">
          <button className="c-foot-link" onClick={() => setSettingsOpen(true)}>
            <Gear size={16} /> Settings
          </button>
          <a className="c-foot-link" href="/playground">
            <SidebarIcon size={16} /> Playground
          </a>
        </div>
      </aside>

      {sidebarOpen && <div className="c-scrim" onClick={() => setSidebarOpen(false)} />}

      {/* ---------- main ---------- */}
      <main className="c-main">
        <header className="c-top">
          <button className="c-icon-btn c-menu" onClick={() => setSidebarOpen(true)} aria-label="Open menu">
            <SidebarIcon size={18} />
          </button>
          <div className="c-model-wrap" ref={modelRef}>
            <button
              className="c-model-btn"
              onClick={() => setModelMenu((o) => !o)}
              aria-haspopup="listbox"
              aria-expanded={modelMenu}
            >
              {models.find((m) => m.id === active?.model)?.name || active?.model || DEFAULT_MODEL}
              <CaretDown size={14} weight="bold" />
            </button>

            {modelMenu && (
              <div className="c-model-menu" role="listbox">
                {models.length === 0 && <div className="c-model-empty">Add an API key to load models</div>}

                {primaryModels.map(renderModelItem)}

                {otherModels.length > 0 && (
                  <>
                    <div className="c-model-sep" />
                    <button
                      className="c-model-item c-model-more"
                      onClick={() => setShowOthers((o) => !o)}
                      aria-expanded={showOthers}
                    >
                      <span className="c-model-text">
                        <span className="c-model-name">Other models</span>
                        <span className="c-model-desc">{otherModels.length} more</span>
                      </span>
                      {showOthers ? <CaretDown size={15} /> : <CaretRight size={15} />}
                    </button>
                    {showOthers && otherModels.map(renderModelItem)}
                  </>
                )}
              </div>
            )}
          </div>
        </header>

        {isEmpty ? (
          /* Empty chat: greeting with the composer centred, ChatGPT-style. */
          <div className="c-center">
            <h1>{apiKey ? "What can I help with?" : "Add your API key to start"}</h1>
            {composer}
            {apiKey ? (
              <div className="c-examples">
                {EXAMPLES.map((ex) => (
                  <button key={ex} className="c-example" onClick={() => send(ex)}>
                    {ex}
                  </button>
                ))}
              </div>
            ) : (
              <button className="c-primary" onClick={() => setSettingsOpen(true)}>
                <Key size={16} /> Add API key
              </button>
            )}
          </div>
        ) : (
          <>
            <div className="c-scroll" ref={scrollRef}>
              <div className="c-thread">
                {messages.map((m, i) => (
                  <div key={i} className={`c-msg ${m.role}`}>
                    <div className="c-msg-body">
                      {m.image && <img className="c-msg-img" src={m.image} alt="attached" />}
                      {m.reasoning && (
                        <details className="c-think">
                          <summary>Thinking</summary>
                          <div>{m.reasoning}</div>
                        </details>
                      )}
                      {m.role === "assistant" ? (
                        m.content ? (
                          <>
                            <Markdown>{m.content}</Markdown>
                            {!(busy && i === messages.length - 1) && (
                              <div className="c-actions">
                                <button
                                  className="c-action"
                                  onClick={() => copyMessage(m.content, i)}
                                  aria-label="Copy response"
                                >
                                  {copiedIdx === i ? <Check size={15} /> : <Copy size={15} />}
                                </button>
                              </div>
                            )}
                          </>
                        ) : (
                          busy &&
                          i === messages.length - 1 && (
                            <img
                              className="c-gen-logo"
                              src="/qwen.svg"
                              alt="Generating response"
                              width={26}
                              height={26}
                            />
                          )
                        )
                      ) : (
                        <div className="c-user-text">{m.content}</div>
                      )}
                    </div>
                  </div>
                ))}

                {error && <div className="c-error">{error}</div>}
              </div>
            </div>
            {composer}
          </>
        )}
      </main>

      {/* ---------- settings ---------- */}
      {settingsOpen && (
        <div className="c-modal-scrim" onClick={() => setSettingsOpen(false)}>
          <div className="c-modal" onClick={(e) => e.stopPropagation()}>
            <div className="c-modal-head">
              <h2>Settings</h2>
              <button className="c-icon-btn" onClick={() => setSettingsOpen(false)} aria-label="Close settings">
                <X size={18} />
              </button>
            </div>
            <label className="c-label" htmlFor="apikey">API key</label>
            <input
              id="apikey"
              className="c-field"
              type="password"
              placeholder="qwen_sk_…"
              value={keyDraft}
              onChange={(e) => setKeyDraft(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && saveKey()}
            />
            <p className="c-help">
              Stored only in this browser&apos;s local storage. It is never sent anywhere except this API.
              Need one? <a href="/#get-a-key">Generate a key</a>.
            </p>
            <div className="c-modal-foot">
              <button className="c-primary" onClick={saveKey}>Save</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

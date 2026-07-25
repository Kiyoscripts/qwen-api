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
  Key,
  NotePencil,
  Paperclip,
  Sidebar as SidebarIcon,
  Stop,
  Trash,
  Wrench,
  X,
} from "@phosphor-icons/react";
import { Markdown } from "./Markdown";
import Aurora, { type AuroraState } from "../Aurora";
import Select from "../Select";
import { useMe, AccountChip } from "../Account";
import { PhaseTimer } from "../PhaseTimer";
import { useReadAloud, ReadAloudButton } from "./ReadAloud";
import { DEMO_TOOLS, DEMO_TOOL_NAMES, runDemoTool } from "@/lib/demoTools";

interface ToolCallView {
  id: string;
  name: string;
  arguments: string;
}

interface Msg {
  role: "user" | "assistant" | "tool";
  content: string;
  reasoning?: string;
  image?: string;
  toolCalls?: ToolCallView[]; // assistant requested these
  toolName?: string; // tool-result message
  toolCallId?: string; // tool-result message
  truncated?: boolean; // stream was severed before the model finished
  thinkMs?: number; // request start -> first visible token
  answerMs?: number; // first visible token -> end of stream
  startedAt?: number; // epoch ms, so a live turn can tick without re-rendering
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
  // Upstream lists every chat_type a model could route to, so nearly every chat
  // model advertises "t2v" and "t2i" — reading those directly labelled
  // Qwen3.7-Plus as "Video generation". Media generation is only reachable here
  // through the dedicated qwen-image-* / qwen-wan ids, and those are the only
  // models that cannot also do plain text.
  if (!m.chatTypes.includes("t2t")) {
    if (m.chatTypes.includes("t2v")) return "Video generation";
    if (m.chatTypes.includes("t2i")) return m.chatTypes.includes("image_edit") ? "Image · Editing" : "Image generation";
  }
  const bits = ["Text"];
  if (m.thinking) bits.push("Reasoning");
  if (m.vision) bits.push("Vision");
  return bits.join(" · ");
}

const STORE = "qwen_chat_conversations";
const KEY_STORE = "qwen_api_key";
const DEFAULT_MODEL = "qwen3.8-max-preview";

// Shown at the top level of the picker, in this order. Everything else is
// tucked behind "Other models".
const PRIMARY_IDS = [
  "qwen3.8-max-preview",
  "qwen-image-3.0",
  "qwen-image-2.0",
  "qwen-wan",
];

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
  const me = useMe();
  const [apiKey, setApiKey] = useState("");
  const [keyDraft, setKeyDraft] = useState("");
  const [models, setModels] = useState<ModelOpt[]>([]);
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [activeId, setActiveId] = useState<string>("");
  const [input, setInput] = useState("");
  const [image, setImage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [auroraState, setAuroraState] = useState<AuroraState>("idle");
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copiedIdx, setCopiedIdx] = useState<number | null>(null);
  const [modelMenu, setModelMenu] = useState(false);
  const [showOthers, setShowOthers] = useState(false);
  const [fast, setFast] = useState(false); // Think (default) vs Fast
  const [aspect, setAspect] = useState("1:1"); // image aspect ratio
  const [toolsOn, setToolsOn] = useState(false); // enable demo tool calling
  const [atBottom, setAtBottom] = useState(true);

  const scrollRef = useRef<HTMLDivElement>(null);
  const taRef = useRef<HTMLTextAreaElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const modelRef = useRef<HTMLDivElement>(null);
  // Bumped once per streamed token; the backdrop reads it every frame so the
  // scene reacts to output without re-rendering anything.
  const pulseRef = useRef(0);
  // Follow the tail of the reply unless the reader has scrolled away from it.
  const stickRef = useRef(true);

  // A pasted key wins; otherwise the session cookie authenticates us, so being
  // signed in is enough to use the chat.
  const authed = Boolean(apiKey) || Boolean(me);
  const authHeaders = (): Record<string, string> => (apiKey ? { Authorization: `Bearer ${apiKey}` } : {});

  // One player for the thread: starting a second message stops the first.
  const readAloud = useReadAloud(authHeaders);

  const active = conversations.find((c) => c.id === activeId);
  const messages = active?.messages ?? [];
  const activeModel = models.find((m) => m.id === active?.model);
  const isImageModel = (active?.model || "").startsWith("qwen-image");
  const isVideoModel = active?.model === "qwen-wan";
  const isMediaModel = isImageModel || isVideoModel;
  // Think/Fast: thinking-capable chat models, except 3.8 Max Preview (always reasons).
  const canPickThink = (activeModel?.thinking ?? false) && active?.model !== "qwen3.8-max-preview" && !isMediaModel;

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
    try {
      const r = await fetch("/v1/models", { headers: key ? { Authorization: `Bearer ${key}` } : {} });
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
    if (authed) loadModels(apiKey);
  }, [authed, apiKey, loadModels]);

  // `messages` gets a new identity on every streamed token, so this keeps the
  // view pinned to the tail of a reply as it is written — but only while the
  // reader is already at the bottom.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el || !stickRef.current) return;
    el.scrollTop = el.scrollHeight;
  }, [messages, busy]);

  function onThreadScroll() {
    const el = scrollRef.current;
    if (!el) return;
    const near = el.scrollHeight - el.scrollTop - el.clientHeight < 120;
    stickRef.current = near;
    setAtBottom(near);
  }

  function jumpToBottom() {
    const el = scrollRef.current;
    if (!el) return;
    stickRef.current = true;
    setAtBottom(true);
    el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
  }

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

  // Switching threads mid-flight would stream the rest of a reply into a
  // conversation you are no longer looking at, so cancel first. The per-message
  // copy flag and the error banner belong to the thread you left, too.
  function openConversation(id: string) {
    if (id === activeId) { setSidebarOpen(false); return; }
    abortRef.current?.abort();
    readAloud.stop();
    setActiveId(id);
    setSidebarOpen(false);
    setError(null);
    setCopiedIdx(null);
    stickRef.current = true;
    setAtBottom(true);
  }

  function startNewChat() {
    abortRef.current?.abort();
    const c = newConversation(active?.model || DEFAULT_MODEL);
    setConversations((prev) => [c, ...prev]);
    setActiveId(c.id);
    setSidebarOpen(false);
    setError(null);
    setCopiedIdx(null);
  }

  function deleteConversation(id: string) {
    if (id === activeId) abortRef.current?.abort();
    // Done outside the state updater on purpose: the updater must stay pure, or
    // React's double-invoke in dev fires setActiveId twice.
    const next = conversations.filter((c) => c.id !== id);
    if (next.length === 0) {
      const c = newConversation(DEFAULT_MODEL);
      setConversations([c]);
      setActiveId(c.id);
    } else {
      setConversations(next);
      if (id === activeId) setActiveId(next[0].id);
    }
    setError(null);
    setCopiedIdx(null);
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

  function toApi(list: Msg[]): Record<string, unknown>[] {
    const out: Record<string, unknown>[] = [];
    for (const m of list) {
      if (m.role === "user" && m.image) {
        out.push({
          role: "user",
          content: [{ type: "text", text: m.content }, { type: "image_url", image_url: { url: m.image } }],
        });
        continue;
      }
      if (m.role === "assistant" && m.toolCalls?.length) {
        out.push({
          role: "assistant",
          content: m.content || null,
          tool_calls: m.toolCalls.map((tc) => ({ id: tc.id, type: "function", function: { name: tc.name, arguments: tc.arguments } })),
        });
        continue;
      }
      if (m.role === "tool") {
        out.push({ role: "tool", tool_call_id: m.toolCallId || "", name: m.toolName, content: m.content });
        continue;
      }
      // A reply cut off mid-reasoning has no visible content, only reasoning. Send
      // that instead, otherwise the turn is empty and the model loses everything
      // it had already drafted when you ask it to continue.
      const cutOff = m.role === "assistant" && !m.content && Boolean(m.reasoning);
      const text = m.content || m.reasoning || "";
      if (!text) continue;
      out.push({
        role: m.role,
        content: cutOff ? `${text}\n\n[This reply was cut off before it finished.]` : text,
      });
    }
    return out;
  }

  /**
   * Stream one turn, appending onto whatever we already have.
   *
   * `complete` comes from finish_reason. The API reports "length" when the
   * upstream stream was severed mid-reply — the 300s function cap, a dropped
   * connection — and "stop" when the model finished on its own. (Watching for
   * `[DONE]` does not work: we always send that, whether or not the reply
   * survived, so it was true even on a truncated turn.)
   */
  async function streamTurn(
    convo: Record<string, unknown>[],
    base: { content: string; reasoning: string },
    signal: AbortSignal,
    tools?: unknown
  ): Promise<{ content: string; reasoning: string; complete: boolean; toolCalls: ToolCallView[] }> {
    let content = base.content;
    let reasoning = base.reasoning;
    let finish: string | null = null;
    // Split the wait in two: everything before the first visible character is
    // the model deciding what to say, everything after is it saying it. On a
    // reasoning model those are very different numbers and only the second one
    // looks like progress.
    const startedAt = Date.now();
    let firstContentAt: number | null = null;
    const toolCalls: ToolCallView[] = [];

    const res = await fetch("/v1/chat/completions", {
      method: "POST",
      signal,
      headers: { "Content-Type": "application/json", ...authHeaders() },
      body: JSON.stringify({
        model: active!.model,
        stream: true,
        messages: convo,
        ...(canPickThink ? { enable_thinking: !fast } : {}),
        ...(isMediaModel ? { size: aspect } : {}),
        ...(tools ? { tools, tool_choice: "auto" } : {}),
      }),
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
          const choice = JSON.parse(data)?.choices?.[0];
          if (choice?.finish_reason) finish = choice.finish_reason;
          const d = choice?.delta;
          if (d?.reasoning_content) { reasoning += d.reasoning_content; pulseRef.current++; }
          if (d?.content) {
            if (firstContentAt === null) firstContentAt = Date.now();
            content += d.content;
            pulseRef.current++;
            setAuroraState("responding");
          }
          if (Array.isArray(d?.tool_calls)) {
            for (const tc of d.tool_calls) toolCalls.push({ id: tc.id, name: tc.function?.name, arguments: tc.function?.arguments || "{}" });
          }
          patchActive((c) => {
            const msgs = [...c.messages];
            msgs[msgs.length - 1] = {
              role: "assistant",
              content,
              reasoning,
              startedAt,
              thinkMs: firstContentAt === null ? undefined : firstContentAt - startedAt,
              toolCalls: toolCalls.length ? [...toolCalls] : undefined,
            };
            return { ...c, messages: msgs };
          });
        } catch {
          /* partial frame */
        }
      }
    }
    // Freeze the final split onto the message so it survives a reload.
    const endedAt = Date.now();
    patchActive((c) => {
      const msgs = [...c.messages];
      const i = msgs.length - 1;
      if (msgs[i]?.role === "assistant") {
        msgs[i] = {
          ...msgs[i],
          startedAt: undefined,
          thinkMs: (firstContentAt ?? endedAt) - startedAt,
          answerMs: firstContentAt === null ? 0 : endedAt - firstContentAt,
        };
      }
      return { ...c, messages: msgs };
    });

    // No finish_reason at all means the connection dropped before the final
    // chunk, which is a truncation too.
    return { content, reasoning, complete: finish !== null && finish !== "length", toolCalls };
  }

  function markTruncated() {
    patchActive((c) => {
      const msgs = [...c.messages];
      const i = msgs.length - 1;
      if (msgs[i]?.role === "assistant") msgs[i] = { ...msgs[i], truncated: true };
      return { ...c, messages: msgs };
    });
  }

  /**
   * Resume a severed reply.
   *
   * The partial text is sent back as the assistant's own turn, so the model
   * continues from it instead of restarting — the cost is the remainder, not a
   * second full generation. The continuation is appended to the same message so
   * the thread still reads as one answer.
   */
  async function continueReply() {
    if (busy || !authed || !active) return;
    const idx = messages.length - 1;
    const last = messages[idx];
    if (last?.role !== "assistant" || !last.truncated) return;

    setError(null);
    setBusy(true);
    setAuroraState("thinking");
    stickRef.current = true;
    setAtBottom(true);

    const ctrl = new AbortController();
    abortRef.current = ctrl;

    // Drop the flag while it runs so the button can't be pressed twice.
    patchActive((c) => {
      const msgs = [...c.messages];
      msgs[idx] = { ...msgs[idx], truncated: false };
      return { ...c, messages: msgs };
    });

    try {
      const convo = toApi(messages);
      // Two different failures need two different instructions. Cut off with text
      // written: carry on from the last character. Cut off while still reasoning:
      // more deliberation is precisely what exhausted the budget, so tell it to
      // stop thinking and answer — which is also the cheaper continuation.
      convo.push({
        role: "user",
        content: last.content
          ? "Continue your previous message from exactly where it stopped. Do not repeat any of it, do not restate the question, and do not add a preamble — carry straight on from the final character."
          : "You ran out of room while still planning, and never began the answer. Stop deliberating now and write the final answer directly, using the thinking you already did.",
      });
      const { complete } = await streamTurn(
        convo,
        { content: last.content, reasoning: last.reasoning || "" },
        ctrl.signal,
        toolsOn ? DEMO_TOOLS : undefined
      );
      if (!complete) markTruncated();
    } catch (e: any) {
      if (e.name !== "AbortError") setError(e.message);
      markTruncated(); // still resumable
    } finally {
      setBusy(false);
      abortRef.current = null;
      setAuroraState("done");
      setTimeout(() => setAuroraState((s) => (s === "done" ? "idle" : s)), 2600);
    }
  }

  async function send(text?: string) {
    const body = (text ?? input).trim();
    if ((!body && !image) || busy || !authed || !active) return;

    const userMsg: Msg = { role: "user", content: body || "(image)", image: image || undefined };
    const history = [...messages, userMsg];
    const isFirst = messages.length === 0;

    patchActive((c) => ({
      ...c,
      title: isFirst ? body.slice(0, 40) || "Image" : c.title,
      messages: [...history, { role: "assistant", content: "", startedAt: Date.now() }],
    }));
    setInput("");
    setImage(null);
    setError(null);
    setBusy(true);
    setAuroraState("thinking");
    stickRef.current = true;
    setAtBottom(true);
    requestAnimationFrame(autoGrow);

    const ctrl = new AbortController();
    abortRef.current = ctrl;

    try {
      // One request per message. (Auto-continue was removed: each retry is a full
      // generation and burns account usage far too quickly. If a reply is cut off,
      // its partial text is kept and typing "continue" resumes from it.)
      //
      // With tools on, run the call loop: stream a reply, execute any requested demo
      // tools, feed the results back, and repeat until the model answers.
      const tools = toolsOn ? DEMO_TOOLS : undefined;
      const convo = toApi(history);
      for (let hop = 0; hop < 8; hop++) {
        const { content, toolCalls, complete } = await streamTurn(convo, { content: "", reasoning: "" }, ctrl.signal, tools);
        // Nothing auto-retries: a full regeneration would burn a pooled account
        // usage for work we already have. The partial is kept and flagged, and
        // Continue picks up from it — generating only the missing remainder.
        if (!complete) markTruncated();
        convo.push({
          role: "assistant",
          content: content || null,
          ...(toolCalls.length ? { tool_calls: toolCalls.map((tc) => ({ id: tc.id, type: "function", function: { name: tc.name, arguments: tc.arguments } })) } : {}),
        });
        if (!tools || toolCalls.length === 0) break;

        const toolMsgs: Msg[] = [];
        for (const tc of toolCalls) {
          let args: any = {};
          try { args = JSON.parse(tc.arguments || "{}"); } catch {}
          const result = DEMO_TOOL_NAMES.has(tc.name)
            ? runDemoTool(tc.name, args)
            : { error: `No executor for "${tc.name}". Only the demo tools run automatically.` };
          const rc = JSON.stringify(result);
          toolMsgs.push({ role: "tool", content: rc, toolName: tc.name, toolCallId: tc.id });
          convo.push({ role: "tool", tool_call_id: tc.id, name: tc.name, content: rc });
        }
        patchActive((c) => ({ ...c, messages: [...c.messages, ...toolMsgs, { role: "assistant", content: "", startedAt: Date.now() }] }));
      }
    } catch (e: any) {
      if (e.name === "AbortError") {
        setError(null);
        // Stopping before a single token arrived leaves an empty bubble behind.
        // Partial replies are kept — you can type "continue" from them.
        patchActive((c) => {
          const msgs = [...c.messages];
          const last = msgs[msgs.length - 1];
          if (last?.role === "assistant" && !last.content && !last.reasoning && !last.toolCalls?.length) msgs.pop();
          return { ...c, messages: msgs };
        });
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
      // Brief "settle" flash, then back to calm idle.
      setAuroraState("done");
      setTimeout(() => setAuroraState((s) => (s === "done" ? "idle" : s)), 2600);
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

  const canSend = authed && Boolean(input.trim() || image) && !busy;
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
        <img className="c-model-icon" src={m.id.startsWith("deepseek") ? "/deepseek.svg" : "/qwen.svg"} alt="" width={20} height={20} />
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
          placeholder={authed ? "Ask anything" : "Sign in, or add an API key in Settings"}
          value={input}
          disabled={!authed}
          onChange={(e) => {
            setInput(e.target.value);
            autoGrow();
          }}
          onKeyDown={onKeyDown}
        />
        <div className="c-composer-row">
          <label className="c-icon-btn" aria-label="Attach image">
            <Paperclip size={19} />
            <input type="file" accept="image/*" hidden onChange={onImage} disabled={!authed} />
          </label>
          {canPickThink && (
            <div className="c-seg" role="group" aria-label="Reasoning">
              <button type="button" className={!fast ? "on" : ""} onClick={() => setFast(false)} title="Reason step by step (slower, better)">Think</button>
              <button type="button" className={fast ? "on" : ""} onClick={() => setFast(true)} title="Skip reasoning (faster)">Fast</button>
            </div>
          )}
          {isMediaModel && (
            <Select
              compact
              ariaLabel="Aspect ratio"
              value={aspect}
              onChange={setAspect}
              options={[
                { value: "1:1", label: "1:1", hint: "Square" },
                { value: "16:9", label: "16:9", hint: "Landscape" },
                { value: "9:16", label: "9:16", hint: "Portrait" },
                { value: "4:3", label: "4:3" },
                { value: "3:4", label: "3:4" },
              ]}
            />
          )}
          {!isMediaModel && (
            <button
              type="button"
              className={`c-tools-btn ${toolsOn ? "on" : ""}`}
              onClick={() => setToolsOn((v) => !v)}
              title="Enable tool calling — the model can call built-in demo tools (weather, time, calculator)"
              aria-pressed={toolsOn}
            >
              <Wrench size={13} weight="bold" /> Tools
            </button>
          )}
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
      <Aurora state={auroraState} pulseRef={pulseRef} />
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
              <button className="c-convo-btn" onClick={() => openConversation(c.id)}>
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
          {me ? (
            <a className="c-foot-link c-foot-acct" href="/keys" title="Open your dashboard">
              <AccountChip me={me} />
            </a>
          ) : me === null ? (
            <a className="c-foot-link" href="/login">
              <Key size={16} /> Log in
            </a>
          ) : null}
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
              <span className="c-model-name-cur">
                {models.find((m) => m.id === active?.model)?.name || active?.model || DEFAULT_MODEL}
              </span>
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
            <h1>{authed ? "What can I help with?" : "Sign in to start"}</h1>
            {composer}
            {authed ? (
              <div className="c-examples">
                {EXAMPLES.map((ex) => (
                  <button key={ex} className="c-example" onClick={() => send(ex)}>
                    {ex}
                  </button>
                ))}
              </div>
            ) : (
              <div className="c-signin">
                <a className="c-primary" href="/login">Log in with Discord</a>
                <button className="c-example" onClick={() => setSettingsOpen(true)}>
                  <Key size={14} /> or use an API key
                </button>
              </div>
            )}
          </div>
        ) : (
          <>
            <div className="c-threadwrap">
            <div className="c-scroll" ref={scrollRef} onScroll={onThreadScroll}>
              <div className="c-thread">
                {messages.map((m, i) => (
                  <div key={i} className={`c-msg ${m.role}`}>
                    <div className="c-msg-body">
                      {m.image && <img className="c-msg-img" src={m.image} alt="attached" />}
                      {m.role === "assistant" && (
                        <PhaseTimer
                          live={busy && i === messages.length - 1}
                          startedAt={m.startedAt}
                          thinkMs={m.thinkMs}
                          answerMs={m.answerMs}
                          writing={Boolean(m.content)}
                        />
                      )}
                      {m.reasoning && (() => {
                        // Open it live while the model is still reasoning, then let
                        // it collapse itself once the answer starts arriving.
                        const active = busy && i === messages.length - 1 && !m.content;
                        return (
                          <details className={`c-think ${active ? "live" : ""}`} open={active}>
                            <summary>{active ? "Thinking…" : "Thought process"}</summary>
                            <div>{m.reasoning}</div>
                          </details>
                        );
                      })()}
                      {m.toolCalls?.length ? (
                        <div className="c-toolcalls">
                          {m.toolCalls.map((tc) => (
                            <div key={tc.id} className="c-toolcall">
                              <span className="c-tool-badge"><Wrench size={13} weight="bold" /> {tc.name}</span>
                              <code>{tc.arguments}</code>
                            </div>
                          ))}
                        </div>
                      ) : null}
                      {m.role === "assistant" ? (
                        <>
                        {m.content ? (
                          <>
                            <div className={busy && i === messages.length - 1 ? "c-streaming" : undefined}>
                              <Markdown>{m.content}</Markdown>
                            </div>
                            {!(busy && i === messages.length - 1) && (
                              <div className="c-actions">
                                <button
                                  className="c-action"
                                  onClick={() => copyMessage(m.content, i)}
                                  aria-label="Copy response"
                                  title="Copy response"
                                >
                                  {copiedIdx === i ? <Check size={15} /> : <Copy size={15} />}
                                </button>
                                <ReadAloudButton
                                  idx={i}
                                  status={readAloud.status}
                                  disabled={!authed}
                                  onClick={() => readAloud.speak(m.content, i)}
                                />
                              </div>
                            )}
                          </>
                        ) : (
                          busy &&
                          i === messages.length - 1 &&
                          !m.toolCalls?.length && (
                            <img
                              className="c-gen-logo"
                              src={active?.model?.startsWith("deepseek") ? "/deepseek.svg" : "/qwen.svg"}
                              alt="Generating response"
                              width={26}
                              height={26}
                            />
                          )
                        )}
                        {/* Outside the content check on purpose: a reply severed
                            during reasoning has no visible text at all, and that
                            is exactly the turn most worth resuming. */}
                        {m.truncated && i === messages.length - 1 && !busy && (
                          <div className="c-cutoff">
                            <span>
                              {m.content
                                ? "This reply was cut short by the upstream limit."
                                : "Ran out of room while thinking — the answer never started."}
                            </span>
                            <button className="c-continue" onClick={continueReply}>
                              {m.content ? "Continue from here" : "Write the answer"}
                            </button>
                          </div>
                        )}
                        </>
                      ) : m.role === "tool" ? (
                        <div className="c-toolresult">
                          <span className="c-tool-badge"><ArrowUp size={13} weight="bold" style={{ transform: "rotate(180deg)" }} /> {m.toolName}</span>
                          <code>{m.content}</code>
                        </div>
                      ) : (
                        <div className="c-user-text">{m.content}</div>
                      )}
                    </div>
                  </div>
                ))}

                {error && <div className="c-error">{error}</div>}
                {readAloud.error && <div className="c-error">{readAloud.error}</div>}
              </div>
            </div>
              {!atBottom && (
                <button className="c-jump" onClick={jumpToBottom} aria-label="Scroll to latest">
                  <CaretDown size={15} weight="bold" />
                </button>
              )}
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
              {me
                ? "Optional — you're signed in, so requests already go through your account. Add a key here only to bill a specific one."
                : "Stored only in this browser's local storage. It is never sent anywhere except this API."}{" "}
              <a href="/keys">Manage your keys</a>.
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

"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { DEMO_TOOLS, DEMO_TOOL_NAMES, runDemoTool } from "@/lib/demoTools";

type Mode = "chat" | "image" | "video" | "tts";

interface ToolCallView {
  id: string;
  name: string;
  arguments: string;
}

interface ModelOpt {
  id: string;
  name: string;
  chatTypes: string[];
  thinking: boolean;
}
interface VoiceOpt {
  speaker: string;
  name: string;
  gender: string;
  description: string;
}
interface Turn {
  role: "user" | "assistant" | "tool";
  content: string;
  reasoning?: string;
  image?: string; // user attachment (data URL)
  mediaUrl?: string; // assistant result
  mediaType?: "image" | "video" | "audio";
  pending?: boolean;
  toolCalls?: ToolCallView[]; // assistant requested these
  toolName?: string; // tool-result turn
  toolCallId?: string; // tool-result turn
}

export default function Playground() {
  const [apiKey, setApiKey] = useState("");
  const [models, setModels] = useState<ModelOpt[]>([]);
  const [model, setModel] = useState("qwen3.8-max-preview");
  const [voices, setVoices] = useState<VoiceOpt[]>([]);
  const [voice, setVoice] = useState("");
  const [mode, setMode] = useState<Mode>("chat");
  const [imageModel, setImageModel] = useState("qwen-image-3.0");
  const [aspect, setAspect] = useState("1:1");
  const [fast, setFast] = useState(false); // Think (default) vs Fast, non-3.8 models
  const [toolsOn, setToolsOn] = useState(false);
  const [toolsJson, setToolsJson] = useState(JSON.stringify(DEMO_TOOLS, null, 2));
  const [toolsEdit, setToolsEdit] = useState(false);
  const [input, setInput] = useState("");
  const [image, setImage] = useState<string | null>(null);
  const [turns, setTurns] = useState<Turn[]>([]);
  const [busy, setBusy] = useState(false);
  const [showThinking, setShowThinking] = useState(true);
  const scrollRef = useRef<HTMLDivElement>(null);

  // Image/video are dedicated models now, so they don't belong in the chat-model
  // picker and image generation no longer depends on the selected chat model.
  const isMedia = (id: string) => id.startsWith("qwen-image") || id === "qwen-vlo";
  const chatModels = models.filter((m) => !isMedia(m.id));
  const imageModels = models.filter((m) => m.id.startsWith("qwen-image"));
  const videoAvailable = models.some((m) => m.id === "qwen-vlo");
  // Think/Fast is offered for thinking-capable chat models except 3.8 Max Preview,
  // which always reasons (thinking can't be turned off there).
  const thinkForced = model === "qwen3.8-max-preview";
  const canPickThink = (chatModels.find((m) => m.id === model)?.thinking ?? false) && !thinkForced;

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
        thinking: Boolean(m.capabilities?.thinking),
      }));
      setModels(opts);
      const chats = opts.filter((o) => !o.id.startsWith("qwen-image") && o.id !== "qwen-vlo");
      if (chats.length && !chats.find((o) => o.id === model)) setModel(chats[0].id);
      const imgs = opts.filter((o) => o.id.startsWith("qwen-image"));
      if (imgs.length && !imgs.find((o) => o.id === imageModel)) setImageModel(imgs[0].id);
    } catch {
      /* ignore */
    }
    // voices for TTS
    try {
      const r = await fetch("/v1/audio/voices", { headers: { Authorization: `Bearer ${key}` } });
      if (r.ok) {
        const v: VoiceOpt[] = (await r.json()).data || [];
        setVoices(v);
        if (v.length) setVoice((cur) => cur || v[0].speaker);
      }
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
  // Video is optional; if it's not available, don't leave the user stuck on it.
  useEffect(() => {
    if (mode === "video" && !videoAvailable) setMode("chat");
  }, [mode, videoAvailable]);

  function onImage(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => setImage(reader.result as string);
    reader.readAsDataURL(file);
  }

  function toApiMessages(list: Turn[]): any[] {
    return list.map((t) => {
      if (t.role === "user" && t.image) {
        return { role: "user", content: [{ type: "text", text: t.content }, { type: "image_url", image_url: { url: t.image } }] };
      }
      if (t.role === "assistant" && t.toolCalls?.length) {
        return {
          role: "assistant",
          content: t.content || null,
          tool_calls: t.toolCalls.map((tc) => ({ id: tc.id, type: "function", function: { name: tc.name, arguments: tc.arguments } })),
        };
      }
      if (t.role === "tool") {
        return { role: "tool", tool_call_id: t.toolCallId || "", name: t.toolName, content: t.content };
      }
      return { role: t.role, content: t.content };
    });
  }

  // Parse the tools JSON (falls back to none if invalid). Empty array => no tools.
  function activeTools(): any[] | null {
    if (!toolsOn) return null;
    try {
      const t = JSON.parse(toolsJson);
      return Array.isArray(t) && t.length ? t : null;
    } catch {
      return null;
    }
  }

  // Stream one assistant turn. Returns its text + any tool_calls it requested.
  async function streamAssistant(apiMessages: any[], tools: any[] | null): Promise<{ content: string; toolCalls: ToolCallView[] }> {
    const res = await fetch("/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model,
        stream: true,
        messages: apiMessages,
        enable_thinking: canPickThink ? !fast : undefined,
        ...(tools ? { tools, tool_choice: "auto" } : {}),
      }),
    });
    if (!res.ok || !res.body) {
      const j = await res.json().catch(() => ({}));
      throw new Error(j?.error?.message || `HTTP ${res.status}`);
    }
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "", content = "", reasoning = "";
    const toolCalls: ToolCallView[] = [];
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
          if (Array.isArray(d?.tool_calls)) {
            for (const tc of d.tool_calls) {
              toolCalls.push({ id: tc.id, name: tc.function?.name, arguments: tc.function?.arguments || "{}" });
            }
          }
          setTurns((prev) => {
            const c = [...prev];
            c[c.length - 1] = { role: "assistant", content, reasoning, toolCalls: toolCalls.length ? [...toolCalls] : undefined };
            return c;
          });
        } catch {}
      }
    }
    return { content, toolCalls };
  }

  // Chat with the tool loop: stream a reply; if it asks for tools, run the demo
  // tools (unknown tools return an error result), feed results back, repeat.
  async function sendChat(history: Turn[]) {
    const tools = activeTools();
    const apiMessages = toApiMessages(history);

    for (let hop = 0; hop < 8; hop++) {
      const { content, toolCalls } = await streamAssistant(apiMessages, tools);
      apiMessages.push({
        role: "assistant",
        content: content || null,
        ...(toolCalls.length ? { tool_calls: toolCalls.map((tc) => ({ id: tc.id, type: "function", function: { name: tc.name, arguments: tc.arguments } })) } : {}),
      });
      if (!tools || toolCalls.length === 0) return;

      // Execute each requested tool and show the result as a tool turn.
      const resultTurns: Turn[] = [];
      for (const tc of toolCalls) {
        let args: any = {};
        try { args = JSON.parse(tc.arguments || "{}"); } catch {}
        const result = DEMO_TOOL_NAMES.has(tc.name)
          ? runDemoTool(tc.name, args)
          : { error: `No executor for "${tc.name}". Only the demo tools run automatically.` };
        const content = JSON.stringify(result);
        resultTurns.push({ role: "tool", content, toolName: tc.name, toolCallId: tc.id });
        apiMessages.push({ role: "tool", tool_call_id: tc.id, name: tc.name, content });
      }
      // Add tool-result turns + a fresh assistant placeholder for the next hop.
      setTurns((prev) => [...prev, ...resultTurns, { role: "assistant", content: "", pending: true }]);
    }
  }

  // Qwen's CDN URLs don't load reliably in an <img>/<video> (signed + referer
  // checked), so we serve them back through our own origin.
  const viaProxy = (u: string) => `/api/media?url=${encodeURIComponent(u)}`;

  // Filename for the download button. Everything we render is same-origin
  // (/api/media) or a blob: URL, so the `download` attribute works.
  function mediaFilename(kind?: string): string {
    const ts = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
    if (kind === "image") return `qwen-image-${ts}.png`;
    if (kind === "video") return `qwen-video-${ts}.mp4`;
    if (kind === "audio") return `qwen-speech-${ts}.wav`;
    return `qwen-${ts}`;
  }

  function setResult(mediaUrl: string, kind: "image" | "video") {
    setTurns((prev) => {
      const c = [...prev];
      c[c.length - 1] = { role: "assistant", content: "", mediaUrl: viaProxy(mediaUrl), mediaType: kind };
      return c;
    });
  }

  async function sendImage(prompt: string) {
    const res = await fetch("/v1/images/generations", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({ model: imageModel, prompt, size: aspect }),
    });
    const j = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(j?.error?.message || `HTTP ${res.status}`);
    const url = j?.data?.[0]?.url;
    if (!url) throw new Error("No image returned");
    setResult(url, "image");
  }

  // Video has NO timeout: we kick off the task and poll until it's done.
  async function sendVideo(prompt: string) {
    const res = await fetch("/v1/videos/generations", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({ model, prompt }),
    });
    const j = await res.json().catch(() => ({}));
    if (!res.ok && res.status !== 202) throw new Error(j?.error?.message || `HTTP ${res.status}`);
    if (j?.data?.[0]?.url) return setResult(j.data[0].url, "video");

    const taskId = j?.id;
    const chatId = j?.chat_id;
    if (!taskId) throw new Error("No video task returned");

    const started = Date.now();
    for (;;) {
      await new Promise((r) => setTimeout(r, 5000));
      const mins = Math.floor((Date.now() - started) / 60000);
      const secs = Math.floor(((Date.now() - started) % 60000) / 1000);
      setTurns((prev) => {
        const c = [...prev];
        c[c.length - 1] = { role: "assistant", content: `Rendering video… ${mins}m ${secs}s`, pending: true };
        return c;
      });
      const s = await fetch(
        `/v1/videos/status?task_id=${encodeURIComponent(taskId)}${chatId ? `&chat_id=${encodeURIComponent(chatId)}` : ""}`,
        { headers: { Authorization: `Bearer ${apiKey}` } }
      );
      const sj = await s.json().catch(() => ({}));
      if (sj?.status === "completed" && sj?.data?.[0]?.url) return setResult(sj.data[0].url, "video");
      if (sj?.status === "failed") throw new Error("Video generation failed upstream");
    }
  }

  async function sendSpeech(text: string) {
    const res = await fetch("/v1/audio/speech", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({ input: text, voice }),
    });
    if (!res.ok) {
      const j = await res.json().catch(() => ({}));
      throw new Error(j?.error?.message || `HTTP ${res.status}`);
    }
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    setTurns((prev) => {
      const c = [...prev];
      c[c.length - 1] = { role: "assistant", content: "", mediaUrl: url, mediaType: "audio" };
      return c;
    });
  }

  async function send() {
    const text = input.trim();
    if ((!text && !image) || busy || !apiKey) return;

    const userTurn: Turn = { role: "user", content: text || (mode === "chat" ? "(image)" : ""), image: image || undefined };
    const history = [...turns, userTurn];
    const pendingLabel =
      mode === "video"
        ? "Starting video render… (this can take a while — no time limit)"
        : mode === "image"
        ? "Generating image…"
        : mode === "tts"
        ? "Generating speech…"
        : "";
    setTurns([...history, { role: "assistant", content: pendingLabel, pending: true }]);
    setInput("");
    setImage(null);
    setBusy(true);
    try {
      if (mode === "chat") await sendChat(history);
      else if (mode === "tts") await sendSpeech(text);
      else if (mode === "image") await sendImage(text);
      else await sendVideo(text);
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
    : mode === "tts"
    ? "Type text to read aloud…"
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
        {mode === "tts" ? (
          <select className="input pg-select" value={voice} onChange={(e) => setVoice(e.target.value)}>
            {voices.length === 0 && <option value="">(default voice)</option>}
            {voices.map((v) => (
              <option key={v.speaker} value={v.speaker}>
                {v.name}{v.gender ? ` · ${v.gender}` : ""}{v.description ? ` — ${v.description}` : ""}
              </option>
            ))}
          </select>
        ) : mode === "image" ? (
          <>
            <select className="input pg-select" value={imageModel} onChange={(e) => setImageModel(e.target.value)}>
              {imageModels.length === 0 && <option value={imageModel}>{imageModel}</option>}
              {imageModels.map((m) => (
                <option key={m.id} value={m.id}>{m.name}</option>
              ))}
            </select>
            <select className="input pg-select" value={aspect} onChange={(e) => setAspect(e.target.value)} title="Aspect ratio">
              <option value="1:1">1:1 · Square</option>
              <option value="16:9">16:9 · Landscape</option>
              <option value="9:16">9:16 · Portrait</option>
              <option value="4:3">4:3</option>
              <option value="3:4">3:4</option>
            </select>
          </>
        ) : (
          <select className="input pg-select" value={model} onChange={(e) => setModel(e.target.value)}>
            {chatModels.length === 0 && <option value={model}>{model}</option>}
            {chatModels.map((m) => (
              <option key={m.id} value={m.id}>{m.name}</option>
            ))}
          </select>
        )}
        <div className="pg-modes">
          <button className={`pill ${mode === "chat" ? "on" : ""}`} onClick={() => setMode("chat")}>Chat</button>
          <button className={`pill ${mode === "image" ? "on" : ""}`} onClick={() => setMode("image")}>Image</button>
          {videoAvailable && (
            <button className={`pill ${mode === "video" ? "on" : ""}`} onClick={() => setMode("video")}>Video</button>
          )}
          <button className={`pill ${mode === "tts" ? "on" : ""}`} onClick={() => setMode("tts")}>Speech</button>
        </div>
        {mode === "chat" && canPickThink && (
          <div className="pg-modes" role="group" aria-label="Reasoning">
            <button className={`pill ${!fast ? "on" : ""}`} onClick={() => setFast(false)} title="Reason step by step (slower, better)">Think</button>
            <button className={`pill ${fast ? "on" : ""}`} onClick={() => setFast(true)} title="Skip reasoning (faster)">Fast</button>
          </div>
        )}
        {mode === "chat" && (
          <div className="pg-modes" role="group" aria-label="Tools">
            <button className={`pill ${toolsOn ? "on" : ""}`} onClick={() => setToolsOn((v) => !v)} title="Enable function/tool calling with the demo tools">
              🔧 Tools {toolsOn ? "on" : "off"}
            </button>
            {toolsOn && (
              <button className="pill" onClick={() => setToolsEdit((v) => !v)} title="View / edit the tool schemas sent to the model">
                {toolsEdit ? "Hide schema" : "Edit schema"}
              </button>
            )}
          </div>
        )}
      </div>
      {mode === "chat" && toolsOn && toolsEdit && (
        <div className="pg-tools-edit">
          <label>Tools (OpenAI schema JSON). Demo tools auto-run; others return an error result.</label>
          <textarea
            className="input"
            spellCheck={false}
            value={toolsJson}
            onChange={(e) => setToolsJson(e.target.value)}
            rows={10}
          />
          {activeTools() === null && <p className="pg-tools-warn">⚠️ Not valid JSON (or empty) — tools won&apos;t be sent.</p>}
        </div>
      )}

      <div className="pg-chat" ref={scrollRef}>
        {turns.length === 0 && <p className="pg-empty">Pick a mode, then start. Chat supports image input; Image generates pictures{videoAvailable ? "/video" : ""}.</p>}
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
            {t.mediaUrl && t.mediaType === "audio" && <audio src={t.mediaUrl} controls autoPlay style={{ width: 280, display: "block" }} />}
            {t.mediaUrl && (
              <a className="dl-btn" href={t.mediaUrl} download={mediaFilename(t.mediaType)}>
                ↓ Download {t.mediaType === "audio" ? "audio" : t.mediaType}
              </a>
            )}
            {t.content && t.role !== "tool" && <div className="bubble-text">{t.content}</div>}
            {t.toolCalls?.map((tc) => (
              <div key={tc.id} className="tool-call">
                <span className="tool-badge">🔧 {tc.name}</span>
                <code>{tc.arguments}</code>
              </div>
            ))}
            {t.role === "tool" && (
              <div className="tool-result">
                <span className="tool-badge">↩ {t.toolName}</span>
                <code>{t.content}</code>
              </div>
            )}
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

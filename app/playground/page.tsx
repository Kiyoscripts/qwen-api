"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  ArrowUp,
  ChatCircle,
  Check,
  CircleNotch,
  Copy,
  DownloadSimple,
  ImageSquare,
  Key,
  Paperclip,
  SpeakerHigh,
  Stop,
  Trash,
  VideoCamera,
  Wrench,
  X,
} from "@phosphor-icons/react";
import Aurora, { type AuroraState } from "../Aurora";
import Select from "../Select";
import { useMe, AccountChip } from "../Account";
import { PhaseTimer } from "../PhaseTimer";
import { DEMO_TOOLS, DEMO_TOOL_NAMES, runDemoTool } from "@/lib/demoTools";

type Mode = "chat" | "image" | "video" | "tts";

const BASE = typeof window !== "undefined" ? window.location.origin : "";

const MODES: { id: Mode; name: string; desc: string; icon: React.ReactNode }[] = [
  { id: "chat", name: "Chat", desc: "Streaming text, vision, tools", icon: <ChatCircle size={17} /> },
  { id: "image", name: "Image", desc: "Generate, or edit with references", icon: <ImageSquare size={17} /> },
  { id: "video", name: "Video", desc: "Text to video, ~5s clips", icon: <VideoCamera size={17} /> },
  { id: "tts", name: "Speech", desc: "Text to speech, ~78 voices", icon: <SpeakerHigh size={17} /> },
];

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
  images?: string[]; // user attachments (data URLs)
  mediaUrl?: string; // assistant result
  mediaType?: "image" | "video" | "audio";
  pending?: boolean;
  error?: boolean;
  ms?: number; // wall time for a finished assistant turn
  thinkMs?: number; // request start -> first visible token
  answerMs?: number; // first visible token -> end of stream
  startedAt?: number; // epoch ms, lets a live turn tick without re-rendering
  toolCalls?: ToolCallView[]; // assistant requested these
  toolName?: string; // tool-result turn
  toolCallId?: string; // tool-result turn
  progress?: number | null; // media generation progress (0-100)
}

const ASPECTS_IMAGE = ["1:1", "16:9", "9:16", "4:3", "3:4"];
const ASPECTS_VIDEO = ["16:9", "9:16", "1:1", "4:3", "3:4"];

// How many images each mode accepts. Image editing takes a set of references;
// Chat vision takes one, image editing takes a set. Video takes none: the
// upstream service has no image-to-video mode, so an attachment there would be
// uploaded and then silently discarded.
const MAX_ATTACH: Record<Mode, number> = { chat: 1, image: 4, video: 0, tts: 0 };

export default function Playground() {
  const me = useMe();
  const [apiKey, setApiKey] = useState("");
  const [keyDraft, setKeyDraft] = useState("");
  const [editingKey, setEditingKey] = useState(false);
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
  const [attach, setAttach] = useState<string[]>([]);
  const [turns, setTurns] = useState<Turn[]>([]);
  const [busy, setBusy] = useState(false);
  const [showThinking, setShowThinking] = useState(true);
  const [showReq, setShowReq] = useState(false);
  const [reqCopied, setReqCopied] = useState(false);
  const [status, setStatus] = useState<string | null>(null);

  // A pasted key wins; otherwise the session cookie authenticates the request,
  // so being signed in is enough to use the playground.
  const authed = Boolean(apiKey) || Boolean(me);
  const authHeaders = (): Record<string, string> => (apiKey ? { Authorization: `Bearer ${apiKey}` } : {});

  const scrollRef = useRef<HTMLDivElement>(null);
  const taRef = useRef<HTMLTextAreaElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  // Bumped per streamed token so the backdrop reacts to output without renders.
  const pulseRef = useRef(0);

  // Image/video are dedicated models, so they don't belong in the chat-model
  // picker and image generation doesn't depend on the selected chat model.
  const isMedia = (id: string) => id.startsWith("qwen-image") || id === "qwen-wan";
  const chatModels = models.filter((m) => !isMedia(m.id));
  const imageModels = models.filter((m) => m.id.startsWith("qwen-image"));
  const videoModels = models.filter((m) => m.id === "qwen-wan");
  const videoAvailable = videoModels.length > 0;
  // Think/Fast is offered for thinking-capable chat models except 3.8 Max Preview,
  // which always reasons (thinking can't be turned off there).
  const thinkForced = model === "qwen3.8-max-preview";
  const canPickThink = (chatModels.find((m) => m.id === model)?.thinking ?? false) && !thinkForced;

  const loadModels = useCallback(async (key: string) => {
    const auth: Record<string, string> = key ? { Authorization: `Bearer ${key}` } : {};
    try {
      const r = await fetch("/v1/models", { headers: auth });
      if (!r.ok) return;
      const j = await r.json();
      const opts: ModelOpt[] = (j.data || []).map((m: any) => ({
        id: m.id,
        name: m.display_name || m.id,
        chatTypes: m.capabilities?.chat_types || ["t2t"],
        thinking: Boolean(m.capabilities?.thinking),
      }));
      setModels(opts);
      const chats = opts.filter((o) => !o.id.startsWith("qwen-image") && o.id !== "qwen-wan");
      if (chats.length && !chats.find((o) => o.id === model)) setModel(chats[0].id);
      const imgs = opts.filter((o) => o.id.startsWith("qwen-image"));
      if (imgs.length && !imgs.find((o) => o.id === imageModel)) setImageModel(imgs[0].id);
    } catch {
      /* ignore */
    }
    // voices for TTS
    try {
      const r = await fetch("/v1/audio/voices", { headers: auth });
      if (r.ok) {
        const v: VoiceOpt[] = (await r.json()).data || [];
        setVoices(v);
        if (v.length) setVoice((cur) => cur || v[0].speaker);
      }
    } catch {
      /* ignore */
    }
  }, [model, imageModel]);

  useEffect(() => {
    const k = localStorage.getItem("qwen_api_key");
    if (k) {
      setApiKey(k);
      setKeyDraft(k);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  // Load the catalogue once we know how we're authenticating — a pasted key, or
  // the session. Signed-in users never see the key prompt.
  useEffect(() => {
    if (authed) loadModels(apiKey);
    else if (me === null && !apiKey) setEditingKey(true);
  }, [authed, apiKey, me, loadModels]);
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [turns]);
  // Video is optional; if it's not available, don't leave the user stuck on it.
  useEffect(() => {
    if (mode === "video" && !videoAvailable && models.length) setMode("chat");
  }, [mode, videoAvailable, models.length]);
  // Aspect lists differ per mode — snap to a valid one when switching.
  useEffect(() => {
    const list = mode === "video" ? ASPECTS_VIDEO : ASPECTS_IMAGE;
    setAspect((a) => (list.includes(a) ? a : list[0]));
  }, [mode]);
  // Modes accept different numbers of images — trim rather than silently send
  // attachments the new mode can't use.
  useEffect(() => {
    setAttach((a) => (a.length > MAX_ATTACH[mode] ? a.slice(0, MAX_ATTACH[mode]) : a));
  }, [mode]);

  function saveKey() {
    const k = keyDraft.trim();
    setApiKey(k);
    localStorage.setItem("qwen_api_key", k);
    setEditingKey(false);
    if (k) loadModels(k);
  }

  function onImage(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files || []);
    e.target.value = "";
    for (const file of files) {
      const reader = new FileReader();
      reader.onload = () =>
        setAttach((a) => (a.length >= MAX_ATTACH[mode] ? a : [...a, reader.result as string]));
      reader.readAsDataURL(file);
    }
  }

  function autoGrow() {
    const el = taRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = Math.min(el.scrollHeight, 180) + "px";
  }

  function toApiMessages(list: Turn[]): any[] {
    return list.map((t) => {
      if (t.role === "user" && t.images?.length) {
        return {
          role: "user",
          content: [
            { type: "text", text: t.content },
            ...t.images.map((url) => ({ type: "image_url", image_url: { url } })),
          ],
        };
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
  async function streamAssistant(apiMessages: any[], tools: any[] | null, signal: AbortSignal): Promise<{ content: string; toolCalls: ToolCallView[] }> {
    const res = await fetch("/v1/chat/completions", {
      method: "POST",
      signal,
      headers: { "Content-Type": "application/json", ...authHeaders() },
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
    // Everything before the first visible character is deliberation; everything
    // after is output. On a model that always reasons those differ a lot.
    const startedAt = Date.now();
    let firstContentAt: number | null = null;
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
          if (d?.reasoning_content) { reasoning += d.reasoning_content; pulseRef.current++; }
          if (d?.content) {
            if (firstContentAt === null) firstContentAt = Date.now();
            content += d.content;
            pulseRef.current++;
          }
          if (Array.isArray(d?.tool_calls)) {
            for (const tc of d.tool_calls) {
              toolCalls.push({ id: tc.id, name: tc.function?.name, arguments: tc.function?.arguments || "{}" });
            }
          }
          setTurns((prev) => {
            const c = [...prev];
            c[c.length - 1] = {
              role: "assistant", content, reasoning, pending: true,
              startedAt,
              thinkMs: firstContentAt === null ? undefined : firstContentAt - startedAt,
              toolCalls: toolCalls.length ? [...toolCalls] : undefined,
            };
            return c;
          });
        } catch {}
      }
    }
    // Freeze the split once the stream ends.
    const endedAt = Date.now();
    setTurns((prev) => {
      const c = [...prev];
      const i = c.length - 1;
      if (c[i]?.role === "assistant") {
        c[i] = {
          ...c[i],
          startedAt: undefined,
          thinkMs: (firstContentAt ?? endedAt) - startedAt,
          answerMs: firstContentAt === null ? 0 : endedAt - firstContentAt,
        };
      }
      return c;
    });
    return { content, toolCalls };
  }

  // Chat with the tool loop: stream a reply; if it asks for tools, run the demo
  // tools (unknown tools return an error result), feed results back, repeat.
  async function sendChat(history: Turn[], signal: AbortSignal) {
    const tools = activeTools();
    const apiMessages = toApiMessages(history);

    for (let hop = 0; hop < 8; hop++) {
      const { content, toolCalls } = await streamAssistant(apiMessages, tools, signal);
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
      setTurns((prev) => [...prev, ...resultTurns, { role: "assistant", content: "", pending: true, startedAt: Date.now() }]);
    }
  }

  // Qwen's CDN URLs don't load reliably in an <img>/<video> (signed + referer
  // checked), so we serve them back through our own origin. Images already come
  // pre-proxied (encrypted /api/media?t= token) — don't wrap those a second time.
  const viaProxy = (u: string) => (/\/api\/media\?/.test(u) ? u : `/api/media?url=${encodeURIComponent(u)}`);

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

  // With reference images this is an edit rather than a generation — the same
  // endpoint, with `image` carrying the references.
  async function sendImage(prompt: string, refs: string[], signal: AbortSignal) {
    setStatus(refs.length ? "Editing image…" : "Generating image…");
    const res = await fetch("/v1/images/generations", {
      method: "POST",
      signal,
      headers: { "Content-Type": "application/json", ...authHeaders() },
      body: JSON.stringify({ model: imageModel, prompt, size: aspect, ...(refs.length ? { image: refs } : {}) }),
    });
    const j = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(j?.error?.message || `HTTP ${res.status}`);
    const url = j?.data?.[0]?.url;
    if (!url) throw new Error("No image returned");
    setResult(url, "image");
  }

  // Video has NO timeout: we kick off the task and poll until it's done.
  async function sendVideo(prompt: string, ref: string | undefined, signal: AbortSignal) {
    setStatus("Starting render…");
    const res = await fetch("/v1/videos/generations", {
      method: "POST",
      signal,
      headers: { "Content-Type": "application/json", ...authHeaders() },
      body: JSON.stringify({ model: "qwen-wan", prompt, size: aspect, ...(ref ? { image: ref } : {}) }),
    });
    const j = await res.json().catch(() => ({}));
    if (!res.ok && res.status !== 202) throw new Error(j?.error?.message || `HTTP ${res.status}`);
    if (j?.data?.[0]?.url) return setResult(j.data[0].url, "video");

    const taskId = j?.id;
    // The ticket pins polling to the account that owns the task (carries task/chat/
    // started), so we don't have to send those separately.
    const ticket = j?.ticket;
    if (!taskId && !ticket) throw new Error("No video task returned");

    for (;;) {
      await new Promise((r) => setTimeout(r, 5000));
      if (signal.aborted) throw Object.assign(new Error("Aborted"), { name: "AbortError" });
      const s = await fetch(
        ticket
          ? `/v1/videos/status?ticket=${encodeURIComponent(ticket)}`
          : `/v1/videos/status?task_id=${encodeURIComponent(taskId)}`,
        { headers: authHeaders(), signal }
      );
      const sj = await s.json().catch(() => ({}));
      if (sj?.status === "completed" && sj?.data?.[0]?.url) return setResult(sj.data[0].url, "video");
      if (sj?.status === "failed") throw new Error("Video generation failed upstream");
      const pct = typeof sj?.progress === "number" ? sj.progress : null;
      setStatus(pct === null ? "Rendering…" : `Rendering ${pct}%`);
      setTurns((prev) => {
        const c = [...prev];
        c[c.length - 1] = { role: "assistant", content: "", pending: true, progress: pct };
        return c;
      });
    }
  }

  async function sendSpeech(text: string, signal: AbortSignal) {
    setStatus("Synthesising…");
    const res = await fetch("/v1/audio/speech", {
      method: "POST",
      signal,
      headers: { "Content-Type": "application/json", ...authHeaders() },
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
    const refs = attach.slice(0, MAX_ATTACH[mode]);
    if ((!text && refs.length === 0) || busy || !authed) return;

    const label = text || (mode === "image" ? "(edit these images)" : "(image)");
    const userTurn: Turn = { role: "user", content: label, images: refs.length ? refs : undefined };
    const history = [...turns, userTurn];
    setTurns([...history, { role: "assistant", content: "", pending: true, startedAt: Date.now() }]);
    setInput("");
    setAttach([]);
    setBusy(true);
    setStatus(mode === "chat" ? "Streaming…" : "Working…");
    requestAnimationFrame(autoGrow);

    const ctrl = new AbortController();
    abortRef.current = ctrl;
    const t0 = performance.now();

    try {
      if (mode === "chat") await sendChat(history, ctrl.signal);
      else if (mode === "tts") await sendSpeech(text, ctrl.signal);
      else if (mode === "image") await sendImage(text, refs, ctrl.signal);
      else await sendVideo(text, refs[0], ctrl.signal);
      const ms = Math.round(performance.now() - t0);
      setStatus(`Done in ${(ms / 1000).toFixed(1)}s`);
      setTurns((prev) => {
        const c = [...prev];
        const last = c[c.length - 1];
        if (last?.role === "assistant") c[c.length - 1] = { ...last, pending: false, ms };
        return c;
      });
    } catch (e: any) {
      const aborted = e?.name === "AbortError";
      setStatus(aborted ? "Stopped" : "Error");
      setTurns((prev) => {
        const c = [...prev];
        const last = c[c.length - 1];
        if (aborted) {
          // Keep partial text; drop the placeholder if nothing arrived.
          if (last?.role === "assistant" && !last.content && !last.mediaUrl) c.pop();
          else if (last) c[c.length - 1] = { ...last, pending: false };
        } else {
          c[c.length - 1] = { role: "assistant", content: e.message, error: true };
        }
        return c;
      });
    } finally {
      setBusy(false);
      abortRef.current = null;
    }
  }

  function stop() {
    abortRef.current?.abort();
  }

  function clearRun() {
    abortRef.current?.abort();
    setTurns([]);
    setStatus(null);
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  }

  // The equivalent HTTP call for whatever is configured right now. This is the
  // point of a playground — you should be able to leave with a working request.
  function curl(): string {
    const h = `  -H "Authorization: Bearer $QWEN_API_KEY" \\\n  -H "Content-Type: application/json" \\`;
    const prompt = input.trim() || "Hello!";
    if (mode === "image") {
      const body: any = { model: imageModel, prompt, size: aspect };
      // Reference images turn this into an edit. Elided — they're huge data URLs.
      if (attach.length) body.image = attach.map(() => "data:image/png;base64,…");
      return `curl ${BASE}/v1/images/generations \\\n${h}\n  -d '${JSON.stringify(body, null, 2)}'`;
    }
    if (mode === "video") {
      const body: any = { model: "qwen-wan", prompt, size: aspect };
      if (attach.length) body.image = "data:image/png;base64,…";
      return `curl ${BASE}/v1/videos/generations \\\n${h}\n  -d '${JSON.stringify(body, null, 2)}'`;
    }
    if (mode === "tts") {
      const body = { input: prompt, voice: voice || "(default)" };
      return `curl ${BASE}/v1/audio/speech --output speech.wav \\\n${h}\n  -d '${JSON.stringify(body, null, 2)}'`;
    }
    const body: any = { model, stream: true, messages: [{ role: "user", content: prompt }] };
    if (canPickThink) body.enable_thinking = !fast;
    const tools = activeTools();
    if (tools) { body.tools = "[…tool schemas…]"; body.tool_choice = "auto"; }
    return `curl ${BASE}/v1/chat/completions \\\n${h}\n  -d '${JSON.stringify(body, null, 2).replace('"[…tool schemas…]"', "[…tool schemas…]")}'`;
  }

  async function copyCurl() {
    try {
      await navigator.clipboard.writeText(curl());
      setReqCopied(true);
      setTimeout(() => setReqCopied(false), 1500);
    } catch {
      /* clipboard blocked */
    }
  }

  const auroraState: AuroraState = busy ? (mode === "chat" ? "responding" : "thinking") : "ambient";
  const modeMeta = MODES.find((m) => m.id === mode)!;
  const maxAttach = MAX_ATTACH[mode];
  const canSend = authed && !busy && Boolean(input.trim() || (maxAttach > 0 && attach.length));
  const placeholder = !authed
    ? "Add your API key to start"
    : mode === "image"
    ? attach.length
      ? "Describe the edit — or leave blank to restyle…"
      : "Describe an image to generate, or attach one to edit…"
    : mode === "video"
    ? "Describe a video to generate…"
    : mode === "tts"
    ? "Type text to read aloud…"
    : "Message the model…  (Enter to send, Shift+Enter for a newline)";

  return (
    <div className="pgx">
      <Aurora state={auroraState} pulseRef={pulseRef} />

      {/* ---------------- left rail: the request ---------------- */}
      <aside className="pgx-side">
        <a className="pgx-brand" href="/">
          <span className="lp-logo" /> Qwen3.8&nbsp;API
        </a>

        <div className="pgx-side-scroll">
          <section className="pgx-sec">
            <h3 className="pgx-lbl">Mode</h3>
            <div className="pgx-modes">
              {MODES.filter((m) => m.id !== "video" || videoAvailable || !models.length).map((m) => (
                <button key={m.id} className={`pgx-mode ${mode === m.id ? "on" : ""}`} onClick={() => setMode(m.id)}>
                  <span className="pgx-mode-ic">{m.icon}</span>
                  <span className="pgx-mode-txt">
                    <b>{m.name}</b>
                    <em>{m.desc}</em>
                  </span>
                </button>
              ))}
            </div>
          </section>

          <section className="pgx-sec">
            <h3 className="pgx-lbl">Parameters</h3>

            {mode === "chat" && (
              <>
                <div className="pgx-field">
                  <span>Model</span>
                  <Select
                    ariaLabel="Chat model"
                    value={model}
                    onChange={setModel}
                    options={
                      chatModels.length
                        ? chatModels.map((m) => ({ value: m.id, label: m.name, hint: m.id }))
                        : [{ value: model, label: model }]
                    }
                  />
                </div>
                {canPickThink ? (
                  <div className="pgx-field">
                    <span>Reasoning</span>
                    <div className="pgx-seg">
                      <button className={!fast ? "on" : ""} onClick={() => setFast(false)}>Think</button>
                      <button className={fast ? "on" : ""} onClick={() => setFast(true)}>Fast</button>
                    </div>
                  </div>
                ) : thinkForced ? (
                  <p className="pgx-note">This model always reasons — thinking can&apos;t be turned off.</p>
                ) : null}
                <label className="pgx-check">
                  <input type="checkbox" checked={showThinking} onChange={(e) => setShowThinking(e.target.checked)} />
                  <span>Show reasoning in the log</span>
                </label>
              </>
            )}

            {mode === "image" && (
              <>
                <div className="pgx-field">
                  <span>Model</span>
                  <Select
                    ariaLabel="Image model"
                    value={imageModel}
                    onChange={setImageModel}
                    options={
                      imageModels.length
                        ? imageModels.map((m) => ({ value: m.id, label: m.name, hint: m.id }))
                        : [{ value: imageModel, label: imageModel }]
                    }
                  />
                </div>
                <div className="pgx-field">
                  <span>Aspect ratio</span>
                  <div className="pgx-ratios">
                    {ASPECTS_IMAGE.map((a) => (
                      <button key={a} className={aspect === a ? "on" : ""} onClick={() => setAspect(a)}>{a}</button>
                    ))}
                  </div>
                </div>
                <p className="pgx-note">
                  Attach up to {MAX_ATTACH.image} images in the composer to edit them instead of
                  generating from scratch — the prompt then describes the change.
                </p>
              </>
            )}

            {mode === "video" && (
              <>
                <div className="pgx-field">
                  <span>Model</span>
                  <Select
                    ariaLabel="Video model"
                    value="qwen-wan"
                    onChange={() => {}}
                    disabled
                    options={[{ value: "qwen-wan", label: "Qwen Wan", hint: "qwen-wan" }]}
                  />
                </div>
                <div className="pgx-field">
                  <span>Aspect ratio</span>
                  <div className="pgx-ratios">
                    {ASPECTS_VIDEO.map((a) => (
                      <button key={a} className={aspect === a ? "on" : ""} onClick={() => setAspect(a)}>{a}</button>
                    ))}
                  </div>
                </div>
                <p className="pgx-note">Text to video only — the upstream service has no image-to-video mode. Renders have no time limit.</p>
              </>
            )}

            {mode === "tts" && (
              <div className="pgx-field">
                <span>Voice</span>
                <Select
                  ariaLabel="Voice"
                  value={voice}
                  onChange={setVoice}
                  options={
                    voices.length
                      ? voices.map((v) => ({
                          value: v.speaker,
                          label: v.name + (v.gender ? ` · ${v.gender}` : ""),
                          hint: v.description || undefined,
                        }))
                      : [{ value: "", label: "Default voice" }]
                  }
                />
              </div>
            )}
          </section>

          {mode === "chat" && (
            <section className="pgx-sec">
              <h3 className="pgx-lbl">Tools</h3>
              <label className="pgx-check">
                <input type="checkbox" checked={toolsOn} onChange={(e) => setToolsOn(e.target.checked)} />
                <span>Send tool schemas</span>
              </label>
              {toolsOn && (
                <>
                  <button className="pgx-link" onClick={() => setToolsEdit((v) => !v)}>
                    {toolsEdit ? "Hide schema" : "Edit schema"}
                  </button>
                  {toolsEdit && (
                    <>
                      <textarea
                        className="pgx-code-edit"
                        spellCheck={false}
                        value={toolsJson}
                        onChange={(e) => setToolsJson(e.target.value)}
                        rows={12}
                      />
                      {activeTools() === null && <p className="pgx-warn">Not valid JSON (or empty) — tools won&apos;t be sent.</p>}
                    </>
                  )}
                  <p className="pgx-note">Demo tools run automatically; anything else returns an error result you can inspect.</p>
                </>
              )}
            </section>
          )}
        </div>

        {/* API key lives at the foot of the rail, like a connection status. */}
        <div className="pgx-key">
          {editingKey ? (
            <>
              <h3 className="pgx-lbl">API key</h3>
              <input
                className="pgx-input"
                type="password"
                placeholder="qwen_sk_…"
                value={keyDraft}
                onChange={(e) => setKeyDraft(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && saveKey()}
              />
              <div className="pgx-key-row">
                <button className="g-btn" onClick={saveKey} style={{ flex: 1, justifyContent: "center" }}>Connect</button>
                <a className="pgx-link" href="/keys">Get a key</a>
              </div>
            </>
          ) : (
            <>
              {me && (
                <a className="pgx-acct" href="/keys" title="Open your dashboard">
                  <AccountChip me={me} />
                </a>
              )}
              <button className="pgx-conn" onClick={() => setEditingKey(true)}>
                <span className={`pgx-dot ${authed ? "ok" : ""}`} />
                <span className="pgx-conn-txt">
                  <b>{apiKey ? "Connected" : me ? "Using your account" : "Not connected"}</b>
                  <em>
                    {apiKey
                      ? `${models.length} models · ${apiKey.slice(0, 11)}…`
                      : me
                      ? `${models.length} models · click to use a key instead`
                      : "Log in, or click to add a key"}
                  </em>
                </span>
                <Key size={15} />
              </button>
              {!me && me !== undefined && !apiKey && (
                <a className="g-btn" href="/login" style={{ width: "100%", justifyContent: "center", marginTop: 10 }}>
                  Log in with Discord
                </a>
              )}
            </>
          )}
        </div>
      </aside>

      {/* ---------------- right: the run log ---------------- */}
      <main className="pgx-main">
        <header className="pgx-top">
          <div className="pgx-crumb">
            <span>Playground</span>
            <i>/</i>
            <b>{modeMeta.name}</b>
          </div>
          {status && (
            <span className={`pgx-status ${busy ? "live" : ""}`}>
              {busy && <CircleNotch size={12} className="pgx-spin" />}
              {status}
            </span>
          )}
          <div className="pgx-top-actions">
            <button className={`pgx-ghost ${showReq ? "on" : ""}`} onClick={() => setShowReq((v) => !v)}>
              {showReq ? "Hide request" : "Show request"}
            </button>
            <button className="pgx-ghost" onClick={clearRun} disabled={turns.length === 0} title="Clear the log">
              <Trash size={14} />
            </button>
          </div>
        </header>

        {showReq && (
          <div className="pgx-req">
            <div className="pgx-req-head">
              <span>Equivalent request</span>
              <button className="pgx-ghost" onClick={copyCurl}>
                {reqCopied ? <Check size={13} /> : <Copy size={13} />} {reqCopied ? "Copied" : "Copy"}
              </button>
            </div>
            <pre>{curl()}</pre>
          </div>
        )}

        <div className="pgx-out" ref={scrollRef}>
          {turns.length === 0 ? (
            <div className="pgx-empty">
              <span className="pgx-empty-ic">{modeMeta.icon}</span>
              <h2>{modeMeta.name}</h2>
              <p>{modeMeta.desc}. Set your parameters on the left, then send a prompt below.</p>
            </div>
          ) : (
            turns.map((t, i) => (
              <div key={i} className={`pgx-turn ${t.role}${t.error ? " err" : ""}`}>
                <div className="pgx-gutter">
                  {t.role === "user" ? "You" : t.role === "tool" ? "tool" : mode === "chat" ? model : mode}
                </div>
                <div className="pgx-turnbody">
                  {t.images?.length ? (
                    <div className="pgx-attached">
                      {t.images.map((src, n) => <img key={n} src={src} alt={`attachment ${n + 1}`} />)}
                    </div>
                  ) : null}

                  {t.role === "assistant" && (
                    <PhaseTimer
                      live={Boolean(t.pending) && i === turns.length - 1 && busy}
                      startedAt={t.startedAt}
                      thinkMs={t.thinkMs}
                      answerMs={t.answerMs}
                      writing={Boolean(t.content)}
                    />
                  )}
                  {t.role === "assistant" && showThinking && t.reasoning ? (
                    <details className="pgx-think" open={Boolean(t.pending) && !t.content}>
                      <summary>{t.pending && !t.content ? "Thinking…" : "Thought process"}</summary>
                      <div>{t.reasoning}</div>
                    </details>
                  ) : null}

                  {t.mediaUrl && (
                    <div className="pgx-media">
                      {t.mediaType === "image" && <img src={t.mediaUrl} alt="generated" />}
                      {t.mediaType === "video" && <video src={t.mediaUrl} controls />}
                      {t.mediaType === "audio" && <audio src={t.mediaUrl} controls autoPlay />}
                      <div className="pgx-media-foot">
                        <span>{t.mediaType === "audio" ? voice || "default voice" : `${mode === "video" ? "qwen-wan" : imageModel} · ${aspect}`}</span>
                        <a className="pgx-ghost" href={t.mediaUrl} download={mediaFilename(t.mediaType)}>
                          <DownloadSimple size={13} /> Download
                        </a>
                      </div>
                    </div>
                  )}

                  {t.content && t.role !== "tool" && <div className="pgx-text">{t.content}</div>}

                  {t.toolCalls?.map((tc) => (
                    <div key={tc.id} className="pgx-tool call">
                      <span className="pgx-tool-badge"><Wrench size={12} weight="bold" /> {tc.name}</span>
                      <code>{tc.arguments}</code>
                    </div>
                  ))}

                  {t.role === "tool" && (
                    <div className="pgx-tool result">
                      <span className="pgx-tool-badge">↩ {t.toolName}</span>
                      <code>{t.content}</code>
                    </div>
                  )}

                  {t.pending && typeof t.progress === "number" ? (
                    <div className="pgx-progress">
                      <div className="pgx-progress-bar"><span style={{ width: `${t.progress}%` }} /></div>
                      <span className="pgx-progress-pct">{t.progress}%</span>
                    </div>
                  ) : t.pending && !t.content && !t.reasoning ? (
                    <div className="pgx-dots"><i /><i /><i /></div>
                  ) : null}

                  {t.ms != null && !t.error && t.thinkMs == null && (
                    <div className="pgx-ms">{(t.ms / 1000).toFixed(2)}s</div>
                  )}
                </div>
              </div>
            ))
          )}
        </div>

        <div className="pgx-composer-wrap">
          <div className="pgx-composer">
            {attach.length > 0 && (
              <div className="pgx-attach-row">
                {attach.map((src, n) => (
                  <div key={n} className="pgx-attach-preview">
                    <img src={src} alt={`to send ${n + 1}`} />
                    <button
                      onClick={() => setAttach((a) => a.filter((_, k) => k !== n))}
                      aria-label={`Remove image ${n + 1}`}
                    >
                      <X size={11} weight="bold" />
                    </button>
                  </div>
                ))}
              </div>
            )}
            <textarea
              ref={taRef}
              className="pgx-textarea"
              placeholder={placeholder}
              value={input}
              rows={1}
              disabled={!authed}
              onChange={(e) => { setInput(e.target.value); autoGrow(); }}
              onKeyDown={onKeyDown}
            />
            <div className="pgx-composer-row">
              {maxAttach > 0 && (
                <label
                  className={`pgx-attach ${attach.length >= maxAttach ? "full" : ""}`}
                  title={
                    mode === "video"
                      ? ""
                      : mode === "image"
                      ? `Reference images to edit (up to ${maxAttach})`
                      : "Attach an image"
                  }
                >
                  <Paperclip size={17} />
                  <input
                    type="file"
                    accept="image/*"
                    multiple={maxAttach > 1}
                    hidden
                    onChange={onImage}
                    disabled={!authed || attach.length >= maxAttach}
                  />
                </label>
              )}
              <span className="pgx-hint">
                {mode === "chat"
                  ? "Enter to send"
                  : mode === "image"
                  ? attach.length
                    ? `Edits ${attach.length} image${attach.length > 1 ? "s" : ""}`
                    : "Generates an image"
                  : `Generates ${mode === "tts" ? "speech" : mode}`}
              </span>
              <div style={{ flex: 1 }} />
              {busy ? (
                <button className="pgx-send stop" onClick={stop} aria-label="Stop"><Stop size={14} weight="fill" /></button>
              ) : (
                <button className="pgx-send" onClick={send} disabled={!canSend} aria-label="Send"><ArrowUp size={17} weight="bold" /></button>
              )}
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}

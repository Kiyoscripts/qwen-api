"use client";

import { useEffect, useRef, useState } from "react";
import { Plus, Trash, ArrowUp, Stop, ChatText, SpeakerHigh, Wrench, Spinner, Paperclip, X, CaretRight } from "@phosphor-icons/react";
import { useT } from "./I18n";
import { ModelPicker, acceptFor, toPickModel, type PickModel } from "./ModelPicker";
import { EffortPicker } from "./EffortPicker";
import { MediaAnswer } from "./MediaAnswer";

interface Msg {
  role: "user" | "assistant";
  content: string;
  /** Seconds spent reasoning, so a finished turn can say how long it thought. */
  thoughtFor?: number;
  /** The separate thinking channel, kept so it can be folded away rather than dropped. */
  reasoning?: string;
  /** Data URL of an attachment, kept with the turn so it survives a reload. */
  file?: string;
  fileName?: string;
}
interface Thread { id: string; title: string; messages: Msg[]; at: number }

const STORE = "syde_threads";
const load = (): Thread[] => { try { return JSON.parse(localStorage.getItem(STORE) ?? "[]"); } catch { return []; } };
const save = (t: Thread[]) => localStorage.setItem(STORE, JSON.stringify(t.slice(0, 40)));
const titleOf = (s: string) => s.trim().split(/\s+/).slice(0, 6).join(" ").slice(0, 44) || "New chat";

/** Mirrors REQUIRE_THINKING on the server: these cannot run in Fast, so the
    switch is shown as unavailable rather than silently ignored. */
const ALWAYS_REASONS = new Set(["qwen3.8-max-preview"]);

const TOOL = [{ type: "function", function: { name: "get_weather", description: "Current conditions for a place.",
  parameters: { type: "object", properties: { location: { type: "string" } }, required: ["location"] } } }];

export function ChatApp() {
  const t = useT();
  const [threads, setThreads] = useState<Thread[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [models, setModels] = useState<PickModel[]>([]);
  const [model, setModel] = useState("qwen3.8-max");
  const [draft, setDraft] = useState("");
  const [streaming, setStreaming] = useState(false);
  const [tools, setTools] = useState(false);
  const [fast, setFast] = useState(false);
  /** Multi-level reasoning_effort when the model advertises levels. */
  const [effort, setEffort] = useState("low");
  const [openReasoning, setOpenReasoning] = useState<number | null>(null);
  const [speaking, setSpeaking] = useState<number | null>(null);
  const [file, setFile] = useState<{ url: string; name: string } | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const abort = useRef<AbortController | null>(null);
  const scroller = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const stored = load();
    setThreads(stored);
    setActiveId(stored[0]?.id ?? null);
    fetch("/v1/models").then((r) => (r.ok ? r.json() : { data: [] })).then((j) =>
      setModels((j.data ?? []).map(toPickModel)));
    return () => abort.current?.abort();
  }, []);

  const active = threads.find((x) => x.id === activeId) ?? null;
  const accept = acceptFor(models.find((m) => m.id === model));
  const picked = models.find((m) => m.id === model);
  const effortLevels = picked?.reasoningEffort ?? [];
  const hasEffort = effortLevels.length > 0;
  // Binary Fast/Think only when the model can reason but has no multi-level effort.
  const canPickThink = Boolean(picked?.thinking) && !ALWAYS_REASONS.has(model) && !hasEffort;

  useEffect(() => {
    scroller.current?.scrollTo({ top: scroller.current.scrollHeight, behavior: "smooth" });
  }, [active?.messages.length, streaming]);

  // Keep effort on a level the current model actually supports.
  useEffect(() => {
    if (!hasEffort) return;
    if (!effortLevels.includes(effort)) setEffort(effortLevels[0]);
  }, [model, hasEffort, effortLevels, effort]);

  const update = (id: string, fn: (t: Thread) => Thread) =>
    setThreads((prev) => { const next = prev.map((x) => (x.id === id ? fn(x) : x)); save(next); return next; });

  const send = async () => {
    const text = draft.trim();
    if (!text || streaming) return;

    let id = activeId;
    let thread = active;
    if (!thread) {
      id = crypto.randomUUID();
      thread = { id, title: titleOf(text), messages: [], at: Date.now() };
      setThreads((p) => { const n = [thread!, ...p]; save(n); return n; });
      setActiveId(id);
    }

    const withUser: Msg[] = [
      ...thread.messages,
      { role: "user", content: text, ...(file ? { file: file.url, fileName: file.name } : {}) },
    ];
    update(id!, (x) => ({ ...x, messages: [...withUser, { role: "assistant", content: "" }], at: Date.now() }));
    setDraft("");
    setFile(null);
    setStreaming(true);

    const ctrl = new AbortController();
    abort.current = ctrl;
    const picked = models.find((m) => m.id === model);
    const isMedia = picked ? !picked.chatTypes.includes("t2t") : false;
    const put = (content: string) => update(id!, (x) => {
      const m = [...x.messages]; m[m.length - 1] = { role: "assistant", content }; return { ...x, messages: m };
    });

    try {
      const r = await fetch("/v1/chat/completions", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model,
          // Multi-part content only where there is an attachment, so an ordinary
          // turn keeps the plain string form every client expects.
          messages: withUser.map((m) =>
            m.file
              ? { role: m.role, content: [
                  { type: "text", text: m.content },
                  { type: "image_url", image_url: { url: m.file } },
                ] }
              : { role: m.role, content: m.content }
          ),
          stream: !isMedia,
          ...(hasEffort ? { reasoning_effort: effort } : {}),
          ...(canPickThink ? { enable_thinking: !fast } : {}),
          ...(tools ? { tools: TOOL } : {}),
        }),
        signal: ctrl.signal,
      });

      if (!r.ok) { put(r.status === 401 ? t("chat_add_key_to_load") : `${t("error")} (${r.status})`); return; }

      if (isMedia) { put((await r.json()).choices?.[0]?.message?.content ?? ""); return; }

      const reader = r.body!.getReader();
      const dec = new TextDecoder();
      let buf = "", acc = "", think = "";
      const startedAt = Date.now();
      let thoughtFor: number | undefined;
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        let i: number;
        while ((i = buf.indexOf("\n")) !== -1) {
          const line = buf.slice(0, i).trim();
          buf = buf.slice(i + 1);
          if (!line.startsWith("data:")) continue;
          const p = line.slice(5).trim();
          if (!p || p === "[DONE]") continue;
          try {
            const d = JSON.parse(p)?.choices?.[0]?.delta;
            if (typeof d?.reasoning_content === "string" && d.reasoning_content) {
              think += d.reasoning_content;
              update(id!, (x) => { const m = [...x.messages];
                m[m.length - 1] = { role: "assistant", content: acc, reasoning: think };
                return { ...x, messages: m }; });
            }
            if (typeof d?.content === "string" && d.content) {
              // First visible token ends the thinking phase.
              if (think && thoughtFor === undefined) thoughtFor = Math.round((Date.now() - startedAt) / 1000);
              acc += d.content;
              update(id!, (x) => { const m = [...x.messages];
                m[m.length - 1] = { role: "assistant", content: acc, reasoning: think || undefined, thoughtFor };
                return { ...x, messages: m }; });
            }
          } catch { /* skip a bad frame */ }
        }
      }
    } catch (e: any) {
      if (e?.name !== "AbortError") put(t("error"));
    } finally { setStreaming(false); }
  };

  const readAloud = async (i: number, text: string) => {
    setSpeaking(i);
    try {
      const r = await fetch("/v1/audio/speech", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model: "qwen-tts", input: text, voice: "Cherry" }),
      });
      if (!r.ok) throw new Error();
      const audio = new Audio(URL.createObjectURL(await r.blob()));
      audio.onended = () => setSpeaking(null);
      await audio.play();
    } catch { setSpeaking(null); }
  };

  const remove = (id: string) => {
    setThreads((p) => { const n = p.filter((x) => x.id !== id); save(n); return n; });
    if (activeId === id) setActiveId(null);
  };

  return (
    <div className="field py-8">
      <div className="grid gap-5 lg:grid-cols-12">
        <aside className="lg:col-span-3">
          <button onClick={() => { setActiveId(null); setDraft(""); }} className="btn btn-ghost w-full">
            <Plus size={13} weight="bold" />{t("chat_new")}
          </button>
          <div className="mt-3 space-y-px">
            {threads.map((x) => (
              <div key={x.id}
                className={`group flex items-center gap-2 border px-3 py-2 transition-colors duration-150 ${
                  x.id === activeId ? "border-rule bg-[var(--paper-2)]" : "border-transparent hover:bg-[var(--paper-2)]"}`}
                style={{ borderRadius: "var(--r-sm)" }}>
                <button onClick={() => setActiveId(x.id)} className="min-w-0 flex-1 truncate text-left text-[13px] text-ink">
                  {x.title}
                </button>
                <button onClick={() => remove(x.id)} aria-label={t("chat_delete_chat")}
                  className="shrink-0 text-ink-3 opacity-0 transition-opacity duration-150 group-hover:opacity-100 hover:text-signal">
                  <Trash size={13} weight="bold" />
                </button>
              </div>
            ))}
          </div>
        </aside>

        <section className="lg:col-span-9">
          <div className="flex h-[calc(100dvh-9rem)] min-h-[420px] flex-col border border-rule"
               style={{ borderRadius: "var(--r-sm)" }}>
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-rule px-3 py-2.5">
              <div className="w-full max-w-[320px]">
                <ModelPicker models={models} value={model} onChange={setModel} />
              </div>
              {hasEffort ? (
                <EffortPicker
                  levels={effortLevels}
                  value={effort}
                  onChange={setEffort}
                  label={t("chat_effort")}
                />
              ) : (
                <div className="flex shrink-0 items-center gap-1" role="group"
                     aria-label={t("chat_reasoning")}
                     title={canPickThink ? t("chat_reason_hint") : t("pg_always_reasons")}>
                  {([[false, t("chat_think")], [true, t("chat_fast")]] as const).map(([v, label]) => (
                    <button key={String(v)} onClick={() => setFast(v)} disabled={!canPickThink}
                      aria-pressed={canPickThink ? fast === v : v === false}
                      className={`border px-2.5 py-1.5 font-mono text-[11px] transition-colors duration-200
                        disabled:opacity-40 ${
                          (canPickThink ? fast === v : v === false)
                            ? "border-signal text-signal"
                            : "border-rule text-ink-3 hover:border-ink hover:text-ink"}`}
                      style={{ borderRadius: "var(--r-sm)" }}>
                      {label}
                    </button>
                  ))}
                </div>
              )}

              <button onClick={() => setTools((v) => !v)} aria-pressed={tools} title={t("chat_tools_hint")}
                className={`flex shrink-0 items-center gap-1.5 border px-2.5 py-1.5 font-mono text-[11px]
                  transition-colors duration-200 ${tools ? "border-signal text-signal"
                    : "border-rule text-ink-3 hover:border-ink hover:text-ink"}`}
                style={{ borderRadius: "var(--r-sm)" }}>
                <Wrench size={12} weight="bold" />{t("chat_tools")}
              </button>
            </div>

            <div ref={scroller} className="flex-1 overflow-y-auto px-4 py-5">
              {!active || active.messages.length === 0 ? (
                <div className="flex h-full flex-col items-center justify-center gap-3 text-center">
                  <ChatText size={22} className="text-ink-3" />
                  <p className="h3 text-ink">{t("chat_empty_title")}</p>
                  <p className="body max-w-[38ch] text-[13px]">{t("chat_empty_sub")}</p>
                </div>
              ) : (
                <div className="mx-auto max-w-[64ch] space-y-5">
                  {active.messages.map((m, i) => (
                    <div key={i} className={m.role === "user" ? "flex justify-end" : ""}>
                      {m.role === "user" ? (
                        <div className="max-w-[85%]">
                          {m.file && (
                            <img src={m.file} alt={m.fileName ?? ""}
                                 className="mb-1.5 max-h-48 w-auto border border-rule"
                                 style={{ borderRadius: "var(--r-sm)" }} />
                          )}
                          <p className="bg-ink px-3.5 py-2.5 text-[13.5px] leading-relaxed text-[var(--paper)]"
                             style={{ borderRadius: "var(--r-sm)" }}>{m.content}</p>
                        </div>
                      ) : (
                        <div>
                          {m.reasoning && (
                            <div className="mb-2">
                              {streaming && i === active.messages.length - 1 && !m.content ? (
                                /* Nothing has been written yet, so the reasoning is
                                   the only sign of life. Shown live rather than
                                   folded away, because a silent pause reads as a
                                   stalled request. */
                                <div>
                                  <p className="flex items-center gap-1.5 font-mono text-[11px] text-signal">
                                    <Spinner size={11} weight="bold" className="animate-spin" />
                                    {t("chat_reasoning")}
                                  </p>
                                  <p className="mt-1.5 max-h-24 overflow-hidden border-l border-rule pl-3
                                                whitespace-pre-wrap text-[12.5px] leading-relaxed text-ink-3">
                                    {m.reasoning.slice(-400)}
                                  </p>
                                </div>
                              ) : (
                              <>
                              <button onClick={() => setOpenReasoning(openReasoning === i ? null : i)}
                                className="flex items-center gap-1.5 font-mono text-[11px] text-ink-3
                                           transition-colors duration-200 hover:text-ink">
                                <CaretRight size={11} weight="bold"
                                  className={`transition-transform duration-200 ${openReasoning === i ? "rotate-90" : ""}`} />
                                {m.thoughtFor !== undefined
                                  ? t("chat_thought_for", { seconds: m.thoughtFor })
                                  : t("chat_reasoning")}
                              </button>
                              {openReasoning === i && (
                                <p className="mt-1.5 border-l border-rule pl-3 whitespace-pre-wrap
                                              text-[12.5px] leading-relaxed text-ink-3">
                                  {m.reasoning}
                                </p>
                              )}
                              </>
                              )}
                            </div>
                          )}
                          {/* A media model replies with markdown, so the same
                              renderer handles both cases: text stays text, and
                              an image or video becomes one. */}
                          {m.content.includes("![") ? (
                            <MediaAnswer text={m.content}
                              className="whitespace-pre-wrap text-[13.5px] leading-relaxed text-ink" />
                          ) : (
                            <p className="whitespace-pre-wrap text-[13.5px] leading-relaxed text-ink">
                              {m.content}
                              {streaming && i === active.messages.length - 1 && (
                                <span className="ml-px inline-block h-[1.05em] w-[7px] translate-y-[2px] bg-signal align-baseline animate-pulse" />
                              )}
                            </p>
                          )}
                          {m.content && !(streaming && i === active.messages.length - 1) && (
                            <button onClick={() => readAloud(i, m.content)} disabled={speaking !== null}
                              className="mt-2 flex items-center gap-1.5 font-mono text-[11px] text-ink-3
                                         transition-colors duration-200 hover:text-signal disabled:opacity-40">
                              {speaking === i ? <Spinner size={12} weight="bold" className="animate-spin" />
                                              : <SpeakerHigh size={12} weight="bold" />}
                              {t("chat_read_aloud")}
                            </button>
                          )}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>

            {file && (
              <div className="flex items-center gap-2 border-t border-rule px-3 py-2">
                <img src={file.url} alt="" className="size-9 border border-rule object-cover"
                     style={{ borderRadius: "var(--r-sm)" }} />
                <span className="min-w-0 flex-1 truncate font-mono text-[11.5px] text-ink-3">{file.name}</span>
                <button onClick={() => setFile(null)} aria-label={t("chat_remove_image")}
                        className="text-ink-3 transition-colors duration-200 hover:text-signal">
                  <X size={13} weight="bold" />
                </button>
              </div>
            )}

            <form onSubmit={(e) => { e.preventDefault(); send(); }}
                  className="flex items-end gap-2 border-t border-rule px-3 py-2.5">
              <input ref={fileInput} type="file" hidden accept={accept}
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (!f) return;
                  const r = new FileReader();
                  r.onload = () => setFile({ url: String(r.result), name: f.name });
                  r.readAsDataURL(f);
                  e.target.value = "";
                }} />
              <button type="button" onClick={() => fileInput.current?.click()} disabled={!accept}
                aria-label={accept ? t("chat_attach") : t("chat_attach_unsupported", { model })}
                title={accept ? t("chat_attach") : t("chat_attach_unsupported", { model })}
                className="grid size-9 shrink-0 place-items-center border border-rule text-ink-3
                           transition-colors duration-200 hover:border-ink hover:text-ink
                           disabled:opacity-30">
                <Paperclip size={14} weight="bold" />
              </button>
              <label htmlFor="draft" className="sr-only">{t("chat_send_message")}</label>
              <textarea id="draft" value={draft} rows={1} onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } }}
                placeholder={t("chat_placeholder")}
                className="max-h-32 min-h-[38px] w-full resize-none bg-transparent py-2 text-[13.5px]
                           text-ink outline-none placeholder:text-ink-3" />
              {streaming ? (
                <button type="button" onClick={() => abort.current?.abort()} aria-label={t("chat_stop_generating")}
                  className="grid size-9 shrink-0 place-items-center border border-rule text-ink"
                  style={{ borderRadius: "var(--r-sm)" }}>
                  <Stop size={13} weight="fill" />
                </button>
              ) : (
                <button type="submit" disabled={!draft.trim()} aria-label={t("chat_send")}
                  className="grid size-9 shrink-0 place-items-center bg-ink text-[var(--paper)]
                             transition-opacity duration-200 disabled:opacity-30"
                  style={{ borderRadius: "var(--r-sm)" }}>
                  <ArrowUp size={14} weight="bold" />
                </button>
              )}
            </form>
          </div>
        </section>
      </div>
    </div>
  );
}

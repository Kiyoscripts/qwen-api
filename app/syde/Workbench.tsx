"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Play, Stop, CaretRight, MagnifyingGlass, Paperclip, X, Trash } from "@phosphor-icons/react";
import { useT } from "../I18n";
import { ModelPicker, acceptFor, toPickModel, type PickModel } from "./ModelPicker";

type Mode = "chat" | "image" | "video" | "speech";

/**
 * One exchange in the playground.
 *
 * Held in component state only. A playground is for trying things, so the
 * transcript is deliberately not persisted: reloading gives a clean slate, and
 * nothing about an experiment survives to confuse the next one.
 */
interface Turn { role: "user" | "assistant"; content: string; reasoning?: string; file?: string }
interface Voice { speaker: string; name: string; gender?: string; description?: string; kind?: string }

/**
 * The playground.
 *
 * Product surface, so it is dense and quiet: the only thing that moves is the
 * reply arriving. Every control maps to a real request field, and the body
 * preview shows exactly what would be sent, which is the part that makes a
 * playground worth using rather than a second chat box.
 */
export function Workbench() {
  const t = useT();
  const [models, setModels] = useState<PickModel[]>([]);
  const [voices, setVoices] = useState<Voice[]>([]);
  const [mode, setMode] = useState<Mode>("chat");
  const [model, setModel] = useState("qwen3.8-max");
  const [system, setSystem] = useState("");
  const [prompt, setPrompt] = useState("");
  const [temperature, setTemperature] = useState(0.7);
  const [maxTokens, setMaxTokens] = useState(1024);
  const [thinking, setThinking] = useState(true);
  const [tools, setTools] = useState(false);
  const [size, setSize] = useState("16:9");
  const [voice, setVoice] = useState("Cherry");
  const [vq, setVq] = useState("");
  const [showBody, setShowBody] = useState(false);
  const [file, setFile] = useState<{ url: string; name: string } | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  const [reasoning, setReasoning] = useState("");
  const [answer, setAnswer] = useState("");
  const [turns, setTurns] = useState<Turn[]>([]);
  const [state, setState] = useState<"idle" | "running" | "done" | "error">("idle");
  const [ms, setMs] = useState<number | null>(null);
  const abort = useRef<AbortController | null>(null);

  useEffect(() => {
    fetch("/v1/models").then((r) => (r.ok ? r.json() : { data: [] })).then((j) => {
      setModels((j.data ?? []).map(toPickModel));
    });
    fetch("/v1/audio/voices").then((r) => (r.ok ? r.json() : { data: [] })).then((j) => setVoices(j.data ?? []));
    return () => abort.current?.abort();
  }, []);

  const needs = (m: PickModel) =>
    mode === "image" ? m.chatTypes.includes("t2i")
      : mode === "video" ? m.chatTypes.includes("t2v")
      : m.chatTypes.includes("t2t");

  useEffect(() => { setTurns([]); setAnswer(""); setReasoning(""); }, [mode]);

  useEffect(() => {
    if (!models.length) return;
    const cur = models.find((m) => m.id === model);
    if (cur && needs(cur)) return;
    const first = models.find(needs);
    if (first) setModel(first.id);
  }, [mode, models]); // eslint-disable-line react-hooks/exhaustive-deps

  const canThink = models.find((m) => m.id === model)?.thinking ?? false;
  const accept = acceptFor(models.find((m) => m.id === model));

  const body = useMemo(() => {
    if (mode === "image" || mode === "video") return { model, messages: [{ role: "user", content: prompt }], size };
    if (mode === "speech") return { model: "qwen-tts", input: prompt, voice };
    return {
      model,
      messages: [
        ...(system ? [{ role: "system", content: system }] : []),
        ...turns.map((x) =>
          x.file
            ? { role: x.role, content: [
                { type: "text", text: x.content },
                { type: "image_url", image_url: { url: x.file } },
              ] }
            : { role: x.role, content: x.content }
        ),
        ...(prompt || file
          ? [file
              ? { role: "user", content: [
                  { type: "text", text: prompt },
                  { type: "image_url", image_url: { url: file.url } },
                ] }
              : { role: "user", content: prompt }]
          : []),
      ],
      stream: true, temperature, max_tokens: maxTokens,
      ...(canThink && !thinking ? { enable_thinking: false } : {}),
      ...(tools ? { tools: [{ type: "function", function: { name: "get_weather",
        description: "Current conditions for a place.",
        parameters: { type: "object", properties: { location: { type: "string" } }, required: ["location"] } } }] } : {}),
    };
  }, [mode, model, prompt, system, size, temperature, maxTokens, thinking, canThink, tools, voice, file, turns]);

  const run = async () => {
    if (!prompt.trim() || state === "running") return;
    abort.current?.abort();
    const ctrl = new AbortController();
    abort.current = ctrl;
    setReasoning(""); setAnswer(""); setState("running"); setMs(null);
    const started = performance.now();

    try {
      if (mode === "speech") {
        const r = await fetch("/v1/audio/speech", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body), signal: ctrl.signal,
        });
        if (!r.ok) throw new Error(String(r.status));
        const url = URL.createObjectURL(await r.blob());
        new Audio(url).play().catch(() => {});
        setAnswer(t("pg_synthesising"));
        setState("done"); setMs(Math.round(performance.now() - started));
        return;
      }

      // The exchange so far, plus this prompt. Recorded before the request so
      // the transcript shows the question while the answer is still arriving.
      const sent: Turn[] = [
        ...turns,
        { role: "user", content: prompt, ...(file ? { file: file.url } : {}) },
      ];
      if (mode === "chat") {
        setTurns([...sent, { role: "assistant", content: "" }]);
        setPrompt("");
        setFile(null);
      }

      const r = await fetch("/v1/chat/completions", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify(mode === "chat" ? body : { ...body, stream: false }),
        signal: ctrl.signal,
      });
      if (!r.ok) {
        const msg = r.status === 401 ? t("pg_get_key") : `${t("error")} (${r.status})`;
        if (mode === "chat") setTurns([...sent, { role: "assistant", content: msg }]);
        else setAnswer(msg);
        setState("error");
        return;
      }

      if (mode !== "chat") {
        const j = await r.json();
        setAnswer(j.choices?.[0]?.message?.content ?? "");
        setState("done"); setMs(Math.round(performance.now() - started));
        return;
      }

      const reader = r.body!.getReader();
      const dec = new TextDecoder();
      let buf = "", acc = "", think = "";
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        let i: number;
        while ((i = buf.indexOf("\n")) !== -1) {
          const line = buf.slice(0, i).trim();
          buf = buf.slice(i + 1);
          if (!line.startsWith("data:")) continue;
          const pl = line.slice(5).trim();
          if (!pl || pl === "[DONE]") continue;
          try {
            const d = JSON.parse(pl)?.choices?.[0]?.delta;
            if (typeof d?.reasoning_content === "string") think += d.reasoning_content;
            if (typeof d?.content === "string") acc += d.content;
            setTurns([...sent, { role: "assistant", content: acc, reasoning: think || undefined }]);
          } catch { /* skip a bad frame */ }
        }
      }
      setState("done"); setMs(Math.round(performance.now() - started));
    } catch (e: any) {
      if (e?.name !== "AbortError") { setAnswer(t("error")); setState("error"); }
    }
  };

  const shownVoices = voices.filter((v) => {
    const q = vq.trim().toLowerCase();
    return !q || v.name.toLowerCase().includes(q) || (v.description ?? "").toLowerCase().includes(q);
  });

  return (
    <div className="field py-12 md:py-16">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="h2 text-ink">{t("pg_title")}</h1>
          <p className="body mt-3 text-[14px]">{t("pg_equivalent_request")}</p>
        </div>
        <div className="flex gap-1" role="tablist" aria-label={t("pg_mode")}>
          {(["chat", "image", "video", "speech"] as const).map((m) => (
            <button key={m} role="tab" aria-selected={mode === m} onClick={() => setMode(m)}
              className={`h-9 border px-3 font-mono text-[12px] capitalize transition-colors duration-200 ${
                mode === m ? "border-ink bg-ink text-[var(--paper)]"
                           : "border-rule text-ink-2 hover:border-ink hover:text-ink"}`}
              style={{ borderRadius: "var(--r-sm)" }}>
              {m}
            </button>
          ))}
        </div>
      </div>

      <div className="mt-8 grid gap-5 lg:grid-cols-12">
        <div className="space-y-5 lg:col-span-4">
          {mode === "speech" ? (
            <Field label={t("pg_voice")}>
              <div className="flex h-9 items-center gap-2 border border-rule px-2.5" style={{ borderRadius: "var(--r-sm)" }}>
                <MagnifyingGlass size={13} weight="bold" className="shrink-0 text-ink-3" />
                <input value={vq} onChange={(e) => setVq(e.target.value)} aria-label="Search voices"
                  placeholder={`Search ${voices.length} voices`}
                  className="w-full bg-transparent font-mono text-[12px] text-ink outline-none placeholder:text-ink-3" />
              </div>
              <div className="mt-2 max-h-[280px] overflow-y-auto border border-rule" style={{ borderRadius: "var(--r-sm)" }}>
                {shownVoices.map((v, i) => (
                  <button key={v.speaker} onClick={() => setVoice(v.speaker)} aria-pressed={voice === v.speaker}
                    className={`flex w-full items-start gap-3 px-3 py-2.5 text-left transition-colors duration-150
                      hover:bg-[var(--paper-2)] ${i > 0 ? "border-t border-rule" : ""} ${
                      voice === v.speaker ? "bg-[var(--signal-wash)]" : ""}`}>
                    <span className="min-w-0 flex-1">
                      <span className={`block text-[13px] ${voice === v.speaker ? "text-signal" : "text-ink"}`}>{v.name}</span>
                      {v.description && <span className="mt-0.5 block text-[12px] leading-snug text-ink-3">{v.description}</span>}
                    </span>
                    {v.kind && <span className="shrink-0 font-mono text-[10px] text-ink-3">{v.kind}</span>}
                  </button>
                ))}
              </div>
            </Field>
          ) : (
            <Field label={t("pg_model")}>
              <ModelPicker models={models} value={model} onChange={setModel} filter={needs} />
            </Field>
          )}

          {mode === "chat" && (
            <>
              <Field label={t("pg_system")}>
                <textarea value={system} onChange={(e) => setSystem(e.target.value)} rows={3}
                  className="w-full resize-y border border-rule bg-transparent px-3 py-2 font-mono text-[12.5px]
                             leading-relaxed text-ink outline-none focus:border-signal"
                  style={{ borderRadius: "var(--r-sm)" }} />
              </Field>
              <Field label={t("pg_temperature")} value={temperature.toFixed(2)}>
                <input type="range" min={0} max={2} step={0.05} value={temperature}
                  onChange={(e) => setTemperature(Number(e.target.value))} className="w-full accent-[var(--signal)]" />
              </Field>
              <Field label={t("pg_max_tokens")} value={String(maxTokens)}>
                <input type="range" min={128} max={8192} step={128} value={maxTokens}
                  onChange={(e) => setMaxTokens(Number(e.target.value))} className="w-full accent-[var(--signal)]" />
              </Field>
              <Toggle label={t("pg_send_tool_schemas")} on={tools} onChange={setTools} />
              <Toggle label={t("chat_reasoning")} on={canThink && thinking} onChange={setThinking} disabled={!canThink}
                      hint={!canThink ? t("pg_always_reasons") : undefined} />
            </>
          )}

          {(mode === "image" || mode === "video") && (
            <Field label={t("pg_aspect_ratio")}>
              <div className="flex flex-wrap gap-1.5">
                {["1:1", "16:9", "9:16", "4:3", "3:4"].map((s) => (
                  <button key={s} onClick={() => setSize(s)} aria-pressed={size === s}
                    className={`h-9 border px-3 font-mono text-[12px] transition-colors duration-200 ${
                      size === s ? "border-signal text-signal" : "border-rule text-ink-2 hover:border-ink hover:text-ink"}`}
                    style={{ borderRadius: "var(--r-sm)" }}>{s}</button>
                ))}
              </div>
            </Field>
          )}
        </div>

        <div className="space-y-5 lg:col-span-8">
          <div className="border border-rule" style={{ borderRadius: "var(--r-sm)" }}>
            <label htmlFor="pg-prompt" className="sr-only">{t("chat_placeholder")}</label>
            <textarea id="pg-prompt" value={prompt} onChange={(e) => setPrompt(e.target.value)} rows={3}
              onKeyDown={(e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) run(); }}
              placeholder={t("chat_placeholder")}
              className="w-full resize-y bg-transparent px-4 py-3 font-mono text-[13px] leading-relaxed
                         text-ink outline-none placeholder:text-ink-3" />
            <div className="flex items-center justify-between gap-3 border-t border-rule px-3 py-2.5">
              <div className="flex items-center gap-3">
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
                aria-label={t("chat_attach")} title={accept || t("chat_attach_unsupported", { model })}
                className="flex items-center gap-1.5 font-mono text-[11.5px] text-ink-3
                           transition-colors duration-200 hover:text-ink disabled:opacity-30">
                <Paperclip size={12} weight="bold" />
                {file ? file.name.slice(0, 18) : t("chat_attach")}
              </button>
              {file && (
                <button onClick={() => setFile(null)} aria-label={t("chat_remove_image")}
                        className="text-ink-3 transition-colors duration-200 hover:text-signal">
                  <X size={12} weight="bold" />
                </button>
              )}
              <button onClick={() => setShowBody((v) => !v)}
                className="flex items-center gap-1.5 font-mono text-[11.5px] text-ink-3 transition-colors duration-200 hover:text-ink">
                <CaretRight size={12} weight="bold" className={`transition-transform duration-200 ${showBody ? "rotate-90" : ""}`} />
                {t("pg_request")}
              </button>
              </div>
              <div className="flex items-center gap-2">
                {ms !== null && <span className="num text-[11.5px] text-ink-3">{ms} ms</span>}
                {state === "running" ? (
                  <button onClick={() => { abort.current?.abort(); setState("done"); }} className="btn btn-ghost h-9 px-4">
                    <Stop size={13} weight="fill" />{t("pg_stop")}
                  </button>
                ) : (
                  <button onClick={run} disabled={!prompt.trim()} className="btn btn-primary h-9 px-4 disabled:opacity-40">
                    <Play size={13} weight="fill" />{t("pg_run")}
                  </button>
                )}
              </div>
            </div>
            {showBody && (
              <pre className="overflow-x-auto border-t border-rule bg-[var(--paper-2)] px-4 py-3">
                <code className="font-mono text-[11.5px] leading-relaxed text-ink-2">{JSON.stringify(body, null, 2)}</code>
              </pre>
            )}
          </div>

          <div className="border border-rule" style={{ borderRadius: "var(--r-sm)" }}>
            <div className="flex items-center justify-between border-b border-rule px-4 py-2.5">
              <span className="font-mono text-[11px] tracking-wide text-ink-3 uppercase">
                {t("pg_response")}
              </span>
              {mode === "chat" && turns.length > 0 && (
                <button
                  onClick={() => { setTurns([]); setAnswer(""); setReasoning(""); setMs(null); setState("idle"); }}
                  className="flex items-center gap-1.5 font-mono text-[11.5px] text-ink-3
                             transition-colors duration-200 hover:text-signal"
                >
                  <Trash size={12} weight="bold" />
                  {t("pg_clear")}
                </button>
              )}
            </div>

            {mode === "chat" ? (
              turns.length === 0 ? (
                <p className="body px-4 py-6 text-[13px]">{t("chat_empty_sub")}</p>
              ) : (
                <div className="max-h-[520px] space-y-4 overflow-y-auto px-4 py-4">
                  {turns.map((turn, i) => (
                    <div key={i}>
                      {/* Role is named rather than styled into a bubble: this is a
                          transcript of a request, not a chat window. */}
                      <p className="font-mono text-[10.5px] tracking-wide text-ink-3 uppercase">
                        {turn.role}
                      </p>
                      {turn.file && (
                        <img src={turn.file} alt="" className="mt-1.5 max-h-32 w-auto border border-rule"
                             style={{ borderRadius: "var(--r-sm)" }} />
                      )}
                      {turn.reasoning && (
                        <p className="mt-1.5 border-l border-rule pl-3 whitespace-pre-wrap font-mono
                                      text-[12px] leading-relaxed text-ink-3">
                          {turn.reasoning}
                        </p>
                      )}
                      <p className="mt-1 whitespace-pre-wrap font-mono text-[13px] leading-relaxed text-ink">
                        {turn.content}
                        {state === "running" && i === turns.length - 1 && (
                          <span className="ml-px inline-block h-[1.05em] w-[7px] translate-y-[2px]
                                           bg-signal align-baseline animate-pulse" />
                        )}
                      </p>
                    </div>
                  ))}
                </div>
              )
            ) : (
              <div className="px-4 py-4">
                {answer ? (
                  <p className="whitespace-pre-wrap font-mono text-[13px] leading-relaxed text-ink">{answer}</p>
                ) : (
                  <p className="body text-[13px]">{t("pg_response")}</p>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function Field({ label, value, children }: { label: string; value?: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="mb-2 flex items-baseline justify-between gap-3">
        <span className="font-mono text-[11px] tracking-wide text-ink-3 uppercase">{label}</span>
        {value && <span className="num text-[12px] text-ink-2">{value}</span>}
      </div>
      {children}
    </div>
  );
}

function Toggle({ label, on, onChange, disabled, hint }: {
  label: string; on: boolean; onChange: (v: boolean) => void; disabled?: boolean; hint?: string;
}) {
  return (
    <label className={`flex items-center justify-between gap-3 border border-rule px-3 py-2.5 ${
      disabled ? "opacity-45" : "cursor-pointer"}`} style={{ borderRadius: "var(--r-sm)" }}>
      <span className="text-[13px] text-ink">
        {label}
        {hint && <span className="mt-0.5 block text-[12px] text-ink-3">{hint}</span>}
      </span>
      <input type="checkbox" disabled={disabled} checked={on} onChange={(e) => onChange(e.target.checked)}
             className="size-4 accent-[var(--signal)]" />
    </label>
  );
}

import { useEffect, useMemo, useRef, useState } from "react";
import { Play, Stop, ArrowsClockwise, CaretRight } from "@phosphor-icons/react";
import { listModels, streamChat, LIVE, type Model } from "../lib/api";
import { ModelPicker } from "../components/ModelPicker";
import { Reveal } from "../components/Reveal";

type Mode = "chat" | "image" | "video" | "speech";

const MODES: { id: Mode; label: string; needs: (m: Model) => boolean }[] = [
  { id: "chat", label: "Chat", needs: (m) => m.capabilities.chat_types.includes("t2t") },
  { id: "image", label: "Image", needs: (m) => m.capabilities.chat_types.includes("t2i") },
  { id: "video", label: "Video", needs: (m) => m.capabilities.chat_types.includes("t2v") },
  { id: "speech", label: "Speech", needs: (m) => m.capabilities.chat_types.includes("t2t") },
];

/**
 * A workbench, not a chat box.
 *
 * Product surface rather than marketing, so it is dense, quiet and carries no
 * scroll motion: the only thing that moves is the reply arriving. Every control
 * maps to a real request field, and the request preview shows exactly what the
 * body would be, which is the part that makes a playground worth using.
 */
export function Playground() {
  const [models, setModels] = useState<Model[]>([]);
  const [mode, setMode] = useState<Mode>("chat");
  const [model, setModel] = useState("qwen3.8-max");
  const [system, setSystem] = useState("");
  const [prompt, setPrompt] = useState("How do I stream a reply?");
  const [temperature, setTemperature] = useState(0.7);
  const [maxTokens, setMaxTokens] = useState(1024);
  const [thinking, setThinking] = useState(true);
  const [size, setSize] = useState("16:9");
  const [showBody, setShowBody] = useState(false);

  const [reasoning, setReasoning] = useState("");
  const [answer, setAnswer] = useState("");
  const [state, setState] = useState<"idle" | "running" | "done" | "error">("idle");
  const [ms, setMs] = useState<number | null>(null);
  const abort = useRef<AbortController | null>(null);

  useEffect(() => {
    listModels().then(setModels);
    return () => abort.current?.abort();
  }, []);

  const current = models.find((m) => m.id === model);
  const canThink = current?.capabilities.thinking ?? false;
  const modeFilter = useMemo(() => MODES.find((x) => x.id === mode)!.needs, [mode]);

  // Switching mode must not leave a model selected that cannot serve it.
  useEffect(() => {
    if (!models.length) return;
    if (current && modeFilter(current)) return;
    const first = models.find(modeFilter);
    if (first) setModel(first.id);
  }, [mode, models]); // eslint-disable-line react-hooks/exhaustive-deps

  const body = useMemo(() => {
    if (mode === "image" || mode === "video")
      return { model, prompt, size, ...(mode === "image" ? { n: 1 } : {}) };
    if (mode === "speech") return { model, input: prompt, voice: "cherry" };
    return {
      model,
      messages: [
        ...(system ? [{ role: "system", content: system }] : []),
        { role: "user", content: prompt },
      ],
      stream: true,
      temperature,
      max_tokens: maxTokens,
      ...(canThink && !thinking ? { enable_thinking: false } : {}),
    };
  }, [mode, model, prompt, system, size, temperature, maxTokens, thinking, canThink]);

  const run = async () => {
    if (!prompt.trim() || state === "running") return;
    abort.current?.abort();
    const ctrl = new AbortController();
    abort.current = ctrl;
    setReasoning("");
    setAnswer("");
    setState("running");
    setMs(null);
    const started = performance.now();

    try {
      const stream = streamChat(
        {
          model,
          system: system || undefined,
          messages: [{ role: "user", content: prompt }],
          temperature,
          maxTokens,
          thinking: canThink ? thinking : false,
        },
        ctrl.signal
      );
      for await (const d of stream) {
        if (ctrl.signal.aborted) return;
        if (d.channel === "reasoning") setReasoning((p) => p + d.text);
        else setAnswer((p) => p + d.text);
      }
      setMs(Math.round(performance.now() - started));
      setState("done");
    } catch {
      setState("error");
    }
  };

  const stop = () => {
    abort.current?.abort();
    setState("done");
  };

  return (
    <div className="field py-12 md:py-16">
      <Reveal>
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="h2 text-ink">Playground</h1>
            <p className="body mt-3 text-[14px]">
              Every control here is a field on the request. The body below is the
              exact JSON that would be sent.
            </p>
          </div>
          <div className="flex gap-1" role="tablist" aria-label="Mode">
            {MODES.map((m) => (
              <button
                key={m.id}
                role="tab"
                aria-selected={mode === m.id}
                onClick={() => setMode(m.id)}
                className={`h-9 border px-3 font-mono text-[12px] transition-colors duration-200 ${
                  mode === m.id
                    ? "border-ink bg-ink text-[var(--paper)]"
                    : "border-rule text-ink-2 hover:border-ink hover:text-ink"
                }`}
                style={{ borderRadius: "var(--r-sm)" }}
              >
                {m.label}
              </button>
            ))}
          </div>
        </div>
      </Reveal>

      {!LIVE && (
        <div
          className="mt-6 border border-[var(--signal)] bg-[var(--signal-wash)] px-4 py-3"
          style={{ borderRadius: "var(--r-sm)" }}
        >
          <p className="font-mono text-[12px] leading-relaxed text-signal">
            Placeholder backend. Replies are canned and nothing leaves the
            browser. Set LIVE in src/lib/api.ts to point this at the endpoint.
          </p>
        </div>
      )}

      <div className="mt-8 grid gap-5 lg:grid-cols-12">
        {/* Controls */}
        <div className="space-y-5 lg:col-span-4">
          <Field label="Model">
            <ModelPicker models={models} value={model} onChange={setModel} filter={modeFilter} />
          </Field>

          {mode === "chat" && (
            <Field label="System prompt" hint="Optional. Sent as the first message.">
              <textarea
                value={system}
                onChange={(e) => setSystem(e.target.value)}
                rows={3}
                placeholder="You are a terse assistant."
                className="w-full resize-y border border-rule bg-transparent px-3 py-2 font-mono
                           text-[12.5px] leading-relaxed text-ink outline-none
                           placeholder:text-ink-3 focus:border-signal"
                style={{ borderRadius: "var(--r-sm)" }}
              />
            </Field>
          )}

          {(mode === "image" || mode === "video") && (
            <Field label="Aspect ratio">
              <div className="flex flex-wrap gap-1.5">
                {["1:1", "16:9", "9:16", "4:3", "3:4"].map((s) => (
                  <button
                    key={s}
                    onClick={() => setSize(s)}
                    aria-pressed={size === s}
                    className={`h-9 border px-3 font-mono text-[12px] transition-colors duration-200 ${
                      size === s
                        ? "border-signal text-signal"
                        : "border-rule text-ink-2 hover:border-ink hover:text-ink"
                    }`}
                    style={{ borderRadius: "var(--r-sm)" }}
                  >
                    {s}
                  </button>
                ))}
              </div>
            </Field>
          )}

          {mode === "chat" && (
            <>
              <Field label="Temperature" value={temperature.toFixed(2)}>
                <input
                  type="range"
                  min={0}
                  max={2}
                  step={0.05}
                  value={temperature}
                  onChange={(e) => setTemperature(Number(e.target.value))}
                  className="w-full accent-[var(--signal)]"
                />
              </Field>

              <Field label="Max tokens" value={String(maxTokens)}>
                <input
                  type="range"
                  min={128}
                  max={8192}
                  step={128}
                  value={maxTokens}
                  onChange={(e) => setMaxTokens(Number(e.target.value))}
                  className="w-full accent-[var(--signal)]"
                />
              </Field>

              <label
                className={`flex items-center justify-between border border-rule px-3 py-2.5 ${
                  canThink ? "cursor-pointer" : "opacity-45"
                }`}
                style={{ borderRadius: "var(--r-sm)" }}
              >
                <span className="text-[13px] text-ink">
                  Reasoning
                  {!canThink && (
                    <span className="ml-2 font-mono text-[11px] text-ink-3">
                      not on this model
                    </span>
                  )}
                </span>
                <input
                  type="checkbox"
                  disabled={!canThink}
                  checked={canThink && thinking}
                  onChange={(e) => setThinking(e.target.checked)}
                  className="size-4 accent-[var(--signal)]"
                />
              </label>
            </>
          )}
        </div>

        {/* Request and response */}
        <div className="space-y-5 lg:col-span-8">
          <div className="border border-rule" style={{ borderRadius: "var(--r-sm)" }}>
            <label htmlFor="prompt" className="sr-only">
              Prompt
            </label>
            <textarea
              id="prompt"
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) run();
              }}
              rows={3}
              placeholder="Write a prompt"
              className="w-full resize-y bg-transparent px-4 py-3 font-mono text-[13px]
                         leading-relaxed text-ink outline-none placeholder:text-ink-3"
            />
            <div className="flex items-center justify-between gap-3 border-t border-rule px-3 py-2.5">
              <button
                onClick={() => setShowBody((v) => !v)}
                className="flex items-center gap-1.5 font-mono text-[11.5px] text-ink-3
                           transition-colors duration-200 hover:text-ink"
              >
                <CaretRight
                  size={12}
                  weight="bold"
                  className={`transition-transform duration-200 ${showBody ? "rotate-90" : ""}`}
                />
                Request body
              </button>

              <div className="flex items-center gap-2">
                {ms !== null && (
                  <span className="num text-[11.5px] text-ink-3">{ms} ms</span>
                )}
                {state === "running" ? (
                  <button onClick={stop} className="btn btn-ghost h-9 px-4">
                    <Stop size={13} weight="fill" />
                    Stop
                  </button>
                ) : (
                  <button
                    onClick={run}
                    disabled={!prompt.trim()}
                    className="btn btn-primary h-9 px-4 disabled:opacity-40"
                  >
                    <Play size={13} weight="fill" />
                    Run
                  </button>
                )}
              </div>
            </div>

            {showBody && (
              <pre className="overflow-x-auto border-t border-rule bg-[var(--paper-2)] px-4 py-3">
                <code className="font-mono text-[11.5px] leading-relaxed text-ink-2">
                  {JSON.stringify(body, null, 2)}
                </code>
              </pre>
            )}
          </div>

          <Output
            mode={mode}
            state={state}
            reasoning={reasoning}
            answer={answer}
            onRetry={run}
          />
        </div>
      </div>
    </div>
  );
}

function Field({
  label,
  hint,
  value,
  children,
}: {
  label: string;
  hint?: string;
  value?: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <div className="mb-2 flex items-baseline justify-between gap-3">
        <span className="font-mono text-[11px] tracking-wide text-ink-3 uppercase">{label}</span>
        {value && <span className="num text-[12px] text-ink-2">{value}</span>}
      </div>
      {children}
      {hint && <p className="mt-1.5 text-[12px] text-ink-3">{hint}</p>}
    </div>
  );
}

function Output({
  mode,
  state,
  reasoning,
  answer,
  onRetry,
}: {
  mode: Mode;
  state: "idle" | "running" | "done" | "error";
  reasoning: string;
  answer: string;
  onRetry: () => void;
}) {
  const [openReasoning, setOpenReasoning] = useState(true);

  if (mode !== "chat" && mode !== "speech") {
    return (
      <Panel>
        <p className="body text-[13px]">
          Media generation returns a task. With the placeholder backend there is
          nothing to render, so this stays empty until the endpoint is wired up.
        </p>
      </Panel>
    );
  }

  if (state === "error")
    return (
      <Panel>
        <p className="h3 text-ink">The request failed.</p>
        <p className="body mt-2 text-[13px]">
          Nothing was returned. Check the key and try again.
        </p>
        <button onClick={onRetry} className="btn btn-ghost mt-4 h-9 px-4">
          <ArrowsClockwise size={13} weight="bold" />
          Retry
        </button>
      </Panel>
    );

  if (state === "idle" && !answer)
    return (
      <Panel>
        <p className="body text-[13px]">
          The reply appears here. Reasoning models stream their thinking on a
          separate channel above the answer.
        </p>
      </Panel>
    );

  return (
    <div className="border border-rule" style={{ borderRadius: "var(--r-sm)" }}>
      {reasoning && (
        <div className="border-b border-rule">
          <button
            onClick={() => setOpenReasoning((v) => !v)}
            className="flex w-full items-center gap-1.5 px-4 py-2.5 text-left font-mono
                       text-[11.5px] text-ink-3 transition-colors duration-200 hover:text-ink"
          >
            <CaretRight
              size={12}
              weight="bold"
              className={`transition-transform duration-200 ${openReasoning ? "rotate-90" : ""}`}
            />
            Reasoning
          </button>
          {openReasoning && (
            <p className="whitespace-pre-wrap px-4 pb-3 font-mono text-[12px] leading-relaxed text-ink-3">
              {reasoning}
            </p>
          )}
        </div>
      )}

      <div className="px-4 py-4">
        <p className="whitespace-pre-wrap font-mono text-[13px] leading-relaxed text-ink">
          {answer}
          {state === "running" && (
            <span className="ml-px inline-block h-[1.05em] w-[7px] translate-y-[2px] bg-signal align-baseline animate-pulse" />
          )}
        </p>
      </div>
    </div>
  );
}

function Panel({ children }: { children: React.ReactNode }) {
  return (
    <div
      className="border border-dashed border-rule-strong px-4 py-8"
      style={{ borderRadius: "var(--r-sm)" }}
    >
      {children}
    </div>
  );
}

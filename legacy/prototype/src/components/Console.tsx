import { useEffect, useRef, useState } from "react";
import { ArrowRight, Spinner } from "@phosphor-icons/react";
import { streamCompletion } from "../lib/api";

const SUGGESTIONS = ["How do I stream?", "Tool calling?", "Which models take audio?"];

/**
 * A working request, not a picture of one.
 *
 * This is the real client: it calls the same async generator the rest of the
 * app uses, renders tokens as they arrive, and can be aborted mid-flight. When
 * the placeholder is swapped for the live endpoint it keeps working unchanged,
 * which is the point of it being a component rather than a screenshot.
 *
 * The motion is the product: an API that streams should be shown streaming.
 */
export function Console({ compact = false }: { compact?: boolean }) {
  const [prompt, setPrompt] = useState("");
  const [out, setOut] = useState("");
  const [state, setState] = useState<"idle" | "streaming" | "done">("idle");
  const abort = useRef<AbortController | null>(null);
  const bodyRef = useRef<HTMLDivElement>(null);

  useEffect(() => () => abort.current?.abort(), []);

  const run = async (text: string) => {
    const q = text.trim();
    if (!q || state === "streaming") return;
    abort.current?.abort();
    const ctrl = new AbortController();
    abort.current = ctrl;

    setPrompt(q);
    setOut("");
    setState("streaming");
    try {
      for await (const chunk of streamCompletion(q, ctrl.signal)) {
        if (ctrl.signal.aborted) return;
        setOut((p) => p + chunk);
        bodyRef.current?.scrollTo({ top: bodyRef.current.scrollHeight });
      }
      setState("done");
    } catch {
      setOut("Request failed. Check the key and try again.");
      setState("done");
    }
  };

  return (
    <div className="border border-rule bg-[var(--paper)]" style={{ borderRadius: "var(--r-sm)" }}>
      {/* Request line. Real method and path, because that is what you would send. */}
      <div className="flex items-center justify-between gap-3 border-b border-rule px-4 py-2.5">
        <span className="truncate font-mono text-[11px] text-ink-3">
          <span className="text-signal">POST</span> /v1/chat/completions
        </span>
        <span className="shrink-0 font-mono text-[11px] text-ink-3">qwen3.8-max</span>
      </div>

      <div
        ref={bodyRef}
        className={`overflow-y-auto px-4 py-4 ${compact ? "h-[210px]" : "h-[260px]"}`}
      >
        {state === "idle" && !out ? (
          <div className="flex h-full flex-col justify-center gap-3">
            <p className="font-mono text-[12px] leading-relaxed text-ink-3">
              Ask something to see the stream.
            </p>
            <div className="flex flex-wrap gap-1.5">
              {SUGGESTIONS.map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => run(s)}
                  className="border border-rule px-2.5 py-1.5 font-mono text-[11px] text-ink-2
                             transition-colors duration-200 hover:border-signal hover:text-signal"
                  style={{ borderRadius: "var(--r-sm)" }}
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
        ) : (
          <div className="space-y-3">
            <p className="font-mono text-[12px] leading-relaxed text-ink-3">
              <span className="text-signal">{">"}</span> {prompt}
            </p>
            <p className="whitespace-pre-wrap font-mono text-[12.5px] leading-relaxed text-ink">
              {out}
              {state === "streaming" && (
                <span className="ml-px inline-block h-[1.05em] w-[7px] translate-y-[2px] bg-signal align-baseline animate-pulse" />
              )}
            </p>
          </div>
        )}
      </div>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          run(prompt);
        }}
        className="flex items-center gap-2 border-t border-rule px-3 py-2.5"
      >
        <label htmlFor="console-input" className="sr-only">
          Prompt
        </label>
        <input
          id="console-input"
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          placeholder="Type a prompt"
          className="min-w-0 flex-1 bg-transparent font-mono text-[12.5px] text-ink
                     outline-none placeholder:text-ink-3"
        />
        <button
          type="submit"
          disabled={state === "streaming" || !prompt.trim()}
          aria-label="Send prompt"
          className="grid size-8 shrink-0 place-items-center bg-ink text-paper transition-opacity
                     duration-200 disabled:opacity-30"
          style={{ borderRadius: "var(--r-sm)" }}
        >
          {state === "streaming" ? (
            <Spinner size={14} weight="bold" className="animate-spin" />
          ) : (
            <ArrowRight size={14} weight="bold" />
          )}
        </button>
      </form>
    </div>
  );
}

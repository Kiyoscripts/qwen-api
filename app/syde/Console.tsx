"use client";

import { useEffect, useRef, useState } from "react";
import { ArrowRight, Spinner } from "@phosphor-icons/react";

const SUGGESTIONS = ["How do I stream?", "What models take audio?", "Show me tool calling"];

/**
 * A working request, not a picture of one.
 *
 * This hits the real /v1/chat/completions. Requests from this site carry the
 * session cookie, so a signed-in visitor gets a genuine answer and a signed-out
 * one gets a genuine 401, which is the honest thing for a hero to show.
 *
 * The motion is the product: an API that streams should be shown streaming.
 */
export function Console() {
  const [prompt, setPrompt] = useState("");
  const [out, setOut] = useState("");
  const [state, setState] = useState<"idle" | "streaming" | "done" | "error">("idle");
  const abort = useRef<AbortController | null>(null);
  const body = useRef<HTMLDivElement>(null);

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
      const res = await fetch("/v1/chat/completions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "qwen3.8-max",
          messages: [{ role: "user", content: q }],
          stream: true,
          enable_thinking: false,
        }),
        signal: ctrl.signal,
      });

      if (!res.ok || !res.body) {
        setOut(
          res.status === 401
            ? "Sign in to run this. Every request needs a key, including this one."
            : `The request failed (${res.status}).`
        );
        setState("error");
        return;
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buf = "";
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        let i: number;
        while ((i = buf.indexOf("\n")) !== -1) {
          const line = buf.slice(0, i).trim();
          buf = buf.slice(i + 1);
          if (!line.startsWith("data:")) continue;
          const payload = line.slice(5).trim();
          if (!payload || payload === "[DONE]") continue;
          try {
            const t = JSON.parse(payload)?.choices?.[0]?.delta?.content;
            if (typeof t === "string" && t) {
              setOut((p) => p + t);
              body.current?.scrollTo({ top: body.current.scrollHeight });
            }
          } catch {
            /* a malformed frame should not end the reply */
          }
        }
      }
      setState("done");
    } catch (e: any) {
      if (e?.name === "AbortError") return;
      setOut("Could not reach the endpoint.");
      setState("error");
    }
  };

  return (
    <div className="border border-rule bg-[var(--paper)]" style={{ borderRadius: "var(--r-sm)" }}>
      <div className="flex items-center justify-between gap-3 border-b border-rule px-4 py-2.5">
        <span className="truncate font-mono text-[11px] text-ink-3">
          <span className="text-signal">POST</span> /v1/chat/completions
        </span>
        <span className="shrink-0 font-mono text-[11px] text-ink-3">qwen3.8-max</span>
      </div>

      <div ref={body} className="h-[260px] overflow-y-auto px-4 py-4">
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
        <label htmlFor="hero-console" className="sr-only">
          Prompt
        </label>
        <input
          id="hero-console"
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          placeholder="Type a prompt"
          className="min-w-0 flex-1 bg-transparent font-mono text-[12.5px] text-ink outline-none
                     placeholder:text-ink-3"
        />
        <button
          type="submit"
          disabled={state === "streaming" || !prompt.trim()}
          aria-label="Send prompt"
          className="grid size-8 shrink-0 place-items-center bg-ink text-[var(--paper)]
                     transition-opacity duration-200 disabled:opacity-30"
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

"use client";

import { useEffect, useRef, useState } from "react";
import { Sparkle, X, ArrowUp, Stop } from "@phosphor-icons/react";
import { useT } from "../I18n";
import { DOCS_MODEL, DOCS_SYSTEM } from "@/lib/docsContext";

interface Turn { role: "user" | "assistant"; content: string }

/**
 * A reader sitting in the docs with a question.
 *
 * Grounded rather than general: the system prompt carries the reference and
 * tells the model to say when something is not covered. An assistant that
 * invents a base URL is worse than no assistant, because the mistake only
 * surfaces later as a 404 the reader blames on the API.
 *
 * Runs on gpt-5.6-luna, which is on the free tier, so asking it something costs
 * nothing off the Qwen pool.
 */
export function DocsAssistant() {
  const t = useT();
  const [open, setOpen] = useState(false);
  const [turns, setTurns] = useState<Turn[]>([]);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const abort = useRef<AbortController | null>(null);
  const scroller = useRef<HTMLDivElement>(null);

  useEffect(() => () => abort.current?.abort(), []);
  useEffect(() => {
    scroller.current?.scrollTo({ top: scroller.current.scrollHeight, behavior: "smooth" });
  }, [turns, busy]);

  // Escape closes it, like any other panel.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);

  const ask = async (question: string) => {
    const q = question.trim();
    if (!q || busy) return;

    const sent: Turn[] = [...turns, { role: "user", content: q }];
    setTurns([...sent, { role: "assistant", content: "" }]);
    setDraft("");
    setBusy(true);

    const ctrl = new AbortController();
    abort.current = ctrl;
    const put = (text: string) =>
      setTurns([...sent, { role: "assistant", content: text }]);

    try {
      const r = await fetch("/v1/chat/completions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: DOCS_MODEL,
          messages: [{ role: "system", content: DOCS_SYSTEM }, ...sent],
          stream: true,
        }),
        signal: ctrl.signal,
      });

      if (!r.ok) {
        put(r.status === 401 ? t("chat_add_key_to_load") : `${t("error")} (${r.status})`);
        return;
      }

      const reader = r.body!.getReader();
      const dec = new TextDecoder();
      let buf = "";
      let acc = "";
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        let i: number;
        while ((i = buf.indexOf("\n")) !== -1) {
          const line = buf.slice(0, i).trim();
          buf = buf.slice(i + 1);
          if (!line.startsWith("data:")) continue;
          const payload = line.slice(5).trim();
          if (!payload || payload === "[DONE]") continue;
          try {
            const c = JSON.parse(payload)?.choices?.[0]?.delta?.content;
            if (typeof c === "string" && c) {
              acc += c;
              put(acc);
            }
          } catch {
            /* a malformed frame should not end the answer */
          }
        }
      }
    } catch (e: any) {
      if (e?.name !== "AbortError") put(t("error"));
    } finally {
      setBusy(false);
    }
  };

  const suggestions = [t("da_q1"), t("da_q2"), t("da_q3")];

  if (!open)
    return (
      <button
        onClick={() => setOpen(true)}
        className="btn btn-primary fixed right-5 bottom-5 z-50 shadow-lg"
        aria-label={t("da_title")}
      >
        <Sparkle size={14} weight="fill" />
        {t("da_title")}
      </button>
    );

  return (
    <aside
      className="fixed right-5 bottom-5 z-50 flex h-[min(560px,calc(100dvh-6rem))] w-[min(400px,calc(100vw-2.5rem))]
                 flex-col border border-rule-strong bg-[var(--paper)] shadow-2xl"
      style={{ borderRadius: "var(--r-sm)" }}
      aria-label={t("da_title")}
    >
      <div className="flex items-center justify-between gap-3 border-b border-rule px-4 py-3">
        <div className="min-w-0">
          <p className="h3 truncate text-ink">{t("da_title")}</p>
          <p className="truncate font-mono text-[11px] text-ink-3">{DOCS_MODEL}</p>
        </div>
        <button onClick={() => setOpen(false)} aria-label={t("close")}
                className="shrink-0 text-ink-3 transition-colors duration-200 hover:text-ink">
          <X size={15} weight="bold" />
        </button>
      </div>

      <div ref={scroller} className="flex-1 space-y-4 overflow-y-auto px-4 py-4">
        {turns.length === 0 ? (
          <div className="space-y-3">
            <p className="body text-[13px]">{t("da_hint")}</p>
            <div className="flex flex-col gap-1.5">
              {suggestions.map((s) => (
                <button key={s} onClick={() => ask(s)}
                  className="border border-rule px-3 py-2 text-left font-mono text-[11.5px] text-ink-2
                             transition-colors duration-200 hover:border-signal hover:text-signal"
                  style={{ borderRadius: "var(--r-sm)" }}>
                  {s}
                </button>
              ))}
            </div>
          </div>
        ) : (
          turns.map((turn, i) => (
            <div key={i} className={turn.role === "user" ? "flex justify-end" : ""}>
              {turn.role === "user" ? (
                <p className="max-w-[85%] bg-ink px-3 py-2 text-[13px] leading-relaxed text-[var(--paper)]"
                   style={{ borderRadius: "var(--r-sm)" }}>
                  {turn.content}
                </p>
              ) : (
                <p className="whitespace-pre-wrap text-[13px] leading-relaxed text-ink">
                  {turn.content}
                  {busy && i === turns.length - 1 && (
                    <span className="ml-px inline-block h-[1.05em] w-[6px] translate-y-[2px]
                                     bg-signal align-baseline animate-pulse" />
                  )}
                </p>
              )}
            </div>
          ))
        )}
      </div>

      <form onSubmit={(e) => { e.preventDefault(); ask(draft); }}
            className="flex items-end gap-2 border-t border-rule px-3 py-2.5">
        <label htmlFor="da-input" className="sr-only">{t("da_title")}</label>
        <textarea
          id="da-input"
          value={draft}
          rows={1}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); ask(draft); }
          }}
          placeholder={t("da_placeholder")}
          className="max-h-24 min-h-[36px] w-full resize-none bg-transparent py-1.5 text-[13px]
                     text-ink outline-none placeholder:text-ink-3"
        />
        {busy ? (
          <button type="button" onClick={() => abort.current?.abort()} aria-label={t("chat_stop_generating")}
            className="grid size-8 shrink-0 place-items-center border border-rule text-ink"
            style={{ borderRadius: "var(--r-sm)" }}>
            <Stop size={12} weight="fill" />
          </button>
        ) : (
          <button type="submit" disabled={!draft.trim()} aria-label={t("chat_send")}
            className="grid size-8 shrink-0 place-items-center bg-ink text-[var(--paper)]
                       transition-opacity duration-200 disabled:opacity-30"
            style={{ borderRadius: "var(--r-sm)" }}>
            <ArrowUp size={13} weight="bold" />
          </button>
        )}
      </form>
    </aside>
  );
}

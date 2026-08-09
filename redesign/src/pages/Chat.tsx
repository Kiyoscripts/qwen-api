import { useEffect, useRef, useState } from "react";
import { Plus, Trash, ArrowUp, Stop, ChatText } from "@phosphor-icons/react";
import { listModels, streamChat, type ChatMessage, type Model } from "../lib/api";
import { ModelPicker } from "../components/ModelPicker";

interface Thread {
  id: string;
  title: string;
  model: string;
  messages: ChatMessage[];
  at: number;
}

const STORE = "syde_threads";

function load(): Thread[] {
  try {
    return JSON.parse(localStorage.getItem(STORE) ?? "[]");
  } catch {
    return [];
  }
}
const save = (t: Thread[]) => localStorage.setItem(STORE, JSON.stringify(t.slice(0, 40)));

/** First few words of the opening message, which is what the sidebar shows. */
const titleOf = (text: string) =>
  text.trim().split(/\s+/).slice(0, 6).join(" ").slice(0, 44) || "New chat";

export function Chat() {
  const [threads, setThreads] = useState<Thread[]>(load);
  const [activeId, setActiveId] = useState<string | null>(threads[0]?.id ?? null);
  const [models, setModels] = useState<Model[]>([]);
  const [model, setModel] = useState("qwen3.8-max");
  const [draft, setDraft] = useState("");
  const [streaming, setStreaming] = useState(false);
  const abort = useRef<AbortController | null>(null);
  const scroller = useRef<HTMLDivElement>(null);

  useEffect(() => {
    listModels().then((m) => setModels(m.filter((x) => x.capabilities.chat_types.includes("t2t"))));
    return () => abort.current?.abort();
  }, []);

  const active = threads.find((t) => t.id === activeId) ?? null;

  useEffect(() => {
    scroller.current?.scrollTo({ top: scroller.current.scrollHeight, behavior: "smooth" });
  }, [active?.messages.length, streaming]);

  const update = (id: string, fn: (t: Thread) => Thread) =>
    setThreads((prev) => {
      const next = prev.map((t) => (t.id === id ? fn(t) : t));
      save(next);
      return next;
    });

  const send = async () => {
    const text = draft.trim();
    if (!text || streaming) return;

    let id = activeId;
    let thread = active;

    if (!thread) {
      id = crypto.randomUUID();
      thread = { id, title: titleOf(text), model, messages: [], at: Date.now() };
      setThreads((prev) => {
        const next = [thread!, ...prev];
        save(next);
        return next;
      });
      setActiveId(id);
    }

    const withUser: ChatMessage[] = [...thread.messages, { role: "user", content: text }];
    update(id!, (t) => ({ ...t, messages: [...withUser, { role: "assistant", content: "" }], at: Date.now() }));
    setDraft("");
    setStreaming(true);

    const ctrl = new AbortController();
    abort.current = ctrl;
    try {
      let acc = "";
      for await (const d of streamChat({ model, messages: withUser, thinking: false }, ctrl.signal)) {
        if (ctrl.signal.aborted) break;
        if (d.channel !== "answer") continue;
        acc += d.text;
        update(id!, (t) => {
          const msgs = [...t.messages];
          msgs[msgs.length - 1] = { role: "assistant", content: acc };
          return { ...t, messages: msgs };
        });
      }
    } catch {
      update(id!, (t) => {
        const msgs = [...t.messages];
        msgs[msgs.length - 1] = { role: "assistant", content: "The request failed. Try again." };
        return { ...t, messages: msgs };
      });
    } finally {
      setStreaming(false);
    }
  };

  const remove = (id: string) => {
    setThreads((prev) => {
      const next = prev.filter((t) => t.id !== id);
      save(next);
      return next;
    });
    if (activeId === id) setActiveId(null);
  };

  return (
    <div className="field py-8">
      <div className="grid gap-5 lg:grid-cols-12">
        {/* Threads */}
        <aside className="lg:col-span-3">
          <button
            onClick={() => {
              setActiveId(null);
              setDraft("");
            }}
            className="btn btn-ghost w-full"
          >
            <Plus size={13} weight="bold" />
            New chat
          </button>

          <div className="mt-3 space-y-px">
            {threads.length === 0 && (
              <p className="px-1 py-4 text-[12.5px] text-ink-3">
                Conversations are kept in this browser.
              </p>
            )}
            {threads.map((t) => (
              <div
                key={t.id}
                className={`group flex items-center gap-2 border px-3 py-2 transition-colors duration-150 ${
                  t.id === activeId
                    ? "border-rule bg-[var(--paper-2)]"
                    : "border-transparent hover:bg-[var(--paper-2)]"
                }`}
                style={{ borderRadius: "var(--r-sm)" }}
              >
                <button
                  onClick={() => setActiveId(t.id)}
                  className="min-w-0 flex-1 truncate text-left text-[13px] text-ink"
                >
                  {t.title}
                </button>
                <button
                  onClick={() => remove(t.id)}
                  aria-label={`Delete ${t.title}`}
                  className="shrink-0 text-ink-3 opacity-0 transition-opacity duration-150
                             group-hover:opacity-100 hover:text-signal focus-visible:opacity-100"
                >
                  <Trash size={13} weight="bold" />
                </button>
              </div>
            ))}
          </div>
        </aside>

        {/* Thread */}
        <section className="lg:col-span-9">
          <div
            className="flex h-[calc(100dvh-11rem)] min-h-[420px] flex-col border border-rule"
            style={{ borderRadius: "var(--r-sm)" }}
          >
            <div className="flex items-center justify-between gap-3 border-b border-rule px-3 py-2.5">
              <div className="w-full max-w-[300px]">
                <ModelPicker models={models} value={model} onChange={setModel} />
              </div>
              {active && (
                <span className="num shrink-0 text-[11.5px] text-ink-3">
                  {active.messages.length} messages
                </span>
              )}
            </div>

            <div ref={scroller} className="flex-1 overflow-y-auto px-4 py-5">
              {!active || active.messages.length === 0 ? (
                <div className="flex h-full flex-col items-center justify-center gap-3 text-center">
                  <ChatText size={22} weight="regular" className="text-ink-3" />
                  <p className="h3 text-ink">Start a conversation</p>
                  <p className="body max-w-[38ch] text-[13px]">
                    Pick a model and type below. History stays on this device.
                  </p>
                </div>
              ) : (
                <div className="mx-auto max-w-[64ch] space-y-5">
                  {active.messages.map((m, i) => (
                    <div key={i} className={m.role === "user" ? "flex justify-end" : ""}>
                      {m.role === "user" ? (
                        <p
                          className="max-w-[85%] bg-ink px-3.5 py-2.5 text-[13.5px] leading-relaxed text-[var(--paper)]"
                          style={{ borderRadius: "var(--r-sm)" }}
                        >
                          {m.content}
                        </p>
                      ) : (
                        <p className="whitespace-pre-wrap text-[13.5px] leading-relaxed text-ink">
                          {m.content}
                          {streaming && i === active.messages.length - 1 && (
                            <span className="ml-px inline-block h-[1.05em] w-[7px] translate-y-[2px] bg-signal align-baseline animate-pulse" />
                          )}
                        </p>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>

            <form
              onSubmit={(e) => {
                e.preventDefault();
                send();
              }}
              className="flex items-end gap-2 border-t border-rule px-3 py-2.5"
            >
              <label htmlFor="draft" className="sr-only">
                Message
              </label>
              <textarea
                id="draft"
                value={draft}
                rows={1}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    send();
                  }
                }}
                placeholder="Ask anything"
                className="max-h-32 min-h-[38px] w-full resize-none bg-transparent py-2 text-[13.5px]
                           text-ink outline-none placeholder:text-ink-3"
              />
              {streaming ? (
                <button
                  type="button"
                  onClick={() => abort.current?.abort()}
                  aria-label="Stop"
                  className="grid size-9 shrink-0 place-items-center border border-rule text-ink"
                  style={{ borderRadius: "var(--r-sm)" }}
                >
                  <Stop size={13} weight="fill" />
                </button>
              ) : (
                <button
                  type="submit"
                  disabled={!draft.trim()}
                  aria-label="Send"
                  className="grid size-9 shrink-0 place-items-center bg-ink text-[var(--paper)]
                             transition-opacity duration-200 disabled:opacity-30"
                  style={{ borderRadius: "var(--r-sm)" }}
                >
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

"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { CircleNotch, SpeakerHigh, SpeakerSlash, Stop } from "@phosphor-icons/react";

/** The endpoint rejects anything longer, so trim here and say so. */
const MAX_CHARS = 2000;

/**
 * Markdown read aloud verbatim is unlistenable — "hash hash Setup", "star star
 * important", every URL spelled out. This keeps the prose and drops the syntax.
 * Code blocks are replaced with a short spoken marker rather than read out,
 * because a synthesised function body is noise.
 */
export function speakableText(md: string): string {
  // Add a sentence stop only where there isn't one already, so a synthesiser
  // pauses between a heading and its body without producing "Setup.. Run it."
  const stop = (t: string) => {
    const v = t.trim();
    return !v ? "" : /[.!?:;,]$/.test(v) ? v : v + ".";
  };

  return (
    md
      // Structure that should not be recited.
      .replace(/```[\w-]*\n?[\s\S]*?```/g, " (code block) ")
      .replace(/!\[[^\]]*\]\([^)]*\)/g, " (image) ")
      .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
      .replace(/`([^`]+)`/g, "$1")
      // Emphasis markers, before the line rules below read the text.
      .replace(/(\*\*|__)(.*?)\1/g, "$2")
      .replace(/(\*|_)(.*?)\1/g, "$2")
      // Horizontal rules carry nothing to say.
      .replace(/^\s{0,3}([-*_])\s*\1\s*\1[\s*_-]*$/gm, "")
      // Headings and list items each become their own spoken sentence.
      .replace(/^\s{0,3}#{1,6}\s+(.+)$/gm, (_m, t: string) => stop(t))
      .replace(/^\s{0,3}(?:[-*+]|\d+[.)])\s+(.+)$/gm, (_m, t: string) => stop(t))
      .replace(/^\s{0,3}>\s?/gm, "")
      .replace(/\|/g, " ")
      // A blank line is a pause; only add a stop if the text lacks one.
      .replace(/([^\s])[ \t]*\n\s*\n\s*/g, (_m, c: string) => (/[.!?:;]/.test(c) ? c + " " : c + ". "))
      .replace(/\s+/g, " ")
      .trim()
  );
}

type Status = { idx: number; state: "loading" | "playing" } | null;

/**
 * One audio element for the whole thread, so starting a second message stops
 * the first rather than talking over it.
 */
export function useReadAloud(authHeaders: () => Record<string, string>) {
  const [status, setStatus] = useState<Status>(null);
  const [error, setError] = useState<string | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const urlRef = useRef<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const stop = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    const a = audioRef.current;
    if (a) {
      a.pause();
      a.src = "";
    }
    if (urlRef.current) {
      URL.revokeObjectURL(urlRef.current);
      urlRef.current = null;
    }
    setStatus(null);
  }, []);

  // Release the blob and any in-flight request if the view goes away.
  useEffect(() => () => stop(), [stop]);

  const speak = useCallback(
    async (markdown: string, idx: number) => {
      if (status?.idx === idx) {
        stop();
        return;
      }
      stop();
      setError(null);

      const text = speakableText(markdown);
      if (!text) {
        setError("Nothing to read in this message.");
        return;
      }
      const input = text.length > MAX_CHARS ? text.slice(0, MAX_CHARS) : text;

      const ctrl = new AbortController();
      abortRef.current = ctrl;
      setStatus({ idx, state: "loading" });

      try {
        const res = await fetch("/v1/audio/speech", {
          method: "POST",
          signal: ctrl.signal,
          headers: { "Content-Type": "application/json", ...authHeaders() },
          body: JSON.stringify({ input }),
        });
        if (!res.ok) {
          const j = await res.json().catch(() => ({}));
          throw new Error(j?.error?.message || `Speech failed (${res.status})`);
        }
        const blob = await res.blob();
        if (ctrl.signal.aborted) return;

        const url = URL.createObjectURL(blob);
        urlRef.current = url;
        const audio = audioRef.current ?? new Audio();
        audioRef.current = audio;
        audio.src = url;
        audio.onended = () => stop();
        audio.onerror = () => {
          setError("Could not play the audio.");
          stop();
        };
        await audio.play();
        if (!ctrl.signal.aborted) setStatus({ idx, state: "playing" });
      } catch (e: any) {
        if (e?.name !== "AbortError") setError(e.message || "Could not read this aloud.");
        stop();
      }
    },
    [authHeaders, status, stop]
  );

  return { status, error, speak, stop, truncatedAt: MAX_CHARS };
}

export function ReadAloudButton({
  idx,
  status,
  onClick,
  disabled,
}: {
  idx: number;
  status: Status;
  onClick: () => void;
  disabled?: boolean;
}) {
  const mine = status?.idx === idx;
  const state = mine ? status!.state : "idle";
  const label = state === "playing" ? "Stop reading" : state === "loading" ? "Preparing audio" : "Read aloud";

  return (
    <button
      className={`c-action ${mine ? "on" : ""}`}
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      title={label}
      aria-pressed={mine}
    >
      {state === "loading" ? (
        <CircleNotch size={15} className="ra-spin" />
      ) : state === "playing" ? (
        <Stop size={15} weight="fill" />
      ) : disabled ? (
        <SpeakerSlash size={15} />
      ) : (
        <SpeakerHigh size={15} />
      )}
    </button>
  );
}

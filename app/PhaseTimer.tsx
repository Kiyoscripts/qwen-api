"use client";

import { useEffect, useState } from "react";

/**
 * How long the model spent deciding versus writing.
 *
 * The split is the useful part on a reasoning model: `qwen3.8-max`
 * always reasons and cannot be told not to, so a reply that looks frozen is
 * usually mid-deliberation rather than stalled. Separating the two makes the
 * difference between "thinking hard" and "something is wrong" visible, and it
 * is the same number that decides whether a truncation was caused by the
 * request ceiling.
 */

const secs = (ms: number) => `${(ms / 1000).toFixed(1)}s`;

/**
 * Ticks on its own so a running timer re-renders only this element, not the
 * whole thread — which is already re-rendering once per streamed token.
 */
export function LiveTimer({ since, label }: { since: number; label: string }) {
  const [, bump] = useState(0);
  useEffect(() => {
    const id = setInterval(() => bump((n) => n + 1), 100);
    return () => clearInterval(id);
  }, []);
  return (
    <span className="ptimer live">
      <i className="ptimer-dot" />
      {label} {secs(Date.now() - since)}
    </span>
  );
}

export function PhaseTimer({
  live,
  startedAt,
  thinkMs,
  answerMs,
  writing,
}: {
  /** the turn is still streaming */
  live?: boolean;
  /** epoch ms the request began, present only while live */
  startedAt?: number;
  thinkMs?: number;
  answerMs?: number;
  /** the first visible token has arrived, so it is writing rather than thinking */
  writing?: boolean;
}) {
  if (live && startedAt) {
    // While writing, count from the moment output started, not from the request:
    // the thinking time is already settled and shown beside it.
    const since = writing && thinkMs != null ? startedAt + thinkMs : startedAt;
    return (
      <div className="ptimer-row">
        {writing && thinkMs != null && <span className="ptimer">thought {secs(thinkMs)}</span>}
        <LiveTimer since={since} label={writing ? "writing" : "thinking"} />
      </div>
    );
  }

  if (thinkMs == null && answerMs == null) return null;
  return (
    <div className="ptimer-row">
      {thinkMs != null && <span className="ptimer">thought {secs(thinkMs)}</span>}
      {answerMs != null && answerMs > 0 && <span className="ptimer">wrote {secs(answerMs)}</span>}
      {thinkMs != null && answerMs != null && (
        <span className="ptimer total">{secs(thinkMs + answerMs)} total</span>
      )}
    </div>
  );
}

// A calm, static backdrop.
//
// This replaces the old animated canvas ("Aurora"): four light bodies drifting
// on a curtain sweep, reacting to the token stream. That motion was the
// cyberpunk part of the look and the source of the chat background bugs, so it
// is gone — this paints a quiet, fixed gradient field instead. Nothing animates.
//
// The old prop shape (`state`, `pulseRef`) is accepted and ignored, so the pages
// that still pass stream state keep compiling untouched; the type is re-exported
// for the same reason.

export type AuroraState = "idle" | "ambient" | "thinking" | "responding" | "done";

interface Props {
  /** Ignored — kept so existing callers compile. */
  state?: AuroraState;
  /** Ignored — kept so existing callers compile. */
  pulseRef?: { current: number };
}

export default function Aurora(_props: Props = {}) {
  return (
    <div className="amb" aria-hidden="true">
      <div className="amb-field" />
    </div>
  );
}

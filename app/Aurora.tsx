"use client";

// Soft aurora backdrop for the glassy look — two slow, low-opacity blobs + fine
// grain (restrained, not a rainbow light show). On /chat the `state` prop makes it
// react to what the model is doing: calm idle → a touch more alive while
// thinking/responding → brief settle when a reply lands.
export type AuroraState = "idle" | "thinking" | "responding" | "done";

export default function Aurora({ state = "idle" }: { state?: AuroraState }) {
  return (
    <div className={`amb state-${state}`} aria-hidden="true">
      <span className="amb-blob b1" />
      <span className="amb-blob b2" />
      <div className="amb-grain" />
    </div>
  );
}

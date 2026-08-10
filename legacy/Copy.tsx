"use client";

import { useState } from "react";
import { useT } from "./I18n";

/** Small copy control. Falls back silently where the clipboard is blocked. */
export function CopyButton({ text, className = "copy-btn" }: { text: string; className?: string }) {
  const t = useT();
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      className={className}
      aria-label={t("copy_to_clipboard")}
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setDone(true);
          setTimeout(() => setDone(false), 1400);
        } catch {
          /* clipboard unavailable */
        }
      }}
    >
      {done ? "Copied" : "Copy"}
    </button>
  );
}

/** The base URL, presented the way you'd actually paste it. */
export function BaseUrl({ url }: { url: string }) {
  const t = useT();
  return (
    <div className="lp-base glass">
      <span className="lp-base-lbl">{t("copy_base_url")}</span>
      <code>{url}/v1</code>
      <CopyButton text={`${url}/v1`} className="lp-base-copy" />
    </div>
  );
}

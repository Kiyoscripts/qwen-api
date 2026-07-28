"use client";

import { useEffect, useRef, useState } from "react";
import { ArrowsOut, Check, Copy, DownloadSimple, X } from "@phosphor-icons/react";
import { useT } from "../I18n";

/** language tag -> file extension for the download button. */
const EXT: Record<string, string> = {
  html: "html", xml: "xml", svg: "svg",
  javascript: "js", js: "js", jsx: "jsx", typescript: "ts", ts: "ts", tsx: "tsx",
  python: "py", py: "py", ruby: "rb", rb: "rb", php: "php", go: "go", rust: "rs", rs: "rs",
  java: "java", kotlin: "kt", swift: "swift", c: "c", cpp: "cpp", "c++": "cpp", csharp: "cs", cs: "cs",
  css: "css", scss: "scss", sass: "sass", json: "json", yaml: "yml", yml: "yml", toml: "toml",
  sql: "sql", bash: "sh", sh: "sh", shell: "sh", zsh: "sh", powershell: "ps1",
  markdown: "md", md: "md", dockerfile: "Dockerfile", makefile: "Makefile", ini: "ini", env: "env",
};

/** Languages the preview pane can actually render. */
const PREVIEWABLE = new Set(["html", "svg", "xml"]);

function looksLikeHtml(code: string): boolean {
  const t = code.trimStart().slice(0, 400).toLowerCase();
  return t.startsWith("<!doctype html") || t.startsWith("<html") || (t.startsWith("<svg") && t.includes("xmlns"));
}

/**
 * Preview overlay for generated markup.
 *
 * The iframe is sandboxed WITHOUT `allow-same-origin`, which is the whole point:
 * this page holds a session cookie and an API key in localStorage, and the code
 * being rendered was written by a model from whatever was in the conversation.
 * Omitting same-origin gives the frame an opaque origin, so scripts can run —
 * which is what makes a preview useful — but cannot read cookies, storage or the
 * DOM of the page that opened it.
 */
function Preview({ code, onClose }: { code: string; onClose: () => void }) {
  const t = useT();
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [onClose]);

  return (
    <div className="cb-preview-scrim" onClick={onClose}>
      <div className="cb-preview" onClick={(e) => e.stopPropagation()}>
        <header>
          <span>{t("cb_preview")}</span>
          <span className="cb-preview-note">sandboxed · no access to your session</span>
          <button className="c-icon-btn" onClick={onClose} aria-label={t("cb_close_preview")}>
            <X size={17} />
          </button>
        </header>
        <iframe title={t("cb_code_preview")} sandbox="allow-scripts allow-modals allow-forms" srcDoc={code} />
      </div>
    </div>
  );
}

export function CodeBlock({ children, className }: { children: React.ReactNode; className?: string }) {
  const t = useT();
  const [copied, setCopied] = useState(false);
  const [previewing, setPreviewing] = useState(false);
  const ref = useRef<HTMLElement>(null);
  const lang = (/language-(\w+)/.exec(className || "")?.[1] || "").toLowerCase();

  const text = () => ref.current?.textContent || "";

  async function copy() {
    try {
      await navigator.clipboard.writeText(text());
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      /* clipboard may be blocked */
    }
  }

  function download() {
    const body = text();
    const ext = EXT[lang] || (looksLikeHtml(body) ? "html" : "txt");
    // A couple of names are the whole filename rather than an extension.
    const name = ext === "Dockerfile" || ext === "Makefile" ? ext : `snippet-${Date.now().toString(36)}.${ext}`;
    const url = URL.createObjectURL(new Blob([body], { type: "text/plain;charset=utf-8" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = name;
    a.click();
    // Revoke on the next tick; revoking immediately can cancel the download.
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  const canPreview = PREVIEWABLE.has(lang) || (!lang && looksLikeHtml(text()));

  return (
    <div className="c-code">
      {lang && <span className="c-code-lang">{lang}</span>}
      <div className="c-code-actions">
        {canPreview && (
          <button className="c-code-btn" onClick={() => setPreviewing(true)} title={t("cb_render_sandboxed")}>
            <ArrowsOut size={13} /> Preview
          </button>
        )}
        <button className="c-code-btn" onClick={download} title={t("cb_download_file")}>
          <DownloadSimple size={13} /> {t("cb_download")}
        </button>
        <button className="c-code-btn" onClick={copy} title={t("cb_copy")}>
          {copied ? <Check size={13} weight="bold" /> : <Copy size={13} />} {copied ? "Copied" : "Copy"}
        </button>
      </div>
      <pre>
        <code ref={ref} className={className}>
          {children}
        </code>
      </pre>
      {previewing && <Preview code={text()} onClose={() => setPreviewing(false)} />}
    </div>
  );
}

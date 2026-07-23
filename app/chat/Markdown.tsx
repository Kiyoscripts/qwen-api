"use client";

import { useState, memo } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeHighlight from "rehype-highlight";
import { Check, Copy } from "@phosphor-icons/react";

function CodeBlock({ children, className }: { children: React.ReactNode; className?: string }) {
  const [copied, setCopied] = useState(false);
  const lang = /language-(\w+)/.exec(className || "")?.[1] || "";

  async function copy(e: React.MouseEvent<HTMLButtonElement>) {
    const pre = e.currentTarget.parentElement?.querySelector("code");
    if (!pre) return;
    try {
      await navigator.clipboard.writeText(pre.textContent || "");
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      /* clipboard may be blocked */
    }
  }

  return (
    <div className="c-code">
      {lang && <span className="c-code-lang">{lang}</span>}
      <button className="c-code-copy" onClick={copy} aria-label="Copy code">
        {copied ? <Check size={14} weight="bold" /> : <Copy size={14} />}
        {copied ? "Copied" : "Copy"}
      </button>
      <pre>
        <code className={className}>{children}</code>
      </pre>
    </div>
  );
}

// Qwen's generated-media CDNs are signed + referer-checked, so proxy them through
// our own origin so the browser can load them.
const MEDIA_HOSTS = /(?:qwenlm\.ai|qwen\.ai|aliyuncs\.com|alicdn\.com)/i;
function proxied(src?: string): string {
  if (!src) return "";
  // Already served through our proxy (e.g. an encrypted watermark token)? leave it.
  if (/\/api\/media\?/.test(src)) return src;
  try {
    if (MEDIA_HOSTS.test(new URL(src).hostname)) return `/api/media?url=${encodeURIComponent(src)}`;
  } catch {
    /* not an absolute URL */
  }
  return src;
}
const isVideo = (src?: string) => /\.(mp4|webm|mov)(?:\?|$)/i.test(src || "");

function MarkdownInner({ children }: { children: string }) {
  return (
    <div className="c-md">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[rehypeHighlight]}
        components={{
          // Fenced blocks become our copy-able block; inline code stays inline.
          pre: ({ children }) => <>{children}</>,
          // Generated media: render <video> for video URLs, otherwise an <img>,
          // both routed through the media proxy.
          img: ({ src, alt }) => {
            const url = proxied(typeof src === "string" ? src : "");
            if (isVideo(typeof src === "string" ? src : "")) {
              return <video className="c-gen-media" src={url} controls />;
            }
            // eslint-disable-next-line @next/next/no-img-element
            return <img className="c-gen-media" src={url} alt={alt || "generated"} loading="lazy" />;
          },
          code({ className, children, ...props }) {
            const isBlock = /language-/.test(className || "");
            if (isBlock) return <CodeBlock className={className}>{children}</CodeBlock>;
            return (
              <code className="c-inline-code" {...props}>
                {children}
              </code>
            );
          },
          a: ({ href, children }) => (
            <a href={href} target="_blank" rel="noopener noreferrer">
              {children}
            </a>
          ),
          table: ({ children }) => (
            <div className="c-table-wrap">
              <table>{children}</table>
            </div>
          ),
        }}
      >
        {children}
      </ReactMarkdown>
    </div>
  );
}

// Streaming re-renders this on every chunk, so memoise on the text.
export const Markdown = memo(MarkdownInner, (a, b) => a.children === b.children);

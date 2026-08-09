/**
 * Render a media reply as media.
 *
 * Image and video models answer in markdown: `![video](https://…mp4?key=…)`.
 * Both surfaces printed that string verbatim, so a successful generation looked
 * like a wall of URL rather than a result.
 *
 * Only this one construct is handled on purpose. It is what the media path
 * returns, and a full markdown renderer is a different job with a different
 * risk profile.
 */

const MEDIA = /!\[([^\]]*)\]\(([^)\s]+)\)/g;

/** Video by declared kind first, extension second: these URLs carry a signed
    query string, so the extension is not always at the end. */
function isVideo(alt: string, url: string): boolean {
  if (alt.toLowerCase() === "video") return true;
  return /\.(mp4|webm|mov)(\?|$)/i.test(url);
}

export function MediaAnswer({ text, className }: { text: string; className?: string }) {
  const parts: React.ReactNode[] = [];
  let last = 0;
  let m: RegExpExecArray | null;

  MEDIA.lastIndex = 0;
  while ((m = MEDIA.exec(text)) !== null) {
    const [match, alt, url] = m;
    if (m.index > last) parts.push(text.slice(last, m.index));
    parts.push(
      isVideo(alt, url) ? (
        <video
          key={m.index}
          src={url}
          controls
          playsInline
          className="mt-2 max-h-[420px] w-full border border-rule"
          style={{ borderRadius: "var(--r-sm)" }}
        />
      ) : (
        // Opens full size in a new tab, since the generated asset is usually
        // larger than the panel it is shown in.
        <a key={m.index} href={url} target="_blank" rel="noreferrer" className="block">
          <img
            src={url}
            alt={alt || ""}
            className="mt-2 max-h-[420px] w-auto border border-rule"
            style={{ borderRadius: "var(--r-sm)" }}
          />
        </a>
      )
    );
    last = m.index + match.length;
  }

  if (parts.length === 0) {
    return <p className={className}>{text}</p>;
  }
  if (last < text.length) parts.push(text.slice(last));

  return <div className={className}>{parts}</div>;
}

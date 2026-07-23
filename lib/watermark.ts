// Server-side image watermarking. Generated images are branded with a watermark
// by default; API callers can override the text or turn it off entirely via the
// `watermark` request field:
//
//   watermark omitted            -> default "Qwen3.8 API"
//   watermark: false | "" | "none" -> no watermark
//   watermark: "My Brand"        -> that text
//
// The watermark is composited into the pixels (not a CSS overlay), so it can't be
// stripped just by ignoring the UI — an API caller has to explicitly opt out.

import sharp from "sharp";

export const DEFAULT_WATERMARK = "Qwen3.8 API";
const MAX_LEN = 64;

// Turn a request-supplied `watermark` value into the text to render, or null for
// "no watermark". Undefined (field absent) keeps the branded default.
export function resolveWatermark(arg: unknown): string | null {
  if (arg === undefined) return DEFAULT_WATERMARK;
  if (arg === true) return DEFAULT_WATERMARK;
  if (arg === false || arg === null) return null;
  if (typeof arg === "string") {
    const t = arg.trim();
    if (!t || /^(none|false|off|no|0)$/i.test(t)) return null;
    return t.slice(0, MAX_LEN);
  }
  return DEFAULT_WATERMARK;
}

// Build an absolute media-proxy URL that (optionally) watermarks on the fly.
export function buildMediaUrl(origin: string, url: string, watermark: string | null): string {
  const p = new URLSearchParams({ url });
  if (watermark) p.set("wm", watermark);
  return `${origin}/api/media?${p.toString()}`;
}

function escapeXml(s: string): string {
  return s.replace(/[<>&'"]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", "'": "&apos;", '"': "&quot;" }[c] as string));
}

// Composite `text` into the bottom-right corner of the image. Returns the encoded
// bytes and their content type (format preserved for JPEG, otherwise PNG).
export async function applyWatermark(
  input: Uint8Array,
  text: string,
  upstreamType?: string
): Promise<{ buffer: Uint8Array<ArrayBuffer>; contentType: string }> {
  const img = sharp(input, { failOn: "none" });
  const meta = await img.metadata();
  const W = meta.width || 1024;
  const H = meta.height || 1024;

  const fontSize = Math.max(16, Math.round(W * 0.028));
  const pad = Math.round(fontSize * 0.9);
  const stroke = Math.max(1, fontSize * 0.06);
  const safe = escapeXml(text);
  const svg = `<svg width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg">
    <text x="${W - pad}" y="${H - pad}" text-anchor="end"
      font-family="Arial, Helvetica, sans-serif" font-size="${fontSize}" font-weight="600"
      fill="#ffffff" fill-opacity="0.9"
      stroke="#000000" stroke-opacity="0.35" stroke-width="${stroke}" paint-order="stroke">${safe}</text>
  </svg>`;

  const composited = img.composite([{ input: Buffer.from(svg), top: 0, left: 0 }]);
  const isJpeg = meta.format === "jpeg" || /jpeg|jpg/i.test(upstreamType || "");
  // Normalize to a fresh ArrayBuffer-backed view so it's a valid Response BodyInit.
  if (isJpeg) {
    return { buffer: new Uint8Array(await composited.jpeg({ quality: 92 }).toBuffer()), contentType: "image/jpeg" };
  }
  return { buffer: new Uint8Array(await composited.png().toBuffer()), contentType: "image/png" };
}

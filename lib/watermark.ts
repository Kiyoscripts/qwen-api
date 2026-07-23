// Server-side image watermarking. Generated images are branded with a watermark
// by default; API callers can override the text or turn it off entirely via the
// `watermark` request field:
//
//   watermark omitted              -> default "Qwen3.8 API"
//   watermark: false | "" | "none" -> no watermark
//   watermark: "My Brand"          -> that text
//
// The watermark is composited into the pixels (not a CSS overlay), so it can't be
// stripped just by ignoring the UI — an API caller has to explicitly opt out.
//
// Text is drawn as VECTOR PATHS (via opentype.js against a bundled font), not SVG
// <text>. Serverless Linux has no system fonts, so librsvg would render <text> as
// nothing; glyph outlines render identically everywhere.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import sharp from "sharp";
import * as opentype from "opentype.js";

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

// Parse the bundled font once and reuse it.
let fontCache: opentype.Font | null = null;
function font(): opentype.Font {
  if (!fontCache) {
    const buf = readFileSync(join(process.cwd(), "assets", "watermark-font.ttf"));
    fontCache = opentype.parse(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
  }
  return fontCache;
}

function escapeXml(s: string): string {
  return s.replace(/[<>&'"]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", "'": "&apos;", '"': "&quot;" }[c] as string));
}

// Composite `text` into the bottom-right corner of the image, on a translucent
// rounded plate for legibility. Returns the encoded bytes and their content type.
export async function applyWatermark(
  input: Uint8Array,
  text: string,
  upstreamType?: string
): Promise<{ buffer: Uint8Array<ArrayBuffer>; contentType: string }> {
  const img = sharp(input, { failOn: "none" });
  const meta = await img.metadata();
  const W = meta.width || 1024;
  const H = meta.height || 1024;
  const minDim = Math.min(W, H);

  const f = font();
  // Drop characters the font has no glyph for (emoji, etc.) so they don't render
  // as ".notdef" tofu boxes; fall back to the default if nothing is left.
  const drawn = ([...text].filter((ch) => ch === " " || f.charToGlyphIndex(ch) !== 0).join("").trim()) || DEFAULT_WATERMARK;
  text = drawn;
  const fontSize = Math.min(160, Math.max(26, Math.round(minDim * 0.045)));
  const scale = fontSize / f.unitsPerEm;
  const ascent = f.ascender * scale;
  const descent = Math.abs(f.descender) * scale;
  const textW = f.getAdvanceWidth(text, fontSize);

  const padX = Math.round(fontSize * 0.5);
  const padY = Math.round(fontSize * 0.32);
  const margin = Math.round(minDim * 0.022);
  const plateW = textW + padX * 2;
  const plateH = ascent + descent + padY * 2;
  const plateX = W - margin - plateW;
  const plateY = H - margin - plateH;
  const radius = Math.round(plateH * 0.25);

  // Glyph outlines at the text baseline inside the plate.
  const baselineX = plateX + padX;
  const baselineY = plateY + padY + ascent;
  const d = f.getPath(text, baselineX, baselineY, fontSize).toPathData(2);

  const svg = `<svg width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg">
    <rect x="${plateX.toFixed(1)}" y="${plateY.toFixed(1)}" width="${plateW.toFixed(1)}" height="${plateH.toFixed(1)}" rx="${radius}" fill="#000000" fill-opacity="0.42"/>
    <path d="${escapeXml(d)}" fill="#ffffff" fill-opacity="0.96"/>
  </svg>`;

  const composited = img.composite([{ input: Buffer.from(svg), top: 0, left: 0 }]);
  const isJpeg = meta.format === "jpeg" || /jpeg|jpg/i.test(upstreamType || "");
  // Normalize to a fresh ArrayBuffer-backed view so it's a valid Response BodyInit.
  if (isJpeg) {
    return { buffer: new Uint8Array(await composited.jpeg({ quality: 92 }).toBuffer()), contentType: "image/jpeg" };
  }
  return { buffer: new Uint8Array(await composited.png().toBuffer()), contentType: "image/png" };
}

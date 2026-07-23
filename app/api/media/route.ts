import { NextRequest, NextResponse } from "next/server";
import { applyWatermark, decryptMediaToken } from "@/lib/watermark";

export const runtime = "nodejs";
export const maxDuration = 60;

// Qwen's generated media lives on signed CDN URLs that browsers often can't load
// directly (referer checks / short-lived signatures), which shows up as a broken
// image. We re-serve it from our own origin instead.
//
// Strictly host-allowlisted so this can't be used as an open proxy (SSRF).
const ALLOWED_HOSTS = [
  "cdn.qwenlm.ai",
  "download.qwen.ai",
  "qwen-webui-prod.oss-accelerate.aliyuncs.com",
];
const ALLOWED_SUFFIXES = [".aliyuncs.com", ".alicdn.com", ".qwenlm.ai", ".qwen.ai"];

function allowed(u: URL): boolean {
  const h = u.hostname.toLowerCase();
  if (ALLOWED_HOSTS.includes(h)) return true;
  return ALLOWED_SUFFIXES.some((s) => h.endsWith(s));
}

export async function GET(req: NextRequest) {
  // Preferred: an encrypted token carrying { url, wm }. Legacy plaintext ?url=&wm=
  // is still accepted (e.g. displaying an un-watermarked generated image).
  const token = req.nextUrl.searchParams.get("t");
  let raw: string | null;
  let wm: string | null;
  if (token) {
    const dec = decryptMediaToken(token);
    if (!dec) return NextResponse.json({ error: "invalid or tampered token" }, { status: 400 });
    raw = dec.url;
    wm = dec.wm ?? null;
  } else {
    raw = req.nextUrl.searchParams.get("url");
    wm = req.nextUrl.searchParams.get("wm");
  }
  if (!raw) return NextResponse.json({ error: "url is required" }, { status: 400 });

  let target: URL;
  try {
    target = new URL(raw);
  } catch {
    return NextResponse.json({ error: "invalid url" }, { status: 400 });
  }
  if (target.protocol !== "https:" || !allowed(target)) {
    return NextResponse.json({ error: "host not allowed" }, { status: 403 });
  }

  let upstream: Response;
  try {
    upstream = await fetch(target.toString(), {
      headers: {
        // Present as the Qwen web client so the CDN serves the asset.
        "User-Agent":
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
        Referer: "https://chat.qwen.ai/",
        Accept: "*/*",
      },
    });
  } catch (e: any) {
    return NextResponse.json({ error: `fetch failed: ${e.message}` }, { status: 502 });
  }
  if (!upstream.ok || !upstream.body) {
    return NextResponse.json({ error: `upstream ${upstream.status}` }, { status: 502 });
  }

  const upstreamType = upstream.headers.get("content-type") || "application/octet-stream";

  // Optional watermark — images only. Video is served untouched (watermarking it
  // re-encodes the clip and broke playback). Falls back to the original on failure.
  const isVideo = /^video\//i.test(upstreamType) || /\.(?:mp4|webm|mov)(?:\?|$)/i.test(raw);
  if (wm && !isVideo) {
    const inBuf = new Uint8Array(await upstream.arrayBuffer());
    try {
      const { buffer, contentType } = await applyWatermark(inBuf, wm, upstreamType);
      return new Response(buffer, {
        headers: { "Content-Type": contentType, "Cache-Control": "public, max-age=3600" },
      });
    } catch {
      return new Response(inBuf, { headers: { "Content-Type": upstreamType, "Cache-Control": "public, max-age=3600" } });
    }
  }

  const headers = new Headers();
  headers.set("Content-Type", upstreamType);
  const len = upstream.headers.get("content-length");
  if (len) headers.set("Content-Length", len);
  // Generated media is immutable; let the browser cache it.
  headers.set("Cache-Control", "public, max-age=3600");
  return new Response(upstream.body, { headers });
}

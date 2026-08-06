// Image upload for vision requests (Alibaba OSS, OSS4-HMAC-SHA256 signed PUT).
// No external OSS SDK needed.

import { createHmac, createHash, randomUUID } from "node:crypto";

export type UploadKind = "image" | "video" | "audio" | "file";

export interface QwenFileEntry {
  type: UploadKind;
  file_type: string;
  showType: UploadKind;
  file_class: "vision" | "document" | "audio" | "video";
  id: string;
  url: string;
  name: string;
  size: number;
  status: "success";
  progress: 100;
  greenNet: "success";
  uploadTaskId: string;
  itemId: string;
}

const hmac = (key: string | Buffer, data: string): Buffer =>
  createHmac("sha256", key).update(data).digest();
const sha256hex = (data: string) => createHash("sha256").update(data).digest("hex");
const encodeKey = (key: string) => key.split("/").map(encodeURIComponent).join("/");

export async function fetchImageBytes(imageUrl: string): Promise<{ bytes: Buffer; mime: string }> {
  if (typeof imageUrl !== "string") throw new Error("image_url must be a string");
  const dataMatch = imageUrl.match(/^data:([^;,]+)?(;base64)?,(.*)$/s);
  if (dataMatch) {
    const mime = dataMatch[1] || "image/png";
    const isBase64 = Boolean(dataMatch[2]);
    const bytes = isBase64
      ? Buffer.from(dataMatch[3], "base64")
      : Buffer.from(decodeURIComponent(dataMatch[3]), "utf8");
    return { bytes, mime };
  }
  if (/^https?:\/\//.test(imageUrl)) {
    const res = await fetch(imageUrl);
    if (!res.ok) throw new Error(`could not fetch image (${res.status})`);
    const mime = (res.headers.get("content-type") || "image/png").split(";")[0];
    const bytes = Buffer.from(await res.arrayBuffer());
    return { bytes, mime };
  }
  throw new Error("unsupported image_url (expected data: or http(s) URL)");
}

function extFromMime(mime: string): string {
  const map: Record<string, string> = {
    "image/png": "png",
    "image/jpeg": "jpg",
    "image/jpg": "jpg",
    "image/webp": "webp",
    "image/gif": "gif",
  };
  return map[mime] || "png";
}

interface StsToken {
  access_key_id: string;
  access_key_secret: string;
  security_token: string;
  file_url: string;
  file_path: string;
  file_id: string;
  bucketname: string;
  region: string;
  endpoint: string;
}

async function ossPut(sts: StsToken, bytes: Buffer, contentType: string): Promise<void> {
  const region = sts.region.replace(/^oss-/, "");
  const host = `${sts.bucketname}.${sts.endpoint}`;
  const objectKey = sts.file_path;

  const now = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  const date = `${now.getUTCFullYear()}${p(now.getUTCMonth() + 1)}${p(now.getUTCDate())}`;
  const iso = `${date}T${p(now.getUTCHours())}${p(now.getUTCMinutes())}${p(now.getUTCSeconds())}Z`;
  const scope = `${date}/${region}/oss/aliyun_v4_request`;
  const payloadHash = "UNSIGNED-PAYLOAD";

  const signed: Record<string, string> = {
    "content-type": contentType,
    host,
    "x-oss-content-sha256": payloadHash,
    "x-oss-date": iso,
    "x-oss-security-token": sts.security_token,
  };
  const canonicalHeaders = Object.keys(signed)
    .sort()
    .map((k) => `${k}:${signed[k]}\n`)
    .join("");
  const canonicalRequest = [
    "PUT",
    "/" + sts.bucketname + "/" + encodeKey(objectKey),
    "",
    canonicalHeaders,
    "host",
    payloadHash,
  ].join("\n");
  const stringToSign = ["OSS4-HMAC-SHA256", iso, scope, sha256hex(canonicalRequest)].join("\n");

  let key = hmac("aliyun_v4" + sts.access_key_secret, date);
  key = hmac(key, region);
  key = hmac(key, "oss");
  key = hmac(key, "aliyun_v4_request");
  const signature = createHmac("sha256", key).update(stringToSign).digest("hex");

  const authorization =
    `OSS4-HMAC-SHA256 Credential=${sts.access_key_id}/${scope},` +
    `AdditionalHeaders=host,Signature=${signature}`;

  const res = await fetch(`https://${host}/${encodeKey(objectKey)}`, {
    method: "PUT",
    headers: {
      "Content-Type": contentType,
      "x-oss-content-sha256": payloadHash,
      "x-oss-date": iso,
      "x-oss-security-token": sts.security_token,
      Authorization: authorization,
    },
    body: new Uint8Array(bytes),
  });
  if (res.status !== 200) {
    throw new Error(`OSS upload failed (${res.status}): ${(await res.text()).slice(0, 200)}`);
  }
}

/**
 * How an upload is described to Qwen, derived from its MIME type.
 *
 * Upstream's getstsToken accepts any `filetype` string without validating it and
 * reports no classification back, so these values are the only thing that tells
 * the model what it was given. The image row is the one verified against a live
 * completion; the others follow the same shape by kind, which is why the mapping
 * lives here as one table rather than being scattered across call sites.
 */
export function classifyUpload(mime: string): {
  filetype: UploadKind;
  type: UploadKind;
  showType: UploadKind;
  file_class: QwenFileEntry["file_class"];
} {
  const m = (mime || "").toLowerCase();
  if (m.startsWith("image/")) return { filetype: "image", type: "image", showType: "image", file_class: "vision" };
  if (m.startsWith("video/")) return { filetype: "video", type: "video", showType: "video", file_class: "video" };
  if (m.startsWith("audio/")) return { filetype: "audio", type: "audio", showType: "audio", file_class: "audio" };
  // Everything else is an ordinary document: PDFs, text, office formats.
  return { filetype: "file", type: "file", showType: "file", file_class: "document" };
}

/** Upload any supported file. Images keep the exact shape they always had. */
export async function uploadFile(
  headers: (extra?: Record<string, string>) => Record<string, string>,
  base: string,
  bytes: Buffer,
  mime: string,
  originalName?: string
): Promise<QwenFileEntry> {
  const cls = classifyUpload(mime);
  const filename = originalName || `${cls.filetype}-${randomUUID().slice(0, 8)}.${extFromMime(mime)}`;

  const res = await fetch(`${base}/api/v2/files/getstsToken`, {
    method: "POST",
    headers: headers(),
    body: JSON.stringify({ filename, filesize: bytes.length, filetype: cls.filetype }),
  });
  const j: any = await res.json().catch(() => ({}));
  const sts: StsToken | undefined = j?.data;
  if (!sts?.file_url) throw new Error(`getstsToken failed: ${JSON.stringify(j).slice(0, 200)}`);

  await ossPut(sts, bytes, mime);

  return {
    type: cls.type,
    file_type: mime,
    showType: cls.showType,
    file_class: cls.file_class,
    id: sts.file_id,
    url: sts.file_url,
    name: filename,
    size: bytes.length,
    status: "success",
    progress: 100,
    greenNet: "success",
    uploadTaskId: sts.file_id,
    itemId: randomUUID(),
  };
}

export async function uploadImage(
  headers: (extra?: Record<string, string>) => Record<string, string>,
  base: string,
  bytes: Buffer,
  mime: string
): Promise<QwenFileEntry> {
  return uploadFile(headers, base, bytes, mime);
}

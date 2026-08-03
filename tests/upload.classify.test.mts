// How an upload is described to Qwen.
//
// getstsToken accepts any `filetype` string without validating it and reports no
// classification back, so these four fields are the only thing telling the model
// what it was handed. Getting them wrong fails at answer time, not upload time.

import { classifyUpload } from "../lib/upload.ts";

let passed = 0, failed = 0;
function check(name: string, cond: boolean, detail = "") {
  if (cond) passed++;
  else { failed++; console.error(`  FAIL: ${name}${detail ? ` — ${detail}` : ""}`); }
}

// 1. Images keep exactly the shape that is verified against a live completion.
//    This is a regression guard: the image path predates every other kind.
{
  const c = classifyUpload("image/png");
  check("image filetype", c.filetype === "image");
  check("image type", c.type === "image");
  check("image showType", c.showType === "image");
  check("image file_class is vision", c.file_class === "vision", c.file_class);
}

// 2. Each kind is driven by the MIME prefix, not the extension, so an unusual
//    subtype still classifies correctly.
for (const m of ["image/webp", "image/heic", "image/svg+xml"]) {
  check(`${m} is an image`, classifyUpload(m).filetype === "image");
}
for (const m of ["video/mp4", "video/quicktime", "video/x-matroska"]) {
  const c = classifyUpload(m);
  check(`${m} is video`, c.filetype === "video" && c.file_class === "video", JSON.stringify(c));
}
for (const m of ["audio/mpeg", "audio/wav", "audio/ogg"]) {
  const c = classifyUpload(m);
  check(`${m} is audio`, c.filetype === "audio" && c.file_class === "audio", JSON.stringify(c));
}

// 3. Everything else is a document. PDFs and office formats share no prefix
//    with each other, so the fallback is what has to catch them.
for (const m of ["application/pdf", "text/plain", "text/markdown", "text/csv",
                 "application/json", "application/vnd.openxmlformats-officedocument.wordprocessingml.document"]) {
  const c = classifyUpload(m);
  check(`${m} is a document`, c.filetype === "file" && c.file_class === "document", JSON.stringify(c));
}

// 4. Case and missing values must not fall through to the wrong kind. A blank
//    MIME becoming "image" would upload a PDF as a picture.
check("uppercase MIME normalises", classifyUpload("IMAGE/PNG").filetype === "image");
check("empty MIME is a document", classifyUpload("").filetype === "file");
check("undefined MIME is a document", classifyUpload(undefined as any).filetype === "file");

// 5. A prefix must be a real prefix: "imageshack/x" is not an image.
check("prefix is anchored", classifyUpload("imageshack/x").filetype === "file", JSON.stringify(classifyUpload("imageshack/x")));

// 6. type and showType always agree — they are read by different parts of the
//    upstream payload and disagreeing would render the attachment wrongly.
for (const m of ["image/png", "video/mp4", "audio/mpeg", "application/pdf"]) {
  const c = classifyUpload(m);
  check(`${m}: type matches showType`, c.type === c.showType, `${c.type} vs ${c.showType}`);
}

console.log(`upload.classify: ${passed} passed, ${failed} failed`);
if (failed) process.exit(1);

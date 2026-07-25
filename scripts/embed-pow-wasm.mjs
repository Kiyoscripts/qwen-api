// Regenerates lib/deepseek-pow-wasm-bytes.ts from sha3_wasm_bg.wasm.
// Run this if DeepSeek ships a new solver module:
//   node scripts/embed-pow-wasm.mjs
import { readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";

const src = process.argv[2] || "sha3_wasm_bg.wasm";
const bytes = readFileSync(src);
const sha = createHash("sha256").update(bytes).digest("hex");

writeFileSync(
  "lib/deepseek-pow-wasm-bytes.ts",
  `// GENERATED — do not edit by hand. Run: node scripts/embed-pow-wasm.mjs
//
// DeepSeek ships this module to solve its own PoW challenge; we run the same
// bytes rather than a reimplementation. Embedded as base64 instead of read from
// disk so it survives \`next build\` standalone tracing, where a stray .wasm in
// the repo root is not copied into the output and __dirname does not point where
// you expect.
//
// sha256: ${sha}
// bytes:  ${bytes.length}

export const POW_WASM_SHA256 = "${sha}";

export const POW_WASM_BASE64 =
  "${bytes.toString("base64")}";
`
);
console.log(`embedded ${src} (${bytes.length} bytes, sha256 ${sha})`);

// DeepSeek gates chat completion behind a proof of work: solve it, or the
// request is refused. We run DeepSeek's own solver module; the TypeScript
// implementation in deepseek-pow.ts is the fallback for when that won't load.
//
// Two things have to hold. The two implementations must agree — a wrong nonce
// is a rejected request. And the WASM must actually be the one doing the work,
// because the TypeScript search blocks the event loop for seconds at a real
// difficulty, stalling every other request the server is handling.

import { createHash } from "node:crypto";
import { readFileSync, existsSync } from "node:fs";
import { deepseekHash, solvePowAnswer, solvePowHeader, type PowChallenge } from "../lib/deepseek-pow.ts";
import { wasmDeepseekHash, wasmSolvePow } from "../lib/deepseek-pow-wasm.ts";
import { POW_WASM_SHA256, POW_WASM_BASE64 } from "../lib/deepseek-pow-wasm-bytes.ts";

let passed = 0;
let failed = 0;
function check(name: string, cond: boolean, detail = "") {
  if (cond) {
    passed++;
  } else {
    failed++;
    console.error(`  FAIL: ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

// 1. The embedded copy must be the file it was generated from. If someone drops
//    in a newer sha3_wasm_bg.wasm without re-running the embed script, the app
//    would keep silently solving with the stale one.
{
  const embedded = Buffer.from(POW_WASM_BASE64, "base64");
  check("embedded bytes match their recorded sha256", createHash("sha256").update(embedded).digest("hex") === POW_WASM_SHA256);
  if (existsSync("sha3_wasm_bg.wasm")) {
    const onDisk = readFileSync("sha3_wasm_bg.wasm");
    check(
      "embedded bytes match sha3_wasm_bg.wasm (re-run scripts/embed-pow-wasm.mjs if this fails)",
      createHash("sha256").update(onDisk).digest("hex") === POW_WASM_SHA256
    );
  }
}

// 2. Our hash must equal the reference hash. Edge cases first: the sponge rate
//    is 136 bytes, so inputs either side of it exercise the padding path that a
//    hand-written Keccak is most likely to get wrong.
{
  const inputs = [
    "",
    "a",
    "hello",
    "x".repeat(135),
    "x".repeat(136),
    "x".repeat(137),
    "x".repeat(272),
    "salt_1785000000_0",
    "café 日本語 🎉",
  ];
  for (let i = 0; i < 100; i++) inputs.push(`${Math.random().toString(36).slice(2)}_${i}`);

  let mismatches = 0;
  let example = "";
  for (const input of inputs) {
    const ours = deepseekHash(input);
    const reference = await wasmDeepseekHash(input);
    if (ours !== reference) {
      mismatches++;
      if (!example) example = `${JSON.stringify(input.slice(0, 30))}: ours=${ours} reference=${reference}`;
    }
  }
  check(`hash matches the reference on all ${inputs.length} inputs`, mismatches === 0, example);
}

/** Build a challenge whose answer we chose, the way the server does. */
async function challengeFor(answer: number, difficulty: number): Promise<PowChallenge> {
  const salt = "d3adb33f";
  const expire_at = 1785000000;
  return {
    algorithm: "DeepSeekHashV1",
    challenge: await wasmDeepseekHash(`${salt}_${expire_at}_${answer}`),
    salt,
    signature: "sig",
    difficulty,
    expire_at,
    target_path: "/api/v0/chat/completion",
  };
}

// 3. Both solvers recover the planted nonce, including the boundaries.
{
  for (const answer of [0, 1, 4242]) {
    const c = await challengeFor(answer, 10_000);
    check(`WASM recovers nonce ${answer}`, (await wasmSolvePow(c.challenge, c.salt, c.expire_at, c.difficulty)) === answer);
    check(`fallback recovers nonce ${answer}`, solvePowAnswer(c) === answer);
  }
}

// 4. The header is what goes on the wire: base64 of a specific JSON shape.
{
  const c = await challengeFor(777, 10_000);
  const header = await solvePowHeader(c);
  const decoded = JSON.parse(Buffer.from(header, "base64").toString("utf8"));
  check("header is base64-encoded JSON", typeof decoded === "object" && decoded !== null);
  check("header carries the solved answer", decoded.answer === 777, JSON.stringify(decoded.answer));
  check("header echoes the challenge", decoded.challenge === c.challenge);
  check("header echoes the signature", decoded.signature === "sig");
  check("header echoes the target path", decoded.target_path === "/api/v0/chat/completion");
  check("header names the algorithm", decoded.algorithm === "DeepSeekHashV1");
  check("header carries no extra keys", Object.keys(decoded).sort().join(",") === "algorithm,answer,challenge,salt,signature,target_path");
}

// 5. An algorithm we don't implement must be refused, not silently mis-solved.
{
  const c = await challengeFor(1, 1000);
  let threw = false;
  try {
    await solvePowHeader({ ...c, algorithm: "DeepSeekHashV2" });
  } catch {
    threw = true;
  }
  check("unknown algorithm is rejected", threw);
}

// 6. The point of the exercise: at a realistic difficulty the WASM must do the
//    work. A worst-case nonce is the honest measurement — the search is linear,
//    so a nonce near the top costs the full sweep.
//
//    Only the WASM side runs by default. Racing it against the TypeScript search
//    pegs a core for several seconds, which is a rude thing for a test suite to
//    do on every run; POW_BENCH=1 opts into the comparison.
{
  const difficulty = 144_000;
  const c = await challengeFor(143_500, difficulty);

  const wasmStart = performance.now();
  const wasmAnswer = await wasmSolvePow(c.challenge, c.salt, c.expire_at, difficulty);
  const wasmMs = performance.now() - wasmStart;

  check("WASM solves a worst-case challenge", wasmAnswer === 143_500, String(wasmAnswer));
  // Generous bound: this is here to catch the WASM silently not being used and
  // the slow fallback running instead, not to police milliseconds on a busy machine.
  check(`WASM is fast at full difficulty (${wasmMs.toFixed(0)}ms)`, wasmMs < 1500, `${wasmMs.toFixed(0)}ms`);

  if (process.env.POW_BENCH === "1") {
    const tsStart = performance.now();
    const tsAnswer = solvePowAnswer(c);
    const tsMs = performance.now() - tsStart;
    check("both solvers agree at full difficulty", tsAnswer === wasmAnswer);
    console.log(`  timing: wasm ${wasmMs.toFixed(0)}ms vs typescript ${tsMs.toFixed(0)}ms (${(tsMs / Math.max(wasmMs, 0.001)).toFixed(0)}x)`);
  }
}

console.log(`${passed} passed, ${failed} failed`);
if (failed) process.exit(1);

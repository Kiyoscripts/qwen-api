// DeepSeek's own PoW solver, run as-is.
//
// lib/deepseek-pow.ts has a from-scratch TypeScript implementation of the same
// algorithm, and it agrees with this module's hash on every input tested. It is
// simply far too slow to sit in a request path: the search is a tight
// synchronous loop over [0, difficulty], and at the difficulty DeepSeek actually
// hands out that measured ~2.2s versus ~94ms here — a 24x gap. Worse, those
// seconds block the Node event loop, so one DeepSeek request stalls every other
// request the server is serving.
//
// So this is the solver, and the TypeScript one is the fallback for the case
// where instantiation fails.

import { POW_WASM_BASE64 } from "./deepseek-pow-wasm-bytes";

// Compiled once per process; a fresh instance per solve. Compiling is the
// expensive half (~10ms), instantiating is not, and a fresh instance means the
// bump allocator below starts from zero every time instead of growing linear
// memory forever across the life of the process.
let modulePromise: Promise<WebAssembly.Module> | null = null;

function compiled(): Promise<WebAssembly.Module> {
  if (!modulePromise) {
    modulePromise = WebAssembly.compile(Buffer.from(POW_WASM_BASE64, "base64")).catch((e) => {
      modulePromise = null; // let a later request retry rather than caching the failure
      throw e;
    });
  }
  return modulePromise;
}

interface PowExports {
  memory: WebAssembly.Memory;
  wasm_solve: (ret: number, cPtr: number, cLen: number, pPtr: number, pLen: number, difficulty: number) => void;
  wasm_deepseek_hash_v1: (ret: number, ptr: number, len: number) => void;
  __wbindgen_add_to_stack_pointer: (n: number) => number;
  __wbindgen_export_0: (size: number, align: number) => number;
}

async function instance(): Promise<PowExports> {
  const inst = await WebAssembly.instantiate(await compiled(), {});
  return inst.exports as unknown as PowExports;
}

/** Copy a JS string into the module's linear memory (wasm-bindgen bump alloc). */
function write(ex: PowExports, s: string): [ptr: number, len: number] {
  const bytes = Buffer.from(s, "utf8");
  const ptr = ex.__wbindgen_export_0(bytes.length, 1);
  new Uint8Array(ex.memory.buffer, ptr, bytes.length).set(bytes);
  return [ptr, bytes.length];
}

/**
 * Recover the nonce for a challenge. Returns null if the module reports no
 * solution, so the caller can fall back rather than treating it as fatal.
 */
export async function wasmSolvePow(
  challenge: string,
  salt: string,
  expireAt: number,
  difficulty: number
): Promise<number | null> {
  const ex = await instance();
  const [cPtr, cLen] = write(ex, challenge);
  const [pPtr, pLen] = write(ex, `${salt}_${expireAt}_`);

  // wasm-bindgen returns the (status, answer) pair through a 16-byte slot
  // borrowed from the shadow stack, which must be given back either way.
  const ret = ex.__wbindgen_add_to_stack_pointer(-16);
  try {
    ex.wasm_solve(ret, cPtr, cLen, pPtr, pLen, difficulty);
    const view = new DataView(ex.memory.buffer);
    if (view.getInt32(ret, true) === 0) return null;
    const answer = view.getFloat64(ret + 8, true);
    return Number.isFinite(answer) ? answer : null;
  } finally {
    ex.__wbindgen_add_to_stack_pointer(16);
  }
}

/** The reference hash, exposed so tests can hold our implementation to it. */
export async function wasmDeepseekHash(input: string): Promise<string> {
  const ex = await instance();
  const [ptr, len] = write(ex, input);
  const ret = ex.__wbindgen_add_to_stack_pointer(-16);
  try {
    ex.wasm_deepseek_hash_v1(ret, ptr, len);
    const view = new DataView(ex.memory.buffer);
    const outPtr = view.getInt32(ret, true);
    const outLen = view.getInt32(ret + 4, true);
    return Buffer.from(new Uint8Array(ex.memory.buffer, outPtr, outLen)).toString("utf8");
  } finally {
    ex.__wbindgen_add_to_stack_pointer(16);
  }
}

// DeepSeek "DeepSeekHashV1" proof-of-work solver — pure TypeScript, no WASM.
//
// chat.deepseek.com gates /api/v0/chat/completion and /api/v0/file/upload_file
// behind a PoW. You first POST /api/v0/chat/create_pow_challenge and get back a
// challenge; you must solve it and echo the answer back in the `x-ds-pow-response`
// header (base64 of a small JSON blob) on the gated request.
//
// The algorithm is a NON-STANDARD Keccak: it runs Keccak-f[1600] for 23 rounds
// (using round constants RC[1..23], i.e. skipping the very first round) with SHA3
// domain padding (0x06). Standard SHA3-256/Keccak-256 use 24 rounds, which is why
// every off-the-shelf hash library fails and the public solvers all ship a WASM
// blob. It is ALTCHA-style: the server hides a secret `answer` in [0, difficulty]
// and publishes `challenge = keccak23("{salt}_{expire_at}_{answer}")`; we recover
// `answer` by brute force. difficulty ~144000, so worst case is < 1s of hashing.
//
// Verified against a live-captured challenge (recovered the exact nonce the real
// web client produced), cross-checked against a BigInt reference and against
// Node's built-in sha3-256 for the standard 24-round case.

// Round constants, split into hi/lo 32-bit halves (RC[0..23]).
const RC_HI = [
  0x00000000, 0x00000000, 0x80000000, 0x80000000, 0x00000000, 0x00000000, 0x80000000, 0x80000000,
  0x00000000, 0x00000000, 0x00000000, 0x00000000, 0x00000000, 0x80000000, 0x80000000, 0x80000000,
  0x80000000, 0x80000000, 0x00000000, 0x80000000, 0x80000000, 0x80000000, 0x00000000, 0x80000000,
];
const RC_LO = [
  0x00000001, 0x00008082, 0x0000808a, 0x80008000, 0x0000808b, 0x80000001, 0x80008081, 0x00008009,
  0x0000008a, 0x00000088, 0x80008009, 0x8000000a, 0x8000808b, 0x0000008b, 0x00008089, 0x00008003,
  0x00008002, 0x00000080, 0x0000800a, 0x8000000a, 0x80008081, 0x00008080, 0x80000001, 0x80008008,
];

// rotation offsets r[x][y]
const R = [
  [0, 36, 3, 41, 18],
  [1, 44, 10, 45, 2],
  [62, 6, 43, 15, 61],
  [28, 55, 25, 21, 56],
  [27, 20, 39, 8, 14],
];
const at = (x: number, y: number) => x + 5 * y;

// In-place Keccak-f[1600] on a 25-lane state held as parallel lo/hi 32-bit arrays.
function keccakF(lo: number[], hi: number[], rounds: number, startRC: number): void {
  const Clo = new Array<number>(5),
    Chi = new Array<number>(5),
    Dlo = new Array<number>(5),
    Dhi = new Array<number>(5),
    Blo = new Array<number>(25),
    Bhi = new Array<number>(25);
  for (let r = 0; r < rounds; r++) {
    const rc = startRC + r;
    // theta
    for (let x = 0; x < 5; x++) {
      Clo[x] = lo[at(x, 0)] ^ lo[at(x, 1)] ^ lo[at(x, 2)] ^ lo[at(x, 3)] ^ lo[at(x, 4)];
      Chi[x] = hi[at(x, 0)] ^ hi[at(x, 1)] ^ hi[at(x, 2)] ^ hi[at(x, 3)] ^ hi[at(x, 4)];
    }
    for (let x = 0; x < 5; x++) {
      const x1 = (x + 1) % 5,
        x4 = (x + 4) % 5;
      const rlo = ((Clo[x1] << 1) | (Chi[x1] >>> 31)) >>> 0;
      const rhi = ((Chi[x1] << 1) | (Clo[x1] >>> 31)) >>> 0;
      Dlo[x] = (Clo[x4] ^ rlo) >>> 0;
      Dhi[x] = (Chi[x4] ^ rhi) >>> 0;
    }
    for (let x = 0; x < 5; x++)
      for (let y = 0; y < 5; y++) {
        lo[at(x, y)] = (lo[at(x, y)] ^ Dlo[x]) >>> 0;
        hi[at(x, y)] = (hi[at(x, y)] ^ Dhi[x]) >>> 0;
      }
    // rho + pi
    for (let x = 0; x < 5; x++)
      for (let y = 0; y < 5; y++) {
        const n = R[x][y];
        const from = at(x, y);
        const to = at(y, (2 * x + 3 * y) % 5);
        const alo = lo[from],
          ahi = hi[from];
        let tlo: number, thi: number;
        if (n === 0) {
          tlo = alo;
          thi = ahi;
        } else if (n < 32) {
          tlo = ((alo << n) | (ahi >>> (32 - n))) >>> 0;
          thi = ((ahi << n) | (alo >>> (32 - n))) >>> 0;
        } else if (n === 32) {
          tlo = ahi;
          thi = alo;
        } else {
          const m = n - 32;
          tlo = ((ahi << m) | (alo >>> (32 - m))) >>> 0;
          thi = ((alo << m) | (ahi >>> (32 - m))) >>> 0;
        }
        Blo[to] = tlo;
        Bhi[to] = thi;
      }
    // chi
    for (let x = 0; x < 5; x++)
      for (let y = 0; y < 5; y++) {
        const x1 = (x + 1) % 5,
          x2 = (x + 2) % 5;
        lo[at(x, y)] = (Blo[at(x, y)] ^ (~Blo[at(x1, y)] & Blo[at(x2, y)])) >>> 0;
        hi[at(x, y)] = (Bhi[at(x, y)] ^ (~Bhi[at(x1, y)] & Bhi[at(x2, y)])) >>> 0;
      }
    // iota
    lo[0] = (lo[0] ^ RC_LO[rc]) >>> 0;
    hi[0] = (hi[0] ^ RC_HI[rc]) >>> 0;
  }
}

// Keccak digest (hex) with a configurable round count / starting round constant /
// domain-padding byte. rate = 136 bytes (256-bit capacity), output = 32 bytes.
function keccakHex(msgBytes: Uint8Array, rounds: number, startRC: number, padByte: number): string {
  const rate = 136;
  const len = msgBytes.length;
  const padLen = rate - (len % rate);
  const padded = new Uint8Array(len + padLen);
  padded.set(msgBytes);
  padded[len] = padByte;
  padded[padded.length - 1] |= 0x80;
  const lo = new Array<number>(25).fill(0);
  const hi = new Array<number>(25).fill(0);
  for (let off = 0; off < padded.length; off += rate) {
    for (let i = 0; i < rate; i++) {
      const li = i >> 3;
      const b = padded[off + i];
      if ((i & 7) < 4) lo[li] = (lo[li] ^ (b << ((i & 7) * 8))) >>> 0;
      else hi[li] = (hi[li] ^ (b << (((i & 7) - 4) * 8))) >>> 0;
    }
    keccakF(lo, hi, rounds, startRC);
  }
  let out = "";
  for (let i = 0; i < 32; i++) {
    const li = i >> 3;
    const within = i & 7;
    const word = within < 4 ? lo[li] : hi[li];
    const byte = (word >>> ((within & 3) * 8)) & 0xff;
    out += byte.toString(16).padStart(2, "0");
  }
  return out;
}

// The DeepSeekHashV1 hash of a string: 23 rounds, RC start index 1, SHA3 padding.
export function deepseekHash(input: string): string {
  return keccakHex(Buffer.from(input, "utf8"), 23, 1, 0x06);
}

export interface PowChallenge {
  algorithm: string;
  challenge: string;
  salt: string;
  signature: string;
  difficulty: number;
  expire_at: number;
  target_path: string;
}

// Recover the hidden nonce for a challenge by brute force over [0, difficulty].
export function solvePowAnswer(c: PowChallenge): number {
  const prefix = `${c.salt}_${c.expire_at}_`;
  const max = c.difficulty > 0 ? c.difficulty : 1_000_000;
  for (let nonce = 0; nonce <= max; nonce++) {
    if (deepseekHash(prefix + nonce) === c.challenge) return nonce;
  }
  throw new Error("DeepSeek PoW: no answer found within difficulty range");
}

// Solve a challenge and produce the value for the `x-ds-pow-response` header:
// base64 of {algorithm, challenge, salt, answer, signature, target_path}.
export function solvePowHeader(c: PowChallenge): string {
  if (c.algorithm && c.algorithm !== "DeepSeekHashV1") {
    throw new Error(`DeepSeek PoW: unsupported algorithm '${c.algorithm}'`);
  }
  const answer = solvePowAnswer(c);
  const payload = {
    algorithm: c.algorithm || "DeepSeekHashV1",
    challenge: c.challenge,
    salt: c.salt,
    answer,
    signature: c.signature,
    target_path: c.target_path,
  };
  return Buffer.from(JSON.stringify(payload), "utf8").toString("base64");
}

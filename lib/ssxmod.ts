// SSXMOD fingerprint cookies for chat.qwen.ai anti-bot (WAF/baxia).
//
// Ported from angyedz/QwenFreeApi (and the Rfym21/Qwen2API reverse-engineered
// reference it cites). Alibaba treats ssxmod_itna / ssxmod_itna2 as a device
// fingerprint: 37 fields → LZW → custom base64 → "1-<encoded>". Without these
// cookies, chat.qwen.ai frequently returns FAIL_SYS_USER_VALIDATE / captcha
// HTML instead of a real completion.

// --- fingerprint (37 fields, '^'-joined) ------------------------------------

const DEFAULT_TEMPLATE = {
  deviceId: "84985177a19a010dea49",
  sdkVersion: "websdk-2.3.15d",
  initTimestamp: "1765348410850",
  field3: "91",
  field4: "1|15",
  language: "zh-CN",
  timezoneOffset: "-480",
  colorDepth: "16705151|12791",
  screenInfo: "1470|956|283|797|158|0|1470|956|1470|798|0|0",
  field9: "5",
  platform: "MacIntel",
  field11: "10",
  webglRenderer:
    "ANGLE (Apple, ANGLE Metal Renderer: Apple M4, Unspecified Version)|Google Inc. (Apple)",
  field13: "30|30",
  field14: "0",
  field15: "28",
  pluginCount: "5",
  vendor: "Google Inc.",
  field29: "8",
  touchInfo: "-1|0|0|0|0",
  field32: "11",
  field35: "0",
  mode: "P",
};

const PLATFORM_PRESETS: Record<string, Partial<typeof DEFAULT_TEMPLATE>> = {
  macIntel: {
    platform: "MacIntel",
    webglRenderer:
      "ANGLE (Apple, ANGLE Metal Renderer: Apple M4, Unspecified Version)|Google Inc. (Apple)",
    vendor: "Google Inc.",
  },
  macM1: {
    platform: "MacIntel",
    webglRenderer:
      "ANGLE (Apple, ANGLE Metal Renderer: Apple M1, Unspecified Version)|Google Inc. (Apple)",
    vendor: "Google Inc.",
  },
  win64: {
    platform: "Win32",
    webglRenderer:
      "ANGLE (NVIDIA, NVIDIA GeForce RTX 3080 Direct3D11 vs_5_0 ps_5_0, D3D11)|Google Inc. (NVIDIA)",
    vendor: "Google Inc.",
  },
  linux: {
    platform: "Linux x86_64",
    webglRenderer: "ANGLE (Intel, Mesa Intel(R) UHD Graphics 630, OpenGL 4.6)|Google Inc. (Intel)",
    vendor: "Google Inc.",
  },
};

const SCREEN_PRESETS: Record<string, string> = {
  "1920x1080": "1920|1080|283|1080|158|0|1920|1080|1920|922|0|0",
  "2560x1440": "2560|1440|283|1440|158|0|2560|1440|2560|1282|0|0",
  "1470x956": "1470|956|283|797|158|0|1470|956|1470|798|0|0",
  "1440x900": "1440|900|283|900|158|0|1440|900|1440|742|0|0",
  "1536x864": "1536|864|283|864|158|0|1536|864|1536|706|0|0",
};

const LANGUAGE_PRESETS: Record<string, { language: string; timezoneOffset: string }> = {
  "zh-CN": { language: "zh-CN", timezoneOffset: "-480" },
  "zh-TW": { language: "zh-TW", timezoneOffset: "-480" },
  "en-US": { language: "en-US", timezoneOffset: "480" },
  "ja-JP": { language: "ja-JP", timezoneOffset: "-540" },
  "ko-KR": { language: "ko-KR", timezoneOffset: "-540" },
};

export interface FingerprintOpts {
  platform?: keyof typeof PLATFORM_PRESETS | string;
  screen?: keyof typeof SCREEN_PRESETS | string;
  locale?: keyof typeof LANGUAGE_PRESETS | string;
  deviceId?: string;
  custom?: Partial<typeof DEFAULT_TEMPLATE>;
}

const generateDeviceId = () =>
  Array.from({ length: 20 }, () => Math.floor(Math.random() * 16).toString(16)).join("");

const generateHash = () => Math.floor(Math.random() * 4294967296);

export function generateFingerprint(options: FingerprintOpts = {}): string {
  const config = { ...DEFAULT_TEMPLATE };
  if (options.platform && PLATFORM_PRESETS[options.platform]) {
    Object.assign(config, PLATFORM_PRESETS[options.platform]);
  }
  if (options.screen && SCREEN_PRESETS[options.screen]) {
    config.screenInfo = SCREEN_PRESETS[options.screen];
  }
  if (options.locale && LANGUAGE_PRESETS[options.locale]) {
    Object.assign(config, LANGUAGE_PRESETS[options.locale]);
  }
  if (options.custom) Object.assign(config, options.custom);

  const deviceId = options.deviceId || generateDeviceId();
  const currentTimestamp = Date.now();

  const fields: Array<string | number> = [
    deviceId, // 0
    config.sdkVersion, // 1
    config.initTimestamp, // 2
    config.field3, // 3
    config.field4, // 4
    config.language, // 5
    config.timezoneOffset, // 6
    config.colorDepth, // 7
    config.screenInfo, // 8
    config.field9, // 9
    config.platform, // 10
    config.field11, // 11
    config.webglRenderer, // 12
    config.field13, // 13
    config.field14, // 14
    config.field15, // 15
    `${config.pluginCount}|${generateHash()}`, // 16
    generateHash(), // 17 canvas
    generateHash(), // 18 ua hash1
    "1", // 19
    "0", // 20
    "1", // 21
    "0", // 22
    config.mode, // 23
    "0", // 24
    "0", // 25
    "0", // 26
    "416", // 27
    config.vendor, // 28
    config.field29, // 29
    config.touchInfo, // 30
    generateHash(), // 31 ua hash2
    config.field32, // 32
    currentTimestamp, // 33
    generateHash(), // 34 url hash
    config.field35, // 35
    Math.floor(Math.random() * 91) + 10, // 36 doc hash
  ];

  return fields.join("^");
}

// --- LZW + custom base64 (SSXMOD encoding) ----------------------------------

// Positions whose hash values are randomized on each cookie mint (not verified
// for content — only structure).
const HASH_FIELDS: Record<number, "split" | "full"> = {
  16: "split", // plugins hash (count|hash)
  17: "full", // canvas
  18: "full", // UA hash1
  31: "full", // UA hash2
  34: "full", // URL hash
  36: "full", // doc hash
};

const CUSTOM_BASE64_CHARS = "DGi0YA7BemWnQjCl4_bR3f8SKIF9tUz/xhr2oEOgPpac=61ZqwTudLkM5vHyNXsVJ";

function lzwCompress(data: string, bits: number, charFunc: (index: number) => string): string {
  if (data == null) return "";

  const dict: Record<string, number> = {};
  const dictToCreate: Record<string, boolean> = {};
  let w = "";
  let enlargeIn = 2;
  let dictSize = 3;
  let numBits = 2;
  const result: string[] = [];
  let value = 0;
  let position = 0;

  const pushBits = (bitCount: number, fill: number) => {
    for (let j = 0; j < bitCount; j++) {
      value = (value << 1) | (fill & 1);
      if (position === bits - 1) {
        position = 0;
        result.push(charFunc(value));
        value = 0;
      } else {
        position++;
      }
      fill >>= 1;
    }
  };

  for (let i = 0; i < data.length; i++) {
    const c = data.charAt(i);
    if (!Object.prototype.hasOwnProperty.call(dict, c)) {
      dict[c] = dictSize++;
      dictToCreate[c] = true;
    }

    const wc = w + c;
    if (Object.prototype.hasOwnProperty.call(dict, wc)) {
      w = wc;
    } else {
      if (Object.prototype.hasOwnProperty.call(dictToCreate, w)) {
        if (w.charCodeAt(0) < 256) {
          pushBits(numBits, 0);
          pushBits(8, w.charCodeAt(0));
        } else {
          pushBits(numBits, 1);
          pushBits(16, w.charCodeAt(0));
        }
        enlargeIn--;
        if (enlargeIn === 0) {
          enlargeIn = Math.pow(2, numBits);
          numBits++;
        }
        delete dictToCreate[w];
      } else {
        pushBits(numBits, dict[w]);
      }

      enlargeIn--;
      if (enlargeIn === 0) {
        enlargeIn = Math.pow(2, numBits);
        numBits++;
      }

      dict[wc] = dictSize++;
      w = String(c);
    }
  }

  if (w !== "") {
    if (Object.prototype.hasOwnProperty.call(dictToCreate, w)) {
      if (w.charCodeAt(0) < 256) {
        pushBits(numBits, 0);
        pushBits(8, w.charCodeAt(0));
      } else {
        pushBits(numBits, 1);
        pushBits(16, w.charCodeAt(0));
      }
      enlargeIn--;
      if (enlargeIn === 0) {
        enlargeIn = Math.pow(2, numBits);
        numBits++;
      }
      delete dictToCreate[w];
    } else {
      pushBits(numBits, dict[w]);
    }
    enlargeIn--;
    if (enlargeIn === 0) {
      enlargeIn = Math.pow(2, numBits);
      numBits++;
    }
  }

  // End of stream
  pushBits(numBits, 2);
  while (true) {
    value = value << 1;
    if (position === bits - 1) {
      result.push(charFunc(value));
      break;
    }
    position++;
  }

  return result.join("");
}

function customEncode(data: string, urlSafe: boolean): string {
  if (data == null) return "";
  const compressed = lzwCompress(data, 6, (index) => CUSTOM_BASE64_CHARS.charAt(index));
  if (!urlSafe) {
    switch (compressed.length % 4) {
      case 1:
        return compressed + "===";
      case 2:
        return compressed + "==";
      case 3:
        return compressed + "=";
      default:
        return compressed;
    }
  }
  return compressed;
}

const randomHash = () => Math.floor(Math.random() * 4294967296);

function processFields(fields: string[]): Array<string | number> {
  const processed: Array<string | number> = [...fields];
  const currentTimestamp = Date.now();

  for (const [index, type] of Object.entries(HASH_FIELDS)) {
    const idx = parseInt(index, 10);
    if (type === "split") {
      const parts = String(processed[idx]).split("|");
      if (parts.length === 2) {
        processed[idx] = `${parts[0]}|${randomHash()}`;
      }
    } else if (type === "full") {
      if (idx === 36) {
        processed[idx] = Math.floor(Math.random() * 91) + 10;
      } else {
        processed[idx] = randomHash();
      }
    }
  }

  processed[33] = currentTimestamp;
  return processed;
}

export interface SsxmodCookies {
  ssxmod_itna: string;
  ssxmod_itna2: string;
  timestamp: number;
  deviceId: string;
}

/**
 * Mint a fresh ssxmod_itna / ssxmod_itna2 pair.
 * Optionally pass a prebuilt 37-field fingerprint string.
 */
export function generateCookies(fingerprint: string | null = null, opts: FingerprintOpts = {}): SsxmodCookies {
  const fp = fingerprint || generateFingerprint(opts);
  const fields = fp.split("^");
  const processed = processFields(fields);

  const itnaData = processed.join("^");
  const ssxmod_itna = "1-" + customEncode(itnaData, true);

  // itna2 is an 18-field subset of the full fingerprint.
  const itna2Data = [
    processed[0], // deviceId
    processed[1], // sdkVersion
    processed[23], // mode
    0,
    "",
    0,
    "",
    "",
    0,
    0,
    0,
    processed[32],
    processed[33], // timestamp
    0,
    0,
    0,
    0,
    0,
  ].join("^");
  const ssxmod_itna2 = "1-" + customEncode(itna2Data, true);

  return {
    ssxmod_itna,
    ssxmod_itna2,
    timestamp: parseInt(String(processed[33]), 10),
    deviceId: String(processed[0]),
  };
}

// --- manager (cached rotation every 15 min) ---------------------------------

const REFRESH_INTERVAL = 15 * 60 * 1000;

let current: SsxmodCookies & { at: number } = {
  ssxmod_itna: "",
  ssxmod_itna2: "",
  timestamp: 0,
  deviceId: "",
  at: 0,
};

function refresh(): void {
  try {
    const next = generateCookies(null, { platform: "win64", screen: "1920x1080", locale: "zh-CN" });
    current = { ...next, at: Date.now() };
  } catch {
    // Keep the previous pair if minting fails — empty cookies are worse.
  }
}

function ensureFresh(): void {
  if (!current.ssxmod_itna || Date.now() - current.at >= REFRESH_INTERVAL) {
    refresh();
  }
}

/** Current ssxmod_itna cookie value (refreshed on demand). */
export function getSsxmodItna(): string {
  ensureFresh();
  return current.ssxmod_itna;
}

/** Current ssxmod_itna2 cookie value (refreshed on demand). */
export function getSsxmodItna2(): string {
  ensureFresh();
  return current.ssxmod_itna2;
}

/**
 * Build the Cookie header Qwen's WAF expects:
 *   token=<jwt>; ssxmod_itna=...; ssxmod_itna2=...
 *
 * Extra name=value pairs (from a browser capture) can be appended via
 * QWEN_EXTRA_COOKIES — useful if baxia sets additional session cookies.
 */
export function buildQwenCookieHeader(token: string, extraCookies?: string): string {
  ensureFresh();
  const parts: string[] = [];
  if (token) parts.push(`token=${token}`);
  if (current.ssxmod_itna) parts.push(`ssxmod_itna=${current.ssxmod_itna}`);
  if (current.ssxmod_itna2) parts.push(`ssxmod_itna2=${current.ssxmod_itna2}`);
  const extra = (extraCookies ?? process.env.QWEN_EXTRA_COOKIES ?? "").trim();
  if (extra) {
    // Drop anything that would collide with the cookies we already set.
    for (const piece of extra.split(";")) {
      const p = piece.trim();
      if (!p) continue;
      const name = p.split("=")[0]?.trim().toLowerCase();
      if (!name || name === "token" || name.startsWith("ssxmod")) continue;
      parts.push(p);
    }
  }
  return parts.join("; ");
}

/** Force a re-mint (e.g. after a WAF challenge). */
export function rotateSsxmod(): void {
  refresh();
}

// Translation completeness.
//
// English is merged underneath every locale, so a missing key renders in English
// rather than blank — which is the right runtime behaviour but also means a gap
// is invisible in the browser. This test is what makes it visible: it fails the
// build with the exact list of keys a locale is short.
//
// It also guards the other direction. A key deleted from en.ts but left behind
// in eleven translations is dead weight that silently accumulates, and a typo'd
// key name in a translation would otherwise sit there doing nothing forever.

import { en } from "../lib/locales/en.ts";
import { LOCALES, type LocaleCode } from "../lib/i18n.ts";
import { dictFor, translator } from "../lib/dict.ts";

import { es } from "../lib/locales/es.ts";
import { fr } from "../lib/locales/fr.ts";
import { de } from "../lib/locales/de.ts";
import { pt } from "../lib/locales/pt.ts";
import { ru } from "../lib/locales/ru.ts";
import { ja } from "../lib/locales/ja.ts";
import { ko } from "../lib/locales/ko.ts";
import { zh } from "../lib/locales/zh.ts";
import { ar } from "../lib/locales/ar.ts";
import { hi } from "../lib/locales/hi.ts";
import { tr } from "../lib/locales/tr.ts";

const FILES: Record<string, Record<string, string>> = { es, fr, de, pt, ru, ja, ko, zh, ar, hi, tr };

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

const enKeys = Object.keys(en);

// 1. Every locale covers every English key.
for (const [code, dict] of Object.entries(FILES)) {
  const missing = enKeys.filter((k) => !(k in dict));
  check(`${code}: no missing keys`, missing.length === 0, missing.slice(0, 8).join(", ") + (missing.length > 8 ? ` (+${missing.length - 8})` : ""));

  const extra = Object.keys(dict).filter((k) => !(k in en));
  check(`${code}: no orphaned keys`, extra.length === 0, extra.join(", "));
}

// 2. Every locale in the picker actually has a dictionary — otherwise the entry
//    is selectable and silently does nothing.
for (const l of LOCALES) {
  if (l.code === "en") continue;
  check(`${l.code} is wired into dict.ts`, Object.keys(dictFor(l.code as LocaleCode)).length === enKeys.length);
}
check("picker lists 12 locales", LOCALES.length === 12, String(LOCALES.length));
check("exactly one RTL locale (ar)", LOCALES.filter((l) => l.dir === "rtl").map((l) => l.code).join() === "ar");

// 3. Placeholders must survive translation. A dropped {count} or {model} leaves
//    a sentence with a hole in it that no type check would catch.
const PLACEHOLDER = /\{(\w+)\}/g;
for (const [code, dict] of Object.entries(FILES)) {
  for (const key of enKeys) {
    const want = [...(en as Record<string, string>)[key].matchAll(PLACEHOLDER)].map((m) => m[1]).sort();
    if (!want.length) continue;
    const got = [...(dict[key] ?? "").matchAll(PLACEHOLDER)].map((m) => m[1]).sort();
    check(`${code}.${key} keeps {${want.join("},{")}}`, want.join() === got.join(), `got {${got.join("},{")}}`);
  }
}

// 4. The formatter substitutes, and leaves an unknown placeholder visible rather
//    than deleting the text around it.
{
  const t = translator("es");
  check("substitutes a var", t("models_title", { count: 30 }).includes("30"));
  check("unknown placeholder is left intact", translator("en")("chat_attach_unsupported", {}).includes("{model}"));
  check("falls back to English for an unfilled locale", typeof translator("ar")("pg_temperature") === "string");
}

console.log(`i18n: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);

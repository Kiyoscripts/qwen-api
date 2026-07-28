// UI localisation.
//
// The locale lives in a COOKIE, not just localStorage. The homepage, /models and
// the layout are server components: they render before any client code runs, so
// a localStorage-only choice would render English on the server and then swap
// after hydration — a visible flash on every navigation. A cookie is readable in
// both places, so the server renders the right language first time.
//
// localStorage is still written alongside it, purely so the pre-paint script can
// set <html lang/dir> before first paint (a cookie needs a round trip to matter,
// and RTL flipping after paint is far more jarring than a colour theme flipping).
//
// Every dictionary is Partial<Dict>: a missing key falls back to English rather
// than rendering blank, so a half-finished translation degrades to a mixed page
// instead of a broken one. Adding a language is one file plus one LOCALES entry.

import { en } from "./locales/en";

export const LOCALE_COOKIE = "qwen_locale";
export const LOCALE_STORE = "qwen_locale";

// Keys come from `en` (so a typo in a t() call is a compile error), but the
// value type is widened to string. `en` is `as const`, and inheriting those
// literal types would demand every translation be character-identical to the
// English — which is the opposite of the point.
export type Dict = { [K in keyof typeof en]: string };
export type LocaleCode =
  | "en" | "es" | "fr" | "de" | "pt" | "ru"
  | "ja" | "ko" | "zh" | "ar" | "hi" | "tr";

export interface LocaleMeta {
  code: LocaleCode;
  /** Endonym — a language is easiest to find written in itself. */
  native: string;
  english: string;
  dir: "ltr" | "rtl";
}

export const LOCALES: LocaleMeta[] = [
  { code: "en", native: "English", english: "English", dir: "ltr" },
  { code: "es", native: "Español", english: "Spanish", dir: "ltr" },
  { code: "fr", native: "Français", english: "French", dir: "ltr" },
  { code: "de", native: "Deutsch", english: "German", dir: "ltr" },
  { code: "pt", native: "Português", english: "Portuguese", dir: "ltr" },
  { code: "ru", native: "Русский", english: "Russian", dir: "ltr" },
  { code: "ja", native: "日本語", english: "Japanese", dir: "ltr" },
  { code: "ko", native: "한국어", english: "Korean", dir: "ltr" },
  { code: "zh", native: "中文", english: "Chinese", dir: "ltr" },
  { code: "ar", native: "العربية", english: "Arabic", dir: "rtl" },
  { code: "hi", native: "हिन्दी", english: "Hindi", dir: "ltr" },
  { code: "tr", native: "Türkçe", english: "Turkish", dir: "ltr" },
];

export const DEFAULT_LOCALE: LocaleCode = "en";

export function isLocale(v: unknown): v is LocaleCode {
  return typeof v === "string" && LOCALES.some((l) => l.code === v);
}

export function localeMeta(code: LocaleCode): LocaleMeta {
  return LOCALES.find((l) => l.code === code) ?? LOCALES[0];
}

export function dirFor(code: LocaleCode): "ltr" | "rtl" {
  return localeMeta(code).dir;
}

/**
 * Best locale for an Accept-Language header, used only when nobody has chosen
 * yet. Matches on the primary subtag, so "pt-BR" and "zh-Hans" both land.
 */
export function localeFromAcceptLanguage(header: string | null): LocaleCode | null {
  if (!header) return null;
  for (const part of header.split(",")) {
    const tag = part.split(";")[0].trim().toLowerCase();
    if (!tag) continue;
    if (isLocale(tag)) return tag;
    const primary = tag.split("-")[0];
    if (isLocale(primary)) return primary;
  }
  return null;
}

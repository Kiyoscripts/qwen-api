// Dictionary lookup + the t() formatter.
//
// Split from i18n.ts so the locale metadata stays importable without pulling
// every translation file into whatever bundle touches it.

import { en } from "./locales/en";
import { es } from "./locales/es";
import { fr } from "./locales/fr";
import { de } from "./locales/de";
import { pt } from "./locales/pt";
import { ru } from "./locales/ru";
import { ja } from "./locales/ja";
import { ko } from "./locales/ko";
import { zh } from "./locales/zh";
import { ar } from "./locales/ar";
import { hi } from "./locales/hi";
import { tr } from "./locales/tr";
import { DEFAULT_LOCALE, type Dict, type LocaleCode } from "./i18n";

const DICTS: Record<LocaleCode, Partial<Dict>> = { en, es, fr, de, pt, ru, ja, ko, zh, ar, hi, tr };

export type Translator = (key: keyof Dict, vars?: Record<string, string | number>) => string;

/**
 * Build a translator for a locale.
 *
 * English is merged underneath every locale rather than consulted on a miss, so
 * a lookup is one property read and a partially translated file renders a mixed
 * page instead of blanks. `{name}` placeholders are substituted; an unknown
 * placeholder is left as-is, which shows up in review rather than silently
 * deleting text.
 */
export function translator(locale: LocaleCode): Translator {
  const dict = { ...en, ...(DICTS[locale] ?? DICTS[DEFAULT_LOCALE]) } as Dict;
  return (key, vars) => {
    const raw = (dict[key] ?? en[key] ?? String(key)) as string;
    if (!vars) return raw;
    return raw.replace(/\{(\w+)\}/g, (m, k) => (k in vars ? String(vars[k]) : m));
  };
}

export function dictFor(locale: LocaleCode): Dict {
  return { ...en, ...(DICTS[locale] ?? {}) } as Dict;
}

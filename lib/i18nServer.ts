// Server-side locale resolution. Import only from server components / routes —
// `next/headers` is not available in the browser.

import { cookies, headers } from "next/headers";
import { DEFAULT_LOCALE, LOCALE_COOKIE, isLocale, localeFromAcceptLanguage, type LocaleCode } from "./i18n";
import { dictFor, translator, type Translator } from "./dict";
import type { Dict } from "./i18n";

/**
 * The locale for this request.
 *
 * An explicit choice (cookie) always wins. Otherwise Accept-Language is used, so
 * a first-time visitor lands in their own language without having to find the
 * picker — but only as a guess, and choosing anything in the picker pins it.
 */
export async function getLocale(): Promise<LocaleCode> {
  const jar = await cookies();
  const chosen = jar.get(LOCALE_COOKIE)?.value;
  if (isLocale(chosen)) return chosen;

  const h = await headers();
  return localeFromAcceptLanguage(h.get("accept-language")) ?? DEFAULT_LOCALE;
}

export async function getT(): Promise<Translator> {
  return translator(await getLocale());
}

export async function getDict(): Promise<Dict> {
  return dictFor(await getLocale());
}

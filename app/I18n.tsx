"use client";

import { createContext, useContext, useMemo } from "react";
import { translator, type Translator } from "@/lib/dict";
import { DEFAULT_LOCALE, type LocaleCode } from "@/lib/i18n";

// The locale is resolved on the server (see lib/i18nServer.ts) and handed down
// through this provider, so client components read the same value the server
// rendered with. Nothing here re-derives it from localStorage — that is what
// would reintroduce a hydration mismatch.
const Ctx = createContext<{ locale: LocaleCode; t: Translator }>({
  locale: DEFAULT_LOCALE,
  t: translator(DEFAULT_LOCALE),
});

export function I18nProvider({ locale, children }: { locale: LocaleCode; children: React.ReactNode }) {
  const value = useMemo(() => ({ locale, t: translator(locale) }), [locale]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

/** Translator for client components. Server components use getT() instead. */
export function useT(): Translator {
  return useContext(Ctx).t;
}

export function useLocale(): LocaleCode {
  return useContext(Ctx).locale;
}

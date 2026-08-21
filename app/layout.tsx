import type { Metadata } from "next";
import { headers } from "next/headers";
import "highlight.js/styles/github-dark.css";
import "./syde.css";
import { I18nProvider } from "./I18n";
import { getLocale } from "@/lib/i18nServer";
import { dirFor } from "@/lib/i18n";

export const metadata: Metadata = {
  title: "Syde",
  description: "OpenAI-compatible API for qwen3.8-max, with vision, image, video and speech.",
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  // Resolved server-side from the cookie (falling back to Accept-Language), so
  // the first HTML the browser receives is already in the right language and
  // direction — no post-hydration swap, and no RTL flip after paint.
  const locale = await getLocale();
  const dir = dirFor(locale);
  const nonce = (await headers()).get("x-nonce") ?? undefined;

  return (
    <html lang={locale} dir={dir} suppressHydrationWarning>
      <head>
        {/* Applies the stored theme before first paint. Without this the page
            renders in the default and repaints once hydration runs, which is a
            visible flash on every navigation. */}
        <script
          nonce={nonce}
          suppressHydrationWarning
          dangerouslySetInnerHTML={{
            __html:
              // Reads the same key the nav writes. It read `qwen_theme` while
              // the nav stored `theme`, so a chosen theme never survived a
              // reload until hydration repainted it.
              "try{var t=localStorage.getItem('theme')||" +
              "(matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light');" +
              "document.documentElement.setAttribute('data-theme',t);}catch(e){}",
          }}
        />
      </head>
      <body>
        <I18nProvider locale={locale}>
          {children}
        </I18nProvider>
      </body>
    </html>
  );
}

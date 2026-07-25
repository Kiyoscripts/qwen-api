import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "highlight.js/styles/github-dark.css";
import "./theme.css";
import "./globals.css";
import Cursor from "./Cursor";
import Sheen from "./Sheen";

const geist = Geist({ subsets: ["latin"], variable: "--font-sans", display: "swap" });
const geistMono = Geist_Mono({ subsets: ["latin"], variable: "--font-mono", display: "swap" });

export const metadata: Metadata = {
  title: "Qwen3.8 API",
  description: "OpenAI-compatible API for qwen3.8-max-preview, with vision, image, video and speech.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${geist.variable} ${geistMono.variable}`} suppressHydrationWarning>
      <head>
        {/* Applies the stored theme before first paint. Without this the page
            renders in the default and repaints once hydration runs, which is a
            visible flash on every navigation. */}
        <script
          dangerouslySetInnerHTML={{
            __html:
              "try{var t=localStorage.getItem('qwen_theme');" +
              "if(t)document.documentElement.setAttribute('data-theme',t);}catch(e){}",
          }}
        />
      </head>
      <body>
        {children}
        <Cursor />
        <Sheen />
      </body>
    </html>
  );
}

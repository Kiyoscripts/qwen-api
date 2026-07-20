import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Qwen3.8 API",
  description: "OpenAI-compatible API for qwen3.8-max-preview, with vision.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}

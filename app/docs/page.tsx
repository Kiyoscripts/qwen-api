import { Shell } from "../Shell";
import { DocsBody } from "../DocsBody";
import { DocsAssistant } from "../DocsAssistant";
import { headers } from "next/headers";
import { ApiExplorer } from "../ApiExplorer";
import { getSetting } from "@/lib/settings";

export const runtime = "nodejs";

export const metadata = {
  title: "Docs · Syde",
  description: "Full reference for Syde: chat, streaming, vision, tools, image, video and speech.",
};

export default async function DocsPage() {
  const requestHeaders = await headers();
  const host = requestHeaders.get("x-forwarded-host") || requestHeaders.get("host") || "localhost:3000";
  const protocol = requestHeaders.get("x-forwarded-proto") || (host.startsWith("localhost") ? "http" : "https");
  const configured = await getSetting("documentation");
  const baseUrl = configured.base_url.trim().replace(/\/$/, "") || `${protocol}://${host}`;

  return (
    <Shell footer={false}>
      <DocsBody baseUrl={baseUrl} />
      <ApiExplorer baseUrl={baseUrl} />
      <DocsAssistant />
    </Shell>
  );
}

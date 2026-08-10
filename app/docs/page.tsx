import { Shell } from "../Shell";
import { DocsBody } from "../DocsBody";
import { DocsAssistant } from "../DocsAssistant";

export const runtime = "nodejs";

export const metadata = {
  title: "Docs · Syde",
  description: "Full reference for Syde: chat, streaming, vision, tools, image, video and speech.",
};

export default function DocsPage() {
  return (
    <Shell footer={false}>
      <DocsBody />
      <DocsAssistant />
    </Shell>
  );
}

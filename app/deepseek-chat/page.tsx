import { notFound } from "next/navigation";

// This page was retired. We return a 404 rather than deleting the file (neutralizing
// in place is a simpler push than deleting + pushing).
export default function DeepSeekChatRetired() {
  notFound();
}

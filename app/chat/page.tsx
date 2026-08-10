import { Shell } from "../Shell";
import { ChatApp } from "../ChatApp";

export const runtime = "nodejs";

export default function ChatPage() {
  return <Shell footer={false}><ChatApp /></Shell>;
}

import { Shell } from "../syde/Shell";
import { ChatApp } from "../syde/ChatApp";

export const runtime = "nodejs";

export default function ChatPage() {
  return <Shell footer={false}><ChatApp /></Shell>;
}

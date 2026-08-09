import { Shell } from "../syde/Shell";
import { Workbench } from "../syde/Workbench";

export const runtime = "nodejs";

export default function PlaygroundPage() {
  return <Shell footer={false}><Workbench /></Shell>;
}

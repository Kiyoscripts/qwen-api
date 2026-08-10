import { Shell } from "../Shell";
import { Workbench } from "../Workbench";

export const runtime = "nodejs";

export default function PlaygroundPage() {
  return <Shell footer={false}><Workbench /></Shell>;
}

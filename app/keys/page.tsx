import { Shell } from "../Shell";
import { KeysPanel } from "../KeysPanel";

export const runtime = "nodejs";

export default function KeysPage() {
  return (
    <Shell footer={false}>
      <div className="field py-14 md:py-16"><KeysPanel /></div>
    </Shell>
  );
}

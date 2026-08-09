import { Shell } from "../syde/Shell";
import { AdminPanel } from "../syde/AdminPanel";

export const runtime = "nodejs";

export default function AdminPage() {
  return (
    <Shell footer={false}>
      <div className="field py-14 md:py-16"><AdminPanel /></div>
    </Shell>
  );
}

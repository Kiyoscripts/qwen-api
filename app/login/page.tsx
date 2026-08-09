import { Shell } from "../syde/Shell";
import { LoginForm } from "../syde/LoginForm";

export const runtime = "nodejs";

export default function LoginPage() {
  return (
    <Shell footer={false}>
      <div className="field flex min-h-[calc(100dvh-10rem)] items-center py-16">
        <div className="mx-auto w-full max-w-[440px]"><LoginForm /></div>
      </div>
    </Shell>
  );
}

import { Shell } from "../../../Shell";
import { AdminProviderPage } from "./provider-page";

export const runtime = "nodejs";

export default async function ProviderConfigurationPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    <Shell footer={false}>
      <div className="field py-12 md:py-16">
        <AdminProviderPage providerId={id} />
      </div>
    </Shell>
  );
}

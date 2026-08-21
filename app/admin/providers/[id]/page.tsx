import { AdminProviderPage } from "./provider-page";

export const runtime = "nodejs";

export default async function ProviderConfigurationPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <AdminProviderPage providerId={id} />;
}

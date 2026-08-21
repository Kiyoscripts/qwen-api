import { getT } from "@/lib/i18nServer";
import { getModels } from "@/lib/qwen";
import { withTokenFailover } from "@/lib/tokens";
import { Shell } from "../Shell";
import { ModelBrowser } from "../ModelBrowser";
import type { CardModel } from "../ModelCard";
import { getSetting } from "@/lib/settings";
import { listCustomModels } from "@/lib/customProviders";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Only advertise models returned by the configured Qwen account. This keeps the
// catalogue honest when optional providers and virtual models are unavailable.
async function load(): Promise<{ rows: CardModel[]; degraded: boolean }> {
  const enabled = (await getSetting("models")).enabled;
  const customRows: CardModel[] = (await listCustomModels())
    .filter((model) => !enabled.length || enabled.includes(model.id))
    .map((model) => ({
      id: model.id,
      name: model.upstream_model_id,
      owner: model.provider_slug,
      maker: model.provider_slug,
      thinking: false,
      // Custom providers currently expose chat completions only.
      inputs: ["text"],
    }));
  try {
    const { result } = await withTokenFailover((token) => getModels(token));
    const visible = enabled.length ? result.filter((model) => enabled.includes(model.id)) : result;
    const qwenRows: CardModel[] = visible.map((model) => ({
      id: model.id,
      name: model.name,
      owner: "qwen",
      maker: "qwen",
      thinking: model.thinking,
      inputs: [
        "text",
        ...(model.vision ? ["image" as const] : []),
        ...(model.document ? ["file" as const] : []),
        ...(model.video ? ["video" as const] : []),
        ...(model.audio ? ["audio" as const] : []),
      ],
      context: model.contextLength,
    }));
    return { rows: [...qwenRows, ...customRows], degraded: false };
  } catch (error: any) {
    console.error("[models] Qwen account unavailable:", error?.message || error);
    return { rows: customRows, degraded: true };
  }
}

export default async function ModelsPage() {
  const t = await getT();
  const { rows, degraded } = await load();
  return (
    <Shell>
      <section className="field py-14 md:py-20">
        <p className="eyebrow">{t("nav_models")}</p>
        <h1 className="h2 text-ink">{t("models_title", { count: rows.length })}</h1>
        {degraded && (
          <div className="mt-5 border border-amber-400/30 bg-amber-400/10 px-4 py-3 text-sm text-amber-200">
            {t("models_degraded")}
          </div>
        )}
        <p className="body mt-4">Only enabled models currently available from connected providers are shown.</p>
        <ModelBrowser rows={rows} />
      </section>
    </Shell>
  );
}

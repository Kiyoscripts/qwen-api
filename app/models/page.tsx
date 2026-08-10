import { getT } from "@/lib/i18nServer";
import { getModels } from "@/lib/qwen";
import { withTokenFailover } from "@/lib/tokens";
import { VIRTUAL_MODELS } from "@/lib/media";
import { ONECOMPILER_MODELS } from "@/lib/onecompiler";
import { TOKENROUTER_MODELS, tokenRouterConfigured } from "@/lib/tokenrouter";
import { OPENCODE_ZEN_MODELS, openCodeZenConfigured } from "@/lib/opencodezen";
import { modelMaker } from "@/lib/modelIcons";
import { Shell } from "../Shell";
import { ModelBrowser } from "../ModelBrowser";
import type { CardModel } from "../ModelCard";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** The catalogue, from the live pool with the static providers alongside it. */
async function load(): Promise<{ rows: CardModel[]; degraded: boolean }> {
  const rows: CardModel[] = [];
  let degraded = false;

  for (const m of VIRTUAL_MODELS)
    rows.push({ id: m.id, name: m.name, owner: "qwen", maker: "qwen",
      inputs: m.kind === "image" ? ["image"] : [], thinking: false });

  for (const m of ONECOMPILER_MODELS)
    rows.push({ id: m.id, name: m.name, owner: "onecompiler",
      maker: modelMaker(m.id, "onecompiler").key, inputs: [], thinking: false });

  if (tokenRouterConfigured())
    for (const m of TOKENROUTER_MODELS)
      rows.push({ id: m.id, name: m.name, owner: "tokenrouter",
        maker: modelMaker(m.id, "tokenrouter").key, inputs: [], thinking: true });

  if (openCodeZenConfigured())
    for (const m of OPENCODE_ZEN_MODELS)
      rows.push({
        id: m.id,
        name: m.name,
        owner: "opencode",
        maker: modelMaker(m.id, "opencode").key,
        inputs: [],
        thinking: Boolean(m.thinking),
        context: m.contextLength,
      });

  try {
    const { result } = await withTokenFailover((t) => getModels(t));
    for (const m of result)
      rows.push({
        id: m.id, name: m.name, owner: "qwen", maker: "qwen",
        thinking: m.thinking,
        context: m.contextLength,
        inputs: [
          ...(m.vision ? ["image"] : []),
          ...(m.document ? ["file"] : []),
          ...(m.video ? ["video"] : []),
          ...(m.audio ? ["audio"] : []),
        ],
      });
  } catch (e: any) {
    degraded = true;
    console.error("[models] pool unavailable:", e?.message || e);
  }
  return { rows, degraded };
}

export default async function ModelsPage() {
  const t = await getT();
  const { rows, degraded } = await load();
  return (
    <Shell>
      <div className="field py-16 md:py-20">
        <h1 className="h2 text-ink">{t("models_title", { count: rows.length })}</h1>
        {degraded && (
          <p className="mt-4 border border-[var(--signal)] bg-[var(--signal-wash)] px-4 py-3
                        text-[13.5px] text-signal"
             style={{ borderRadius: "var(--r-sm)" }}>
            {t("models_degraded")}
          </p>
        )}
        <p className="body mt-4">{t("models_sub")}</p>
        <ModelBrowser rows={rows} />
      </div>
    </Shell>
  );
}

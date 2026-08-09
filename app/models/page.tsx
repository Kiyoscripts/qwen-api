import Aurora from "../Aurora";
import ThemeSwitcher from "../Theme";
import AccountNav from "../Account";
import LanguageSelector from "../LanguageSelector";
import { getT } from "@/lib/i18nServer";
import { getModels } from "@/lib/qwen";
import { withTokenFailover } from "@/lib/tokens";
import { VIRTUAL_MODELS } from "@/lib/media";
import { ONECOMPILER_MODELS, oneCompilerIcon } from "@/lib/onecompiler";
import { CUSTOM_MODELS } from "@/lib/customModels";
import { modelMaker } from "@/lib/modelIcons";
import Browser, { type ModelRow } from "./Browser";

export const runtime = "nodejs";
// Rendered per request, never prerendered. The catalogue comes from an
// authenticated call to the account pool, and the production image is built
// without secrets by design — so a statically generated copy is baked at build
// time with the live Qwen models missing, leaving only the hardcoded media and
// OneCompiler entries. getModels() already caches for five minutes in-process, so
// this costs a map lookup rather than an upstream call.
export const dynamic = "force-dynamic";

interface Catalogue {
  rows: Row[];
  /** The pool could not be reached, so the live Qwen models are absent. */
  degraded: boolean;
}

interface Row {
  id: string;
  name: string;
  owner: string;
  icon: string;
  tags: string[];
  /** Inputs the model accepts, as declared upstream. Text is a given. */
  inputs: string[];
}

function tagsFor(chatTypes: string[], thinking: boolean, vision: boolean): string[] {
  const t: string[] = [];
  if (thinking) t.push("reasoning");
  if (vision) t.push("vision");
  // Upstream advertises every chat_type a model *could* route to, so ordinary
  // chat models list t2i/t2v alongside t2t — tagging those directly labelled
  // Qwen3.7-Plus as an image and video model. Media generation is reachable
  // here only through the dedicated qwen-image-* / qwen-wan ids, which are
  // exactly the entries that cannot also do t2t.
  if (!chatTypes.includes("t2t")) {
    if (chatTypes.includes("t2i")) t.push("image");
    if (chatTypes.includes("image_edit")) t.push("edit");
    if (chatTypes.includes("t2v")) t.push("video");
  }
  if (t.length === 0) t.push("text");
  return t;
}

async function loadModels(): Promise<Catalogue> {
  const rows: Row[] = [];
  let degraded = false;

  // Custom persona slugs
  for (const m of CUSTOM_MODELS) rows.push({ id: m.id, name: m.name, owner: "custom", icon: "✨", tags: ["persona"], inputs: [] });
  // Image / video virtual models
  for (const m of VIRTUAL_MODELS)
    rows.push({
      id: m.id, name: m.name, owner: "qwen", icon: "/qwen.svg",
      tags: m.kind === "image" ? ["image", "edit"] : ["video"],
      // Image models take a reference image for editing; the video ones are
      // prompt-only, matching what /v1/models advertises for each.
      inputs: m.kind === "image" ? ["image"] : [],
    });
  // OneCompiler free tier — text-only, so every row tags as "text".
  for (const m of ONECOMPILER_MODELS)
    rows.push({
      id: m.id,
      name: m.name,
      owner: "onecompiler",
      icon: oneCompilerIcon(m.id) ?? "⌘",
      tags: tagsFor(["t2t"], false, false),
      inputs: [],
    });
  // Live Qwen models
  try {
    const { result } = await withTokenFailover((t) => getModels(t));
    for (const m of result)
      rows.push({
        id: m.id, name: m.name, owner: "qwen", icon: "/qwen.svg",
        tags: tagsFor(m.chatTypes, m.thinking, m.vision),
        inputs: [
          ...(m.vision ? ["image"] : []),
          ...(m.document ? ["file"] : []),
          ...(m.video ? ["video"] : []),
          ...(m.audio ? ["audio"] : []),
        ],
      });
  } catch (e: any) {
    // Never silent: a catalogue quietly missing every chat model looks like a
    // deliberately short list rather than a failure.
    degraded = true;
    console.error("[models] account pool unavailable, live Qwen models omitted:", e?.message || e);
  }
  return { rows, degraded };
}

export default async function ModelsPage() {
  const { rows: models, degraded } = await loadModels();
  const t = await getT();
  // The company that built each model, resolved here so the client component
  // stays a pure renderer over data it is given.
  const rows: ModelRow[] = models.map((m) => {
    const maker = modelMaker(m.id, m.owner);
    return { id: m.id, name: m.name, icon: m.icon, tags: m.tags, inputs: m.inputs,
             makerKey: maker.key, makerLabel: maker.label, makerIcon: maker.icon };
  });
  return (
    <>
      <Aurora />
      <div className="lp">
        <nav className="lp-nav glass">
          <a className="lp-brand" href="/" style={{ textDecoration: "none" }}><span className="lp-logo" /> Syde</a>
          <div className="lp-links">
            <a href="/models">{t("nav_models")}</a>
            <a href="/playground">{t("nav_playground")}</a>
            <a href="/chat">{t("nav_chat")}</a>
            <a href="/docs">{t("nav_docs")}</a>
          </div>
          <div className="lp-navcta">
            <ThemeSwitcher compact />
            <LanguageSelector compact />
            <AccountNav />
          </div>
        </nav>

        <div className="pg-shell">
          <div className="lp-eyebrow">{t("models_eyebrow")}</div>
          <h1 className="lp-h2">{t("models_title", { count: models.length })}</h1>
          {degraded && (
            <p className="models-degraded">{t("models_degraded")}</p>
          )}
          <p className="lp-sub" style={{ margin: "10px 0 22px", maxWidth: 640 }}>{t("models_sub")}</p>
          <Browser rows={rows} />
        </div>
      </div>
    </>
  );
}

import Aurora from "../Aurora";
import { getModels } from "@/lib/qwen";
import { withTokenFailover } from "@/lib/tokens";
import { VIRTUAL_MODELS } from "@/lib/media";
import { DEEPSEEK_MODELS } from "@/lib/deepseek";
import { CUSTOM_MODELS } from "@/lib/customModels";

export const runtime = "nodejs";
export const revalidate = 60;

interface Row {
  id: string;
  name: string;
  owner: string;
  icon: string;
  tags: string[];
}

function tagsFor(chatTypes: string[], thinking: boolean, vision: boolean): string[] {
  const t: string[] = [];
  if (thinking) t.push("reasoning");
  if (vision) t.push("vision");
  if (chatTypes.includes("t2i")) t.push("image");
  if (chatTypes.includes("image_edit")) t.push("edit");
  if (chatTypes.includes("t2v")) t.push("video");
  if (t.length === 0) t.push("text");
  return t;
}

async function loadModels(): Promise<Row[]> {
  const rows: Row[] = [];

  // Custom persona slugs
  for (const m of CUSTOM_MODELS) rows.push({ id: m.id, name: m.name, owner: "custom", icon: "✨", tags: ["persona"] });
  // Image / video virtual models
  for (const m of VIRTUAL_MODELS)
    rows.push({ id: m.id, name: m.name, owner: "qwen", icon: "/qwen.svg", tags: m.kind === "image" ? ["image", "edit"] : ["video"] });
  // DeepSeek
  for (const m of DEEPSEEK_MODELS)
    rows.push({ id: m.id, name: m.name, owner: "deepseek", icon: "/deepseek.svg", tags: tagsFor(["t2t"], m.thinking, m.vision) });
  // Live Qwen models
  try {
    const { result } = await withTokenFailover((t) => getModels(t));
    for (const m of result)
      rows.push({ id: m.id, name: m.name, owner: "qwen", icon: "/qwen.svg", tags: tagsFor(m.chatTypes, m.thinking, m.vision) });
  } catch {
    /* pool unavailable — still show the static ones */
  }
  return rows;
}

export default async function ModelsPage() {
  const models = await loadModels();
  return (
    <>
      <Aurora />
      <div className="lp">
        <nav className="lp-nav glass">
          <a className="lp-brand" href="/" style={{ textDecoration: "none" }}><span className="lp-logo" /> Qwen3.8&nbsp;API</a>
          <div className="lp-links">
            <a href="/models">Models</a>
            <a href="/playground">Playground</a>
            <a href="/chat">Chat</a>
            <a href="/docs">Docs</a>
          </div>
          <div className="lp-navcta">
            <a className="ghost" href="/link">Link DeepSeek</a>
            <a className="g-btn" href="/keys">Get a key</a>
          </div>
        </nav>

        <div className="pg-shell">
          <div className="lp-eyebrow">Models</div>
          <h1 className="lp-h2">{models.length} models, one key</h1>
          <p className="lp-sub" style={{ margin: "10px 0 22px", maxWidth: 640 }}>
            Every model is available through the same OpenAI-compatible endpoint. Pass the model <code>id</code> in your request.
          </p>
          <div className="lp-models">
            {models.map((m) => (
              <div key={m.id} className="lp-mcard glass">
                <div className="mt">
                  {m.icon.startsWith("/")
                    ? <img className="chip-img" src={m.icon} alt="" width={22} height={22} />
                    : <span className="chip" />}
                  {m.name}
                </div>
                <div className="md"><code>{m.id}</code></div>
                <div className="lp-tags">{m.tags.map((t) => <span key={t} className="lp-tag">{t}</span>)}</div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </>
  );
}

import Aurora from "../Aurora";
import ThemeSwitcher from "../Theme";
import AccountNav from "../Account";
import { getModels } from "@/lib/qwen";
import { withTokenFailover } from "@/lib/tokens";
import { VIRTUAL_MODELS } from "@/lib/media";
import { ONECOMPILER_MODELS, oneCompilerIcon } from "@/lib/onecompiler";
import { CUSTOM_MODELS } from "@/lib/customModels";

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
  for (const m of CUSTOM_MODELS) rows.push({ id: m.id, name: m.name, owner: "custom", icon: "✨", tags: ["persona"] });
  // Image / video virtual models
  for (const m of VIRTUAL_MODELS)
    rows.push({ id: m.id, name: m.name, owner: "qwen", icon: "/qwen.svg", tags: m.kind === "image" ? ["image", "edit"] : ["video"] });
  // OneCompiler free tier — text-only, so every row tags as "text".
  for (const m of ONECOMPILER_MODELS)
    rows.push({
      id: m.id,
      name: m.name,
      owner: "onecompiler",
      icon: oneCompilerIcon(m.id) ?? "⌘",
      tags: tagsFor(["t2t"], false, false),
    });
  // Live Qwen models
  try {
    const { result } = await withTokenFailover((t) => getModels(t));
    for (const m of result)
      rows.push({ id: m.id, name: m.name, owner: "qwen", icon: "/qwen.svg", tags: tagsFor(m.chatTypes, m.thinking, m.vision) });
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
            <ThemeSwitcher compact />
            <AccountNav />
          </div>
        </nav>

        <div className="pg-shell">
          <div className="lp-eyebrow">Models</div>
          <h1 className="lp-h2">{models.length} models, one key</h1>
          {degraded && (
            <p className="models-degraded">
              The account pool is unreachable right now, so the live Qwen chat models are missing
              from this list. They are unaffected on the API itself — try again shortly.
            </p>
          )}
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

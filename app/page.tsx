import Aurora from "./Aurora";
import ThemeSwitcher from "./Theme";
import StatsBar from "./StatsBar";
import { BaseUrl, CopyButton } from "./Copy";
import AccountNav from "./Account";
import CursorToggle from "./CursorToggle";
import LanguageSelector from "./LanguageSelector";
import { getT } from "@/lib/i18nServer";

const BASE = "https://qwen38-api-production.up.railway.app";

const MODELS = [
  { name: "Qwen3.8 Max Preview", id: "qwen3.8-max-preview", icon: "/qwen.svg", desc: "Flagship reasoning and vision. Streaming, tool calls, 300s ceiling.", tags: ["reasoning", "vision", "tools"] },
  { name: "Qwen Image 3.0 / 2.0", id: "qwen-image-3.0", icon: "/qwen.svg", desc: "Text-to-image and editing. Any aspect ratio, reference images.", tags: ["image", "edit"] },
  { name: "Qwen Wan", id: "qwen-wan", icon: "/qwen.svg", desc: "Text- and image-to-video with live progress. Roughly 5s clips.", tags: ["video"] },
  { name: "GPT 5.4 Mini", id: "openai/gpt-5.4-mini", icon: "/openai.svg", desc: "Fast general chat and coding, served from the OneCompiler pool.", tags: ["chat", "code"] },
  { name: "Grok 4.3", id: "xai/grok-4.3", icon: "/grok.svg", desc: "Grok for everyday reasoning and code, plus Grok Code Fast 1.", tags: ["chat", "code"] },
  { name: "Kimi K2.7 Code", id: "moonshotai/kimi-k2.7-code", icon: "/kimi.svg", desc: "Long-context coding model. Qwen3 Coder 480B sits alongside it.", tags: ["code"] },
  { name: "Qwen3-Omni", id: "qwen3-omni-flash", icon: "/qwen.svg", desc: "Around 78 voices of natural text-to-speech, returned as WAV.", tags: ["speech"] },
];

const FEATURES = [
  { title: "OpenAI-compatible", body: "Point any OpenAI SDK at the base URL and pass your key. Chat, streaming, vision and tools keep their standard shapes." },
  { title: "Anthropic-compatible", body: "/v1/messages speaks the Messages API too, count_tokens included — enough for Claude Code to run against it unmodified." },
  { title: "Reasoning and tools", body: "Toggle thinking per request, read reasoning_content off the stream, and call functions through emulated tool-calling that leaves your system prompt intact." },
  { title: "Image, video and speech", body: "Generate and edit images, render video with Qwen Wan, synthesise speech. One key, one host, no second integration." },
  { title: "Pooled with failover", body: "Qwen and OneCompiler each run their own pool of accounts. Requests rotate and fail over automatically, so one rate-limited or daily-capped account never surfaces as an error." },
  { title: "Keys you can audit", body: "Self-serve keys, hashed at rest and shown once. Per-key request counts, last-used timestamps and one-click revocation." },
];

const SNIPPET = `import OpenAI from "openai";

const client = new OpenAI({
  baseURL: "${BASE}/v1",
  apiKey: process.env.QWEN_API_KEY,
});

const r = await client.chat.completions.create({
  model: "qwen3.8-max-preview",
  messages: [{ role: "user", content: "Hello!" }],
  stream: true,
});`;

export default async function Home() {
  const t = await getT();
  return (
    <>
      <Aurora />
      <div className="lp">
        <nav className="lp-nav glass">
          <div className="lp-brand"><span className="lp-logo" /> Qwen3.8&nbsp;API</div>
          <div className="lp-links">
            <a href="/models">{t("nav_models")}</a>
            <a href="/playground">{t("nav_playground")}</a>
            <a href="/chat">{t("nav_chat")}</a>
            <a href="/docs">{t("nav_docs")}</a>
          </div>
          <div className="lp-navcta">
            <ThemeSwitcher compact />
            <CursorToggle compact />
            <LanguageSelector compact />
            <AccountNav />
          </div>
        </nav>

        <div className="lp-wrap">
          <section className="lp-hero">
            <div className="lp-pill glass"><span className="dot" /> {t("home_badge")}</div>
            <h1>{t("home_title_a")}<br /><span className="grad">{t("home_title_b")}</span></h1>
            <p className="lp-sub">{t("home_sub")}</p>
            <div className="lp-ctarow">
              <a className="g-btn lg" href="/login">{t("home_cta_key")}</a>
              <a className="g-btn lg outline" href="/docs">{t("home_cta_docs")}</a>
            </div>

            <BaseUrl url={BASE} />
            <StatsBar />
          </section>

          <section id="models">
            <div className="lp-sechead">
              <div className="lp-eyebrow">01 — {t("home_sec_models")}</div>
              <a className="lp-seclink" href="/models">{t("home_sec_models_all")}</a>
            </div>
            <h2 className="lp-h2">{t("home_sec_models_h")}</h2>
            <div className="lp-models" style={{ marginTop: 26 }}>
              {MODELS.map((m) => (
                <div key={m.name} className="lp-mcard glass">
                  <div className="mt">
                    {m.icon
                      ? <img className="chip-img" src={m.icon} alt="" width={22} height={22} />
                      : <span className="chip" />}
                    {m.name}
                  </div>
                  <div className="md">{m.desc}</div>
                  <code className="lp-mid">{m.id}</code>
                  <div className="lp-tags">{m.tags.map((t) => <span key={t} className="lp-tag">{t}</span>)}</div>
                </div>
              ))}
            </div>
          </section>

          <section>
            <div className="lp-sechead">
              <div className="lp-eyebrow">02 — {t("home_sec_caps")}</div>
            </div>
            <h2 className="lp-h2">{t("home_sec_caps_h")}</h2>
            <div className="lp-feats" style={{ marginTop: 26 }}>
              {FEATURES.map((f, i) => (
                <div key={f.title} className="lp-feat glass">
                  <div className="fi">{String(i + 1).padStart(2, "0")}</div>
                  <h3>{f.title}</h3>
                  <p>{f.body}</p>
                </div>
              ))}
            </div>
          </section>

          <section id="quickstart">
            <div className="lp-sechead">
              <div className="lp-eyebrow">03 — {t("home_sec_quick")}</div>
              <a className="lp-seclink" href="/docs">{t("home_sec_quick_all")}</a>
            </div>
            <h2 className="lp-h2">{t("home_sec_quick_h")}</h2>
            <div className="lp-code glass" style={{ marginTop: 26 }}>
              <div className="lp-code-head">
                <span className="lp-code-dot" style={{ background: "#ff5f57" }} />
                <span className="lp-code-dot" style={{ background: "#febc2e" }} />
                <span className="lp-code-dot" style={{ background: "#28c840" }} />
                <span style={{ marginLeft: 8 }}>openai-sdk.ts</span>
                <CopyButton text={SNIPPET} className="lp-code-copy" />
              </div>
              <pre>{SNIPPET}</pre>
            </div>
          </section>

          <section id="get-a-key" style={{ marginTop: 72 }}>
            <div className="lp-cta glass">
              <h2>{t("home_getkey_h")}</h2>
              <p>{t("home_getkey_body")}</p>
              <div style={{ marginTop: 22 }}>
                <a className="g-btn lg" href="/login">{t("home_getkey_cta")}</a>
              </div>
            </div>
          </section>

          <footer className="lp-foot">
            <div className="lp-foot-brand">
              <div className="lp-brand"><span className="lp-logo" /> Qwen3.8&nbsp;API</div>
              <p>{t("home_foot_tagline")}</p>
            </div>
            <div className="lp-foot-cols">
              <div>
                <h4>{t("home_foot_product")}</h4>
                <a href="/models">{t("nav_models")}</a>
                <a href="/playground">{t("nav_playground")}</a>
                <a href="/chat">{t("nav_chat")}</a>
              </div>
              <div>
                <h4>{t("home_foot_devs")}</h4>
                <a href="/docs">{t("nav_docs")}</a>
                <a href="#quickstart">Quickstart</a>
              </div>
              <div>
                <h4>{t("home_foot_account")}</h4>
                <a href="/login">{t("nav_login")}</a>
                <a href="/keys">{t("nav_dashboard")}</a>
              </div>
            </div>
            <div className="lp-foot-fine">
              {t("home_foot_fine")}
            </div>
          </footer>
        </div>
      </div>
    </>
  );
}

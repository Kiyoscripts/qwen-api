import Aurora from "./Aurora";
import StatsBar from "./StatsBar";
import KeyGenerator from "./KeyGenerator";

const BASE = "https://qwen3-8-api.vercel.app";

const MODELS = [
  { name: "Qwen3.8-Max-Preview", icon: "/qwen.svg", desc: "Flagship reasoning + vision. Streaming, tools, 300s max.", tags: ["reasoning", "vision", "tools"] },
  { name: "Qwen Image 3.0 / 2.0", icon: "/qwen.svg", desc: "Text-to-image & editing. Any aspect ratio, reference images.", tags: ["image", "edit"] },
  { name: "Qwen Wan", icon: "/qwen.svg", desc: "Text & image-to-video with live progress. ~5s clips.", tags: ["video"] },
  { name: "DeepSeek V4", icon: "/deepseek.svg", desc: "DeepSeek chat & reasoning, linkable with your own token.", tags: ["chat", "reasoning"] },
  { name: "Qwen3-Omni", icon: "/qwen.svg", desc: "~78 voices of natural text-to-speech (WAV).", tags: ["speech"] },
  { name: "Custom slugs", icon: "✨", desc: "Persona models with baked-in system prompts, e.g. friendly-qwen.", tags: ["persona"] },
];

const FEATURES = [
  { icon: "🔌", title: "OpenAI-compatible", body: "Point any OpenAI SDK at the base URL and pass your key. Chat, streaming, vision, tools — all standard shapes." },
  { icon: "🧠", title: "Reasoning & tools", body: "Toggle thinking on/off, get reasoning_content, and call functions with emulated tool-calling that respects your system prompt." },
  { icon: "🎨", title: "Image, video & speech", body: "Generate and edit images, make videos with Qwen Wan, and synthesize speech — one keyed endpoint for all of it." },
  { icon: "♻️", title: "Account pool + failover", body: "Requests rotate across a pool of accounts with automatic failover, so one rate-limited account never fails your call." },
  { icon: "🔒", title: "Keyed & rate-limited", body: "Self-serve API keys, hashed at rest and shown once. Per-IP creation limits and abuse controls built in." },
  { icon: "⚡", title: "Streaming everywhere", body: "Server-sent events for chat and tools, task-based polling with progress for long video renders." },
];

export default function Home() {
  return (
    <>
      <Aurora state="idle" />
      <div className="lp">
        <nav className="lp-nav glass">
          <div className="lp-brand"><span className="lp-logo" /> Qwen3.8&nbsp;API</div>
          <div className="lp-links">
            <a href="/models">Models</a>
            <a href="/playground">Playground</a>
            <a href="/chat">Chat</a>
            <a href="/docs">Docs</a>
          </div>
          <div className="lp-navcta">
            <a className="ghost" href="/login">Sign in</a>
            <a className="g-btn" href="/signup">Sign up</a>
          </div>
        </nav>

        <div className="lp-wrap">
          <section className="lp-hero">
            <div className="lp-pill glass"><span className="dot" /> OpenAI-compatible · Qwen &amp; DeepSeek</div>
            <h1>Qwen &amp; DeepSeek,<br /><span className="grad">one keyed API.</span></h1>
            <p className="lp-sub">
              Point your OpenAI SDK at one base URL and reach every model — chat, reasoning, vision,
              image, video and speech. No re-plumbing.
            </p>
            <div className="lp-ctarow">
              <a className="g-btn lg" href="#get-a-key">Get an API key</a>
              <a className="g-btn lg outline" href="/docs">Read the docs</a>
            </div>

            <StatsBar />
          </section>

          <section id="models">
            <div className="lp-eyebrow">Browse the models</div>
            <h2 className="lp-h2">Everything, one key</h2>
            <div className="lp-models" style={{ marginTop: 26 }}>
              {MODELS.map((m) => (
                <div key={m.name} className="lp-mcard glass">
                  <div className="mt">
                    {m.icon.startsWith("/")
                      ? <img className="chip-img" src={m.icon} alt="" width={22} height={22} />
                      : <span className="chip" />}
                    {m.name}
                  </div>
                  <div className="md">{m.desc}</div>
                  <div className="lp-tags">{m.tags.map((t) => <span key={t} className="lp-tag">{t}</span>)}</div>
                </div>
              ))}
            </div>
          </section>

          <section>
            <div className="lp-eyebrow">Why</div>
            <h2 className="lp-h2">Built like a real API</h2>
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
            <div className="lp-eyebrow">Quickstart</div>
            <h2 className="lp-h2">Two lines to switch</h2>
            <div className="lp-code glass" style={{ marginTop: 26 }}>
              <div className="lp-code-head">
                <span className="lp-code-dot" style={{ background: "#ff5f57" }} />
                <span className="lp-code-dot" style={{ background: "#febc2e" }} />
                <span className="lp-code-dot" style={{ background: "#28c840" }} />
                <span style={{ marginLeft: 8 }}>openai-sdk.ts</span>
              </div>
              <pre>{`import OpenAI from "openai";

const client = new OpenAI({
  baseURL: "${BASE}/v1",
  apiKey: "qwen_sk_...",
});

const r = await client.chat.completions.create({
  model: "qwen3.8-max-preview",
  messages: [{ role: "user", content: "Hello!" }],
});`}</pre>
            </div>
          </section>

          <section id="get-a-key" style={{ marginTop: 64 }}>
            <div className="lp-cta glass">
              <h2>Get an API key</h2>
              <p>
                Free and instant. Copy it right after — shown once, then hidden for good.{" "}
                <b style={{ color: "var(--text)" }}>Keys without an account are deleted after 3 days</b> —{" "}
                <a href="/signup">sign up</a> to keep them and manage them in your dashboard.
              </p>
              <div style={{ maxWidth: 560, margin: "0 auto", textAlign: "left" }}>
                <KeyGenerator />
              </div>
            </div>
          </section>

          <footer className="lp-foot">
            <div className="lp-brand"><span className="lp-logo" /> Qwen3.8&nbsp;API</div>
            <div style={{ display: "flex", gap: 20 }}>
              <a href="/playground">Playground</a>
              <a href="/chat">Chat</a>
              <a href="/link">Link DeepSeek</a>
              <a href="#get-a-key">Get a key</a>
            </div>
          </footer>
        </div>
      </div>
    </>
  );
}

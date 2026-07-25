import Aurora from "./Aurora";
import StatsBar from "./StatsBar";
import { BaseUrl, CopyButton } from "./Copy";
import AccountNav from "./Account";

const BASE = "https://qwen38-api-production.up.railway.app";

const MODELS = [
  { name: "Qwen3.8 Max Preview", id: "qwen3.8-max-preview", icon: "/qwen.svg", desc: "Flagship reasoning and vision. Streaming, tool calls, 300s ceiling.", tags: ["reasoning", "vision", "tools"] },
  { name: "Qwen Image 3.0 / 2.0", id: "qwen-image-3.0", icon: "/qwen.svg", desc: "Text-to-image and editing. Any aspect ratio, reference images.", tags: ["image", "edit"] },
  { name: "Qwen Wan", id: "qwen-wan", icon: "/qwen.svg", desc: "Text- and image-to-video with live progress. Roughly 5s clips.", tags: ["video"] },
  { name: "DeepSeek V4", id: "deepseek-v4-pro", icon: "/deepseek.svg", desc: "DeepSeek chat and reasoning, linkable with your own token.", tags: ["chat", "reasoning"] },
  { name: "Qwen3-Omni", id: "qwen3-omni-flash", icon: "/qwen.svg", desc: "Around 78 voices of natural text-to-speech, returned as WAV.", tags: ["speech"] },
];

const FEATURES = [
  { title: "OpenAI-compatible", body: "Point any OpenAI SDK at the base URL and pass your key. Chat, streaming, vision and tools keep their standard shapes." },
  { title: "Anthropic-compatible", body: "/v1/messages speaks the Messages API too, count_tokens included — enough for Claude Code to run against it unmodified." },
  { title: "Reasoning and tools", body: "Toggle thinking per request, read reasoning_content off the stream, and call functions through emulated tool-calling that leaves your system prompt intact." },
  { title: "Image, video and speech", body: "Generate and edit images, render video with Qwen Wan, synthesise speech. One key, one host, no second integration." },
  { title: "Pooled with failover", body: "Requests rotate across a pool of accounts and fail over automatically, so a single rate-limited account never surfaces as an error." },
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

export default function Home() {
  return (
    <>
      <Aurora />
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
            <a className="ghost" href="/link">Link DeepSeek</a>
            <AccountNav />
          </div>
        </nav>

        <div className="lp-wrap">
          <section className="lp-hero">
            <div className="lp-pill glass"><span className="dot" /> OpenAI- and Anthropic-compatible</div>
            <h1>Qwen and DeepSeek,<br /><span className="grad">one keyed API.</span></h1>
            <p className="lp-sub">
              Change two lines and reach every model — chat, reasoning, vision, image, video and
              speech — through the SDK you already use.
            </p>
            <div className="lp-ctarow">
              <a className="g-btn lg" href="/login">Get an API key</a>
              <a className="g-btn lg outline" href="/docs">Read the docs</a>
            </div>

            <BaseUrl url={BASE} />
            <StatsBar />
          </section>

          <section id="models">
            <div className="lp-sechead">
              <div className="lp-eyebrow">01 — Models</div>
              <a className="lp-seclink" href="/models">See all models →</a>
            </div>
            <h2 className="lp-h2">Everything behind one key</h2>
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
              <div className="lp-eyebrow">02 — Capabilities</div>
            </div>
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
            <div className="lp-sechead">
              <div className="lp-eyebrow">03 — Quickstart</div>
              <a className="lp-seclink" href="/docs">Full reference →</a>
            </div>
            <h2 className="lp-h2">Two lines to switch</h2>
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
              <h2>Get an API key</h2>
              <p>
                Link your Discord to create keys and manage them from your dashboard — usage,
                analytics and revocation, all in one place.
              </p>
              <div style={{ marginTop: 22 }}>
                <a className="g-btn lg" href="/login">Log in with Discord</a>
              </div>
            </div>
          </section>

          <footer className="lp-foot">
            <div className="lp-foot-brand">
              <div className="lp-brand"><span className="lp-logo" /> Qwen3.8&nbsp;API</div>
              <p>An OpenAI- and Anthropic-compatible gateway to Qwen and DeepSeek.</p>
            </div>
            <div className="lp-foot-cols">
              <div>
                <h4>Product</h4>
                <a href="/models">Models</a>
                <a href="/playground">Playground</a>
                <a href="/chat">Chat</a>
              </div>
              <div>
                <h4>Developers</h4>
                <a href="/docs">Docs</a>
                <a href="#quickstart">Quickstart</a>
                <a href="/link">Link DeepSeek</a>
              </div>
              <div>
                <h4>Account</h4>
                <a href="/login">Log in</a>
                <a href="/keys">Dashboard</a>
              </div>
            </div>
            <div className="lp-foot-fine">
              Unofficial. Not affiliated with Alibaba Cloud, Qwen or DeepSeek.
            </div>
          </footer>
        </div>
      </div>
    </>
  );
}

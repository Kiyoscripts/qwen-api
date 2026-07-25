import Aurora from "../Aurora";
import AccountNav from "../Account";

export const metadata = { title: "Docs · Qwen3.8 API" };
const BASE = "https://qwen38-api-production.up.railway.app";

function Code({ children }: { children: string }) {
  return (
    <div className="lp-code glass" style={{ marginTop: 12 }}>
      <div className="lp-code-head">
        <span className="lp-code-dot" style={{ background: "#ff5f57" }} />
        <span className="lp-code-dot" style={{ background: "#febc2e" }} />
        <span className="lp-code-dot" style={{ background: "#28c840" }} />
      </div>
      <pre>{children}</pre>
    </div>
  );
}

export default function DocsPage() {
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
            <AccountNav />
          </div>
        </nav>

        <div className="pg-shell">
          <div className="lp-eyebrow">Docs</div>
          <h1 className="lp-h2">Getting started</h1>

          <div className="docs-sec">
            <h3>Base URL &amp; auth</h3>
            <p>The API speaks <b>both</b> the OpenAI and Anthropic formats. Point either SDK at the base URL with your key.</p>
            <Code>{`OpenAI SDK:     baseURL ${BASE}/v1   ·  Authorization: Bearer qwen_sk_...
Anthropic SDK:  baseURL ${BASE}       ·  x-api-key: qwen_sk_...`}</Code>
          </div>

          <div className="docs-sec">
            <h3>Anthropic-compatible</h3>
            <p>
              <code>POST /v1/messages</code> implements Anthropic&apos;s Messages API — system prompt, content
              blocks, images, tools (<code>tool_use</code> / <code>tool_result</code>) and streaming all translate
              to the same Qwen backend. Point the Anthropic SDK at the base URL and it just works; any{" "}
              <code>claude-*</code> model name maps to the flagship, or pass a Qwen model id.
            </p>
            <Code>{`import Anthropic from "@anthropic-ai/sdk";
const client = new Anthropic({ baseURL: "${BASE}", apiKey: "qwen_sk_..." });
const msg = await client.messages.create({
  model: "qwen3.8-max-preview",   // or any claude-* name
  max_tokens: 512,
  messages: [{ role: "user", content: "Hello!" }],
});`}</Code>
          </div>

          <div className="docs-sec">
            <h3>Chat completions</h3>
            <p>Standard <code>/v1/chat/completions</code> — streaming, vision, reasoning (<code>reasoning_content</code>), and tools. Toggle reasoning with <code>enable_thinking</code>.</p>
            <Code>{`curl ${BASE}/v1/chat/completions \\
  -H "Authorization: Bearer qwen_sk_..." -H "Content-Type: application/json" \\
  -d '{ "model": "qwen3.8-max-preview", "stream": true,
        "messages": [{ "role": "user", "content": "Hello!" }] }'`}</Code>
          </div>

          <div className="docs-sec">
            <h3>Tool / function calling</h3>
            <p>Pass OpenAI-style <code>tools</code>; the model replies with <code>tool_calls</code>. Send results back as <code>role:"tool"</code> messages. <code>tool_choice</code> supports auto / none / required / a named function.</p>
            <p style={{ color: "var(--faint)", fontSize: 13 }}>Tool-calling method credit: Discord user <code>.thereid</code>.</p>
          </div>

          <div className="docs-sec">
            <h3>Image generation &amp; editing</h3>
            <p>Models <code>qwen-image-3.0</code> / <code>qwen-image-2.0</code>. Set aspect ratio with <code>size</code>. Add <code>image</code>/<code>images</code> references to edit instead of generate. <code>watermark</code> defaults to <code>Qwen3.8 API</code>; pass <code>false</code> to remove or a string to customize.</p>
            <Code>{`curl ${BASE}/v1/images/generations \\
  -H "Authorization: Bearer qwen_sk_..." \\
  -d '{ "model": "qwen-image-3.0", "prompt": "a red fox in snow", "size": "16:9" }'`}</Code>
          </div>

          <div className="docs-sec">
            <h3>Video (Qwen Wan)</h3>
            <p>Async: <code>POST /v1/videos/generations</code> returns a task + <code>ticket</code>; poll <code>GET /v1/videos/status?ticket=…</code> for progress and the final URL. Supports <code>size</code> and <code>image</code> — attaching a reference image switches it to image-to-video.</p>
          </div>

          <div className="docs-sec">
            <h3>Speech</h3>
            <p><code>POST /v1/audio/speech</code> → WAV. <code>GET /v1/audio/voices</code> lists ~78 voices.</p>
          </div>

          <div className="docs-sec">
            <h3>Using an OpenAI SDK</h3>
            <Code>{`import OpenAI from "openai";
const client = new OpenAI({ baseURL: "${BASE}/v1", apiKey: "qwen_sk_..." });
const r = await client.chat.completions.create({
  model: "qwen3.8-max-preview",
  messages: [{ role: "user", content: "Hello!" }],
});`}</Code>
          </div>
        </div>
      </div>
    </>
  );
}

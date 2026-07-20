const curlExample = `curl https://qwen3-8-api.vercel.app/v1/chat/completions \\
  -H "Authorization: Bearer qwen_sk_..." \\
  -H "Content-Type: application/json" \\
  -d '{
    "model": "qwen3.8-max-preview",
    "messages": [{ "role": "user", "content": "Hello!" }]
  }'`;

const visionExample = `{
  "model": "qwen3.8-max-preview",
  "messages": [{
    "role": "user",
    "content": [
      { "type": "text", "text": "What's in this image?" },
      { "type": "image_url",
        "image_url": { "url": "data:image/png;base64,iVBORw0..." } }
    ]
  }]
}`;

const sdkExample = `import OpenAI from "openai";

const client = new OpenAI({
  baseURL: "https://qwen3-8-api.vercel.app/v1",
  apiKey: "qwen_sk_...",
});

const r = await client.chat.completions.create({
  model: "qwen3.8-max-preview",
  messages: [{ role: "user", content: "Hello!" }],
});`;

import KeyGenerator from "./KeyGenerator";

export default function Home() {
  return (
    <div className="wrap">
      <span className="badge">qwen3.8-max-preview · vision</span>
      <h1>
        The <span className="grad">Qwen3.8 API</span>
      </h1>
      <p className="lead">
        An OpenAI-compatible endpoint for <code>qwen3.8-max-preview</code>, with image
        understanding built in. Point any OpenAI SDK at it, pass your API key, done.
      </p>

      <div className="grid">
        <div className="card">
          <h3>Drop-in compatible</h3>
          <p>Same request/response shape as the OpenAI Chat Completions API. Streaming supported.</p>
        </div>
        <div className="card">
          <h3>Vision</h3>
          <p>Send images as <code>image_url</code> parts — base64 data URLs or public URLs.</p>
        </div>
        <div className="card">
          <h3>API keys</h3>
          <p>Access is gated by keys managed in Supabase. Bring your own client.</p>
        </div>
      </div>

      <p style={{ margin: "0 0 40px" }}>
        <a className="btn" href="/playground" style={{ display: "inline-block" }}>
          Open the playground →
        </a>
      </p>

      <h2 id="get-a-key">Get an API key</h2>
      <KeyGenerator />

      <h2>Quick start</h2>
      <pre>
        <code>{curlExample}</code>
      </pre>

      <h2>Using an OpenAI SDK</h2>
      <pre>
        <code>{sdkExample}</code>
      </pre>

      <h2>Vision request</h2>
      <pre>
        <code>{visionExample}</code>
      </pre>

      <h2>Endpoints</h2>
      <pre>
        <code>
          POST /v1/chat/completions   — chat (streaming &amp; non-streaming, vision){"\n"}
          GET  /v1/models             — lists the one available model
        </code>
      </pre>

      <p className="foot">
        Model: <span className="tok">qwen3.8-max-preview</span>. Authenticate with{" "}
        <code>Authorization: Bearer &lt;your key&gt;</code>. Keys are issued by the operator.
      </p>
    </div>
  );
}

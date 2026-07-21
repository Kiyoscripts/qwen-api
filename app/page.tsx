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
          <h3>All Qwen models</h3>
          <p>Every model from chat.qwen.ai — reasoning, vision, coding, omni and more.</p>
        </div>
        <div className="card">
          <h3>Vision + thinking</h3>
          <p>Image inputs via <code>image_url</code>, and the model&apos;s reasoning in <code>reasoning_content</code>.</p>
        </div>
        <div className="card">
          <h3>Image &amp; video</h3>
          <p>Generate images (<code>/v1/images/generations</code>) and video (<code>/v1/videos/generations</code>).</p>
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
          POST /v1/chat/completions    — chat (streaming, vision, reasoning){"\n"}
          POST /v1/images/generations  — text-to-image{"\n"}
          POST /v1/videos/generations  — text-to-video (async){"\n"}
          POST /v1/audio/speech        — text-to-speech (wav){"\n"}
          GET  /v1/audio/voices        — ~78 TTS voices{"\n"}
          GET  /v1/models              — lists all available models
        </code>
      </pre>

      <h2>Image generation</h2>
      <pre>
        <code>{`curl https://qwen3-8-api.vercel.app/v1/images/generations \\
  -H "Authorization: Bearer qwen_sk_..." \\
  -H "Content-Type: application/json" \\
  -d '{ "prompt": "a red apple on a table", "size": "1:1" }'
# -> { "data": [{ "url": "https://..." }] }`}</code>
      </pre>

      <p className="foot">
        Model: <span className="tok">qwen3.8-max-preview</span>. Authenticate with{" "}
        <code>Authorization: Bearer &lt;your key&gt;</code>. Keys are issued by the operator.
      </p>
    </div>
  );
}

import Aurora from "../Aurora";
import AccountNav from "../Account";
import { CodeTabs, Code } from "./CodeTabs";
import {
  BASE,
  quickstart,
  streaming,
  vision,
  tools,
  images,
  video,
  speech,
  anthropic,
  continuation,
} from "./samples";

export const metadata = {
  title: "Docs · Qwen3.8 API",
  description: "Full reference for the Qwen3.8 API — chat, streaming, vision, tools, image, video and speech.",
};

const NAV: { id: string; label: string }[] = [
  { id: "start", label: "Getting started" },
  { id: "auth", label: "Authentication" },
  { id: "quickstart", label: "Quickstart" },
  { id: "chat", label: "Chat completions" },
  { id: "streaming", label: "Streaming" },
  { id: "reasoning", label: "Reasoning" },
  { id: "vision", label: "Vision" },
  { id: "tools", label: "Tool calling" },
  { id: "images", label: "Images" },
  { id: "video", label: "Video" },
  { id: "speech", label: "Speech" },
  { id: "models", label: "Models" },
  { id: "anthropic", label: "Anthropic API" },
  { id: "errors", label: "Errors" },
  { id: "truncation", label: "Truncated replies" },
  { id: "limits", label: "Limits" },
];

function Params({ rows, head = "Field" }: { rows: [string, string, string][]; head?: string }) {
  return (
    <div className="dt-wrap">
      <table className="dt">
        <thead>
          <tr>
            <th>{head}</th>
            <th>Type</th>
            <th>Description</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(([name, type, desc]) => (
            <tr key={name}>
              <td><code>{name}</code></td>
              <td className="dt-type">{type}</td>
              <td>{desc}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Section({
  id,
  eyebrow,
  title,
  children,
}: {
  id: string;
  eyebrow?: string;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="docs-sec" id={id}>
      {eyebrow && <div className="lp-eyebrow" style={{ margin: "0 0 8px" }}>{eyebrow}</div>}
      <h2 className="docs-h2">{title}</h2>
      {children}
    </section>
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

        <div className="docs-shell">
          <aside className="docs-nav">
            <div className="docs-nav-title">Reference</div>
            {NAV.map((n) => (
              <a key={n.id} href={`#${n.id}`}>{n.label}</a>
            ))}
          </aside>

          <main className="docs-main">
            <Section id="start" eyebrow="Docs" title="Getting started">
              <p>
                One keyed endpoint for Qwen and DeepSeek: chat, reasoning, vision, tool calling, image
                generation and editing, video, and speech. It speaks <b>both</b> the OpenAI and the
                Anthropic wire formats, so most existing code works after changing a base URL and a key.
              </p>
              <div className="dc-note">
                <b>Base URL</b>
                <div className="dc-note-body">
                  <div><span className="dt-type">OpenAI SDKs</span> <code>{BASE}/v1</code></div>
                  <div><span className="dt-type">Anthropic SDKs</span> <code>{BASE}</code> — the root, with no <code>/v1</code></div>
                </div>
              </div>
            </Section>

            <Section id="auth" title="Authentication">
              <p>
                Every request needs a key. Create one from your <a href="/keys">dashboard</a> after
                linking Discord. Keys are hashed at rest and shown exactly once.
              </p>
              <Params
                head="Header"
                rows={[
                  ["Authorization", "header", "Bearer qwen_sk_… — the OpenAI convention."],
                  ["x-api-key", "header", "qwen_sk_… — the Anthropic convention. Either header works on any endpoint."],
                ]}
              />
              <p className="docs-fine">
                Requests from this site&apos;s own <a href="/chat">chat</a> and <a href="/playground">playground</a> are
                authenticated by your login session instead, so you never have to paste a key into your
                own browser. A supplied key always takes precedence.
              </p>
            </Section>

            <Section id="quickstart" title="Quickstart">
              <p>The smallest complete call, in the language you actually use.</p>
              <CodeTabs samples={quickstart} />
            </Section>

            <Section id="chat" title="Chat completions">
              <p>
                <code>POST /v1/chat/completions</code> — the OpenAI shape, including <code>tools</code>,
                multi-part <code>content</code> for vision, and streaming.
              </p>
              <Params
                rows={[
                  ["model", "string", "e.g. qwen3.8-max-preview. See /v1/models for the full list."],
                  ["messages", "array", "Standard roles: system, user, assistant, tool."],
                  ["stream", "boolean", "Server-sent events when true. Default false."],
                  ["tools", "array", "OpenAI function schemas. See Tool calling."],
                  ["tool_choice", '"auto" | "none" | object', 'Allow, forbid, or force a call. "none" disables tools entirely.'],
                  ["enable_thinking", "boolean", "Skip reasoning on models that allow it. Ignored by qwen3.8-max-preview, which always reasons."],
                  ["size", "string", "Aspect ratio for image and video models: 1:1, 16:9, 9:16, 4:3, 3:4."],
                  ["watermark", "boolean | string", 'Image watermark. false removes it; a string replaces the default.'],
                ]}
              />
              <p className="docs-fine">
                <code>usage</code> carries the real token counts reported by the upstream model, not estimates.
              </p>
            </Section>

            <Section id="streaming" title="Streaming">
              <p>
                Set <code>stream: true</code> for server-sent events. Chunks follow the OpenAI{" "}
                <code>chat.completion.chunk</code> shape and the stream ends with <code>data: [DONE]</code>.
              </p>
              <CodeTabs samples={streaming} />
              <div className="dc-note">
                <b>Keepalive comments</b>
                <div className="dc-note-body">
                  A reply can produce nothing for a long stretch — a reasoning phase emits no visible
                  text, and a tool call is withheld until it is complete. Proxies hang up on a silent
                  connection, so the stream sends <code>: keepalive</code> comment lines during those
                  gaps. Every SSE client ignores lines starting with <code>:</code>; if you parse the
                  stream by hand, skip them.
                </div>
              </div>
            </Section>

            <Section id="reasoning" title="Reasoning">
              <p>
                Reasoning models stream their thinking on a separate field, <code>reasoning_content</code>,
                before any visible <code>content</code>. It is kept off <code>content</code> deliberately, so
                it can never contaminate the answer.
              </p>
              <Code lang="json">{`{"choices":[{"delta":{"reasoning_content":"The user wants…"},"finish_reason":null}]}
{"choices":[{"delta":{"content":"Closures are…"},"finish_reason":null}]}`}</Code>
              <p className="docs-fine">
                On <code>qwen3.8-max-preview</code> reasoning cannot be turned off, and it dominates the
                wall clock — a typical reply spends most of its time thinking and only a few seconds
                writing. Budget your timeouts accordingly. Models that support it accept{" "}
                <code>enable_thinking: false</code> for a faster, shallower answer.
              </p>
            </Section>

            <Section id="vision" title="Vision">
              <p>
                Pass an array for <code>content</code> with <code>image_url</code> parts. Public URLs and{" "}
                <code>data:</code> URLs both work; the image is uploaded to the backend for you.
              </p>
              <CodeTabs samples={vision} />
            </Section>

            <Section id="tools" title="Tool calling">
              <p>
                Standard OpenAI function calling: send <code>tools</code>, receive <code>tool_calls</code>,
                run them yourself, append a <code>role: &quot;tool&quot;</code> message, and call again.
                Parallel calls are supported.
              </p>
              <CodeTabs samples={tools} />
              <div className="dc-note">
                <b>How it works underneath</b>
                <div className="dc-note-body">
                  The upstream service has no native tool API, so the schemas are injected into the
                  prompt using the convention Qwen3 was trained on, and the reply is parsed back into{" "}
                  <code>tool_calls</code>. Two consequences worth knowing: a call is only recognised when
                  its name matches a tool you declared — anything else is returned as ordinary text
                  rather than invented — and argument values are coerced to your schema&apos;s types, so{" "}
                  <code>&quot;3&quot;</code> becomes <code>3</code> where you asked for an integer.
                </div>
              </div>
            </Section>

            <Section id="images" title="Images">
              <p>
                <code>POST /v1/images/generations</code>. Supplying <code>image</code> switches generation
                to editing — the same distinction the upstream service makes internally.
              </p>
              <CodeTabs samples={images} />
              <Params
                rows={[
                  ["prompt", "string", "Required, unless you supply image for an edit."],
                  ["model", "string", "qwen-image-3.0 or qwen-image-2.0."],
                  ["size", "string", "1:1, 16:9, 9:16, 4:3, 3:4."],
                  ["image", "string | string[]", "Reference image(s). Their presence turns this into an edit."],
                  ["response_format", '"url" | "b64_json"', "Default url."],
                  ["watermark", "boolean | string", "false to remove, or a custom string."],
                ]}
              />
            </Section>

            <Section id="video" title="Video">
              <p>
                Renders take minutes, so this is a task API rather than one long request:{" "}
                <code>POST /v1/videos/generations</code> returns a <code>ticket</code> immediately, and you
                poll <code>GET /v1/videos/status</code>.
              </p>
              <CodeTabs samples={video} />
              <Params
                rows={[
                  ["prompt", "string", "Required."],
                  ["image", "string", "Optional reference. Supplying it produces image-to-video — the clip animates that picture."],
                  ["size", "string", "16:9, 9:16, 1:1, 4:3, 3:4."],
                  ["wait", "boolean", "Block and return the finished URL instead of a ticket. Bounded by the request timeout; falls back to a ticket."],
                  ["ticket", "query", "Returned by the start call. Pins polling to the account that owns the task, which is required — a task is not visible to any other account."],
                ]}
              />
            </Section>

            <Section id="speech" title="Speech">
              <p>
                <code>POST /v1/audio/speech</code> returns WAV bytes.{" "}
                <code>GET /v1/audio/voices</code> lists the available voices.
              </p>
              <CodeTabs samples={speech} />
            </Section>

            <Section id="models" title="Models">
              <p>
                <code>GET /v1/models</code> returns every model with its capabilities — whether it
                reasons, accepts images, or generates media. Browse them at <a href="/models">/models</a>.
              </p>
              <Code>{`curl ${BASE}/v1/models -H "Authorization: Bearer $QWEN_API_KEY"`}</Code>
              <Params
                head="Model"
                rows={[
                  ["qwen3.8-max-preview", "chat", "Flagship. Always reasons, accepts images, supports tools."],
                  ["qwen-image-3.0 / 2.0", "image", "Text-to-image, and editing when given references."],
                  ["qwen-wan", "video", "Text-to-video and image-to-video, roughly 5s clips."],
                  ["deepseek-v4-*", "chat", "DeepSeek, through your own linked token — see /link."],
                  ["Custom slugs", "chat", "Persona models with a system prompt baked in at the gateway."],
                ]}
              />
            </Section>

            <Section id="anthropic" title="Anthropic-compatible API">
              <p>
                <code>POST /v1/messages</code> speaks the Anthropic Messages API, including streaming and{" "}
                <code>/v1/messages/count_tokens</code> — enough for Claude Code to run against this API
                unmodified. Any <code>claude-*</code> model name maps to the flagship, or pass a Qwen id.
              </p>
              <CodeTabs samples={anthropic} />
            </Section>

            <Section id="errors" title="Errors">
              <p>Errors use the OpenAI envelope, and the Anthropic shape on <code>/v1/messages</code>.</p>
              <Code lang="json">{`{ "error": { "message": "Invalid or revoked API key.", "type": "invalid_request_error" } }`}</Code>
              <Params
                head="Status"
                rows={[
                  ["400", "invalid_request_error", "Malformed body, or a required field is missing."],
                  ["401", "invalid_request_error", "Missing, invalid or revoked key."],
                  ["404", "not_supported", "Unknown model, or a disabled capability."],
                  ["410", "moved_permanently", "You are calling a retired host. The body carries the current base URL."],
                  ["429 / 503", "upstream_error", "Every pooled account is rate-limited. Retry shortly."],
                  ["502", "upstream_error", "The upstream service failed or returned something unusable."],
                ]}
              />
            </Section>

            <Section id="truncation" title="Truncated replies">
              <p>
                A long generation can be severed before it finishes — the host&apos;s request ceiling, a
                dropped upstream connection, or an account hitting a limit. When that happens the reply
                comes back with <code>finish_reason: &quot;length&quot;</code> (and{" "}
                <code>stop_reason: &quot;max_tokens&quot;</code> on the Anthropic endpoint), and whatever was
                produced is kept rather than thrown away.
              </p>
              <p>
                Nothing is retried for you, because a blind retry regenerates work you already have.
                Send the partial back as the assistant turn and the model continues from it — you pay
                for the remainder only.
              </p>
              <CodeTabs samples={continuation} />
              <p className="docs-fine">
                If the reply was cut off during the reasoning phase there is no visible text yet, only
                thinking. Send that reasoning back and ask for the answer directly rather than asking it
                to continue — more deliberation is exactly what ran out the clock.
              </p>
            </Section>

            <Section id="limits" title="Limits and behaviour">
              <Params
                head="Topic"
                rows={[
                  ["Request duration", "—", "Long generations are the main constraint; see Truncated replies."],
                  ["Account pool", "—", "Requests rotate across pooled accounts with automatic failover, so one rate-limited account does not surface as an error."],
                  ["Rate limits", "per key", "Key creation is limited per IP. Inference is bounded by the pool's own quotas."],
                  ["Conversation state", "none", "Every request is stateless — send the full message history each time."],
                  ["Media hosting", "proxied", "Generated images and video are served back through this origin, because the upstream CDN is signed and referer-checked."],
                ]}
              />
            </Section>

            <footer className="lp-foot" style={{ marginTop: 40 }}>
              <div className="lp-foot-brand">
                <div className="lp-brand"><span className="lp-logo" /> Qwen3.8&nbsp;API</div>
                <p>Unofficial. Not affiliated with Alibaba Cloud, Qwen or DeepSeek.</p>
              </div>
              <div className="lp-foot-cols">
                <div>
                  <h4>Product</h4>
                  <a href="/models">Models</a>
                  <a href="/playground">Playground</a>
                  <a href="/chat">Chat</a>
                </div>
                <div>
                  <h4>Account</h4>
                  <a href="/login">Log in</a>
                  <a href="/keys">Dashboard</a>
                  <a href="/link">Link DeepSeek</a>
                </div>
              </div>
            </footer>
          </main>
        </div>
      </div>
    </>
  );
}

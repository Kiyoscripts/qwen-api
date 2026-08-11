"use client";

import { useEffect, useState } from "react";
import { CodeTabs } from "./CodeTabs";
import { Reveal } from "./Reveal";
import { BASE } from "./docs/samples";

/**
 * The full reference, same seventeen sections and same ids as the live docs, so
 * every existing deep link still lands. Grouped in the index because a flat
 * list of seventeen is a wall; the groups are navigation only and do not appear
 * as headings in the body.
 */
const GROUPS: { head: string; items: [string, string][] }[] = [
  {
    head: "Basics",
    items: [
      ["start", "Getting started"],
      ["auth", "Authentication"],
      ["quickstart", "Quickstart"],
    ],
  },
  {
    head: "Text",
    items: [
      ["chat", "Chat completions"],
      ["streaming", "Streaming"],
      ["reasoning", "Reasoning"],
      ["tools", "Tool calling"],
    ],
  },
  {
    head: "Media",
    items: [
      ["vision", "Vision"],
      ["images", "Images"],
      ["video", "Video"],
      ["speech", "Speech"],
    ],
  },
  {
    head: "Reference",
    items: [
      ["models", "Models"],
      ["anthropic", "Anthropic API"],
      ["clis", "Coding CLIs"],
    ],
  },
  {
    head: "Behaviour",
    items: [
      ["errors", "Errors"],
      ["truncation", "Truncated replies"],
      ["limits", "Limits"],
    ],
  },
];

const IDS = GROUPS.flatMap((g) => g.items.map(([id]) => id));

function Section({
  id,
  title,
  children,
  first = false,
}: {
  id: string;
  title: string;
  children: React.ReactNode;
  first?: boolean;
}) {
  return (
    <Reveal>
      <section
        id={id}
        className={
          first ? "scroll-mt-24" : "mt-14 scroll-mt-24 border-t border-rule pt-10"
        }
      >
        <h2 className="h2 text-ink">{title}</h2>
        <div className="mt-4 space-y-4">{children}</div>
      </section>
    </Reveal>
  );
}

function P({ children }: { children: React.ReactNode }) {
  return <p className="body">{children}</p>;
}

function C({ children }: { children: React.ReactNode }) {
  return <code className="font-mono text-[0.92em] text-ink">{children}</code>;
}

/** Parameter tables, as definition pairs rather than a ruled grid. */
function Params({ rows }: { rows: [string, string][] }) {
  return (
    <dl className="grid gap-x-8 gap-y-3.5 pt-2 sm:grid-cols-[max-content_1fr]">
      {rows.map(([k, v]) => (
        <div key={k} className="contents">
          <dt className="font-mono text-[12.5px] text-signal">{k}</dt>
          <dd className="text-[13.5px] leading-relaxed text-ink-2">{v}</dd>
        </div>
      ))}
    </dl>
  );
}

export function DocsBody() {
  const [active, setActive] = useState(IDS[0]);

  // Highlight the section being read. IntersectionObserver rather than a scroll
  // listener, so this costs nothing per frame.
  useEffect(() => {
    const seen = new Map<string, boolean>();
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) seen.set(e.target.id, e.isIntersecting);
        const current = IDS.find((id) => seen.get(id));
        if (current) setActive(current);
      },
      { rootMargin: "-72px 0px -65% 0px" }
    );
    for (const id of IDS) {
      const el = document.getElementById(id);
      if (el) io.observe(el);
    }
    return () => io.disconnect();
  }, []);

  return (
    <div className="field py-16 md:py-20">
      <div className="grid gap-10 lg:grid-cols-12 lg:gap-12">
        <aside className="lg:col-span-3">
          <nav className="lg:sticky lg:top-24 lg:max-h-[calc(100dvh-8rem)] lg:overflow-y-auto lg:pr-2">
            <div className="flex gap-6 overflow-x-auto pb-2 lg:block lg:space-y-6 lg:overflow-visible lg:pb-0">
              {GROUPS.map((g) => (
                <div key={g.head} className="shrink-0">
                  <p className="font-mono text-[10.5px] tracking-wider text-ink-3 uppercase">
                    {g.head}
                  </p>
                  <div className="mt-2.5 flex gap-2 lg:flex-col lg:gap-0">
                    {g.items.map(([id, label]) => (
                      <a
                        key={id}
                        href={`#${id}`}
                        className={`shrink-0 border-l-2 py-1.5 pl-3 font-mono text-[12.5px] no-underline
                          transition-colors duration-200 ${
                            active === id
                              ? "border-signal text-signal"
                              : "border-transparent text-ink-3 hover:text-ink"
                          }`}
                      >
                        {label}
                      </a>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </nav>
        </aside>

        <div className="lg:col-span-9 lg:max-w-[72ch]">
          <Section id="start" title="Getting started" first>
            <P>
              One keyed endpoint for Qwen, Kimi, GPT, DeepSeek, Grok and Gemma:
              chat, reasoning, vision, tool calling, image generation and
              editing, video, and speech.
            </P>
            <div
              className="border border-rule px-4 py-3.5"
              style={{ borderRadius: "var(--r-sm)" }}
            >
              <p className="font-mono text-[11px] tracking-wide text-ink-3 uppercase">
                Base URL
              </p>
              <div className="mt-2.5 space-y-1.5 text-[13px]">
                <p className="text-ink-2">
                  OpenAI SDKs <C>{BASE}/v1</C>
                </p>
                <p className="text-ink-2">
                  Anthropic SDKs <C>{BASE}</C> with no <C>/v1</C>
                </p>
              </div>
            </div>
          </Section>

          <Section id="auth" title="Authentication">
            <P>
              Every request needs a key. Keys are hashed at rest and shown once.
              Either header works on either endpoint.
            </P>
            <Params
              rows={[
                ["Authorization", "Bearer syde_sk_… , the OpenAI convention."],
                ["x-api-key", "syde_sk_… , the Anthropic convention."],
              ]}
            />
            <P>
              Requests from this site&apos;s own playground authenticate with your
              session instead, so no key is pasted into your own browser.
            </P>
          </Section>

          <Section id="quickstart" title="Quickstart">
            <P>The smallest complete call.</P>
            <CodeTabs
              samples={[
                {
                  lang: "curl",
                  code: `curl ${BASE}/v1/chat/completions \\
  -H "Authorization: Bearer $SYDE_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{
    "model": "qwen3.8-max",
    "messages": [{ "role": "user", "content": "Explain closures." }]
  }'`,
                },
                {
                  lang: "Python",
                  code: `from openai import OpenAI

client = OpenAI(
    base_url="${BASE}/v1",
    api_key=os.environ["SYDE_API_KEY"],
)

r = client.chat.completions.create(
    model="qwen3.8-max",
    messages=[{"role": "user", "content": "Explain closures."}],
)
print(r.choices[0].message.content)`,
                },
                {
                  lang: "TypeScript",
                  code: `import OpenAI from "openai";

const client = new OpenAI({
  baseURL: "${BASE}/v1",
  apiKey: process.env.SYDE_API_KEY,
});

const r = await client.chat.completions.create({
  model: "qwen3.8-max",
  messages: [{ role: "user", content: "Explain closures." }],
});`,
                },
              ]}
            />
          </Section>

          <Section id="chat" title="Chat completions">
            <P>
              <C>POST /v1/chat/completions</C> takes the OpenAI shape, including
              tools, multi-part content for vision, and streaming.
            </P>
            <Params
              rows={[
                ["model", "Any id from the catalogue."],
                ["messages", "system, user, assistant and tool roles."],
                ["stream", "Server sent events when true. Default false."],
                ["tools", "OpenAI function schemas."],
                ["tool_choice", "auto, none, or a named function to force one."],
                ["enable_thinking", "Skip reasoning on models that allow it."],
                ["size", "Aspect ratio for image and video models."],
                ["watermark", "false removes it, a string replaces it."],
              ]}
            />
            <P>
              <C>usage</C> carries the token counts the model reported, not
              estimates.
            </P>
          </Section>

          <Section id="streaming" title="Streaming">
            <P>
              Chunks follow the OpenAI <C>chat.completion.chunk</C> shape and the
              stream ends with <C>data: [DONE]</C>. A reply can go quiet for a
              stretch while a model reasons or assembles a tool call, so the
              stream sends <C>: keepalive</C> comment lines to stop proxies
              hanging up. Every SSE client ignores them.
            </P>
            <CodeTabs
              samples={[
                {
                  lang: "Python",
                  code: `stream = client.chat.completions.create(
    model="qwen3.8-max",
    messages=[{"role": "user", "content": "Count to ten."}],
    stream=True,
)

for chunk in stream:
    print(chunk.choices[0].delta.content or "", end="")`,
                },
              ]}
            />
          </Section>

          <Section id="reasoning" title="Reasoning">
            <P>
              Reasoning models emit their thinking on a separate channel from the
              answer. It arrives as <C>reasoning_content</C> on the delta, so you
              can render it, collapse it, or drop it without touching the reply.
            </P>
            <P>
              Pass <C>enable_thinking: false</C> to skip it where a model offers
              both modes. Models that only run in thinking mode ignore the flag
              rather than failing.
            </P>
          </Section>

          <Section id="vision" title="Vision">
            <P>
              Send an image as a content part alongside the text. Any model whose{" "}
              <C>capabilities.input.image</C> is true accepts one, and a model
              that does not says so rather than dropping it silently.
            </P>
            <CodeTabs
              samples={[
                {
                  lang: "JSON",
                  code: `{
  "model": "qwen3.8-max",
  "messages": [{
    "role": "user",
    "content": [
      { "type": "text", "text": "What is in this photo?" },
      { "type": "image_url",
        "image_url": { "url": "https://example.com/photo.jpg" } }
    ]
  }]
}`,
                },
              ]}
            />
          </Section>

          <Section id="tools" title="Tool calling">
            <P>
              Standard OpenAI function calling: send <C>tools</C>, receive{" "}
              <C>tool_calls</C>, reply with a <C>tool</C> message. It works on
              every model on the endpoint, including the ones with no native
              tool support, so behaviour does not change with the model id.
            </P>
            <Params
              rows={[
                ["tool_choice: auto", "The model decides. Default."],
                ["tool_choice: none", "Tools are ignored for this request."],
                ["{ name }", "Force one named function."],
                ["parallel_tool_calls", "Set false to allow only one call per turn."],
              ]}
            />
          </Section>

          <Section id="images" title="Images">
            <P>
              Ask an image model for a picture and the reply is markdown media.
              Pass a reference image to edit it instead of generating from
              scratch. <C>size</C> takes 1:1, 16:9, 9:16, 4:3 or 3:4.
            </P>
            <CodeTabs
              samples={[
                {
                  lang: "curl",
                  code: `curl ${BASE}/v1/images/generations \\
  -H "Authorization: Bearer $SYDE_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{ "model": "qwen-image-3.0",
        "prompt": "A cross-section of a mechanical keyboard switch",
        "size": "16:9" }'`,
                },
              ]}
            />
          </Section>

          <Section id="video" title="Video">
            <P>
              Video generation is a task rather than a request: it starts, then
              you poll. Supplying reference images turns it into image to video.
              Results come back unwatermarked.
            </P>
          </Section>

          <Section id="speech" title="Speech">
            <P>
              <C>POST /v1/audio/speech</C> reads text aloud and returns audio.
              The available voices are listed at <C>/v1/audio/voices</C>.
            </P>
          </Section>

          <Section id="models" title="Models">
            <P>
              <C>GET /v1/models</C> lists everything your key can reach. Each
              entry declares what it accepts under <C>capabilities.input</C>,
              which is worth reading rather than assuming: qwen3.8-max takes
              image, file, video and audio, and others differ.
            </P>
            <P>
              Read that endpoint rather than this page for what exists today.
              The catalogue tracks upstream, so models arrive and are withdrawn
              without notice — <C>qwen3.8-max-preview</C> was documented here
              until it was withdrawn — and any id written in prose is an
              example rather than a promise.
            </P>
          </Section>

          <Section id="anthropic" title="Anthropic API">
            <P>
              <C>POST /v1/messages</C> speaks the Anthropic Messages API,
              including streaming and <C>/v1/messages/count_tokens</C>. Any{" "}
              <C>claude-*</C> model name maps to the flagship, or pass a Qwen id
              directly.
            </P>
          </Section>

          <Section id="clis" title="Coding CLIs">
            <P>
              Codex, OpenCode, Claude Code and Aider all work with configuration
              alone. The one thing to get right is the base URL: OpenAI shaped
              clients want <C>/v1</C> because they append the path, Claude Code
              wants the bare origin because it appends <C>/v1/messages</C>{" "}
              itself. Reversing those is what makes a CLI hang or 404 on the
              first message.
            </P>
            <CodeTabs
              samples={[
                {
                  lang: "Claude Code",
                  code: `export ANTHROPIC_BASE_URL="${BASE}"
export ANTHROPIC_AUTH_TOKEN="$SYDE_API_KEY"
export ANTHROPIC_MODEL="qwen3.8-max"

# Background calls use a smaller model. Point those here too.
export ANTHROPIC_SMALL_FAST_MODEL="qwen3.8-max"

claude`,
                },
                {
                  lang: "Codex",
                  code: `# ~/.codex/config.toml
model = "qwen3.8-max"
model_provider = "qwen38"

[model_providers.qwen38]
name = "Syde"
base_url = "${BASE}/v1"
env_key = "SYDE_API_KEY"
wire_api = "chat"`,
                },
                {
                  lang: "OpenCode",
                  code: `// opencode.json
{
  "$schema": "https://opencode.ai/config.json",
  "provider": {
    "qwen38": {
      "npm": "@ai-sdk/openai-compatible",
      "name": "Syde",
      "options": {
        "baseURL": "${BASE}/v1",
        "apiKey": "{env:SYDE_API_KEY}"
      },
      "models": { "qwen3.8-max": { "name": "Qwen3.8 Max" } }
    }
  }
}`,
                },
                {
                  lang: "Aider",
                  code: `export OPENAI_BASE_URL="${BASE}/v1"
export OPENAI_API_KEY="$SYDE_API_KEY"

aider --model openai/qwen3.8-max`,
                },
              ]}
            />
          </Section>

          <Section id="errors" title="Errors">
            <P>
              Errors use the OpenAI envelope, and the Anthropic shape on{" "}
              <C>/v1/messages</C>. Upstream status codes are passed through
              rather than flattened, so a 429 reaches you as a 429 and a client
              that can back off knows to.
            </P>
            <Params
              rows={[
                ["401", "Missing or invalid key."],
                ["404", "Unknown model id."],
                ["429", "Rate limited. Retry after the header says when."],
                ["502", "The upstream refused or could not be reached."],
              ]}
            />
          </Section>

          <Section id="truncation" title="Truncated replies">
            <P>
              A reply that stops early comes back with{" "}
              <C>finish_reason: &quot;length&quot;</C>, the same signal OpenAI uses,
              so clients already treat it as resumable. Send the partial answer
              back with an instruction to continue and you pay for the
              remainder rather than regenerating the whole thing.
            </P>
          </Section>

          <Section id="limits" title="Limits">
            <P>
              Rate limits are per key and reported on <C>x-ratelimit-*</C>{" "}
              response headers. Prompts are capped by assembled character count
              rather than tokens, and a request over the cap is refused
              immediately instead of failing slowly.
            </P>
            <P>
              A request over that cap comes back as <C>413</C> with{" "}
              <C>context_length_exceeded</C> and the actual size in the message,
              so it is clear whether you were near the line or far over it. In
              long agent sessions the prompt is usually dominated by tool
              results rather than your own messages.
            </P>
            <div
              className="border border-rule px-4 py-3.5"
              style={{ borderRadius: "var(--r-sm)" }}
            >
              <p className="font-mono text-[11px] tracking-wide text-ink-3 uppercase">
                Request too large (max 32MB)
              </p>
              <p className="body mt-2 text-[13px]">
                Claude Code shows this for two different things and does not
                say which, so the 32MB figure is not to be trusted. It is
                sometimes its own guard refusing to send a request. It is just
                as often our <C>413</C> for a prompt over the character cap,
                relabelled — in which case both the number and the mention of
                attachments are wrong.
              </p>
              <p className="body mt-2 text-[13px]">
                On a fresh session the prompt is mostly Claude Code&apos;s own
                system prompt, its tool schemas, any <C>CLAUDE.md</C> and any
                MCP server tools, all sent before you type anything. Dropping
                unused MCP servers is the biggest single reduction; otherwise{" "}
                <C>/compact</C>, or press escape twice to rewind past a large
                file.
              </p>
            </div>
          </Section>
        </div>
      </div>
    </div>
  );
}

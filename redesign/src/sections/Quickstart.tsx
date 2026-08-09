import { CodeTabs, type Sample } from "../components/CodeTabs";
import { Reveal } from "../components/Reveal";
import { BASE } from "../lib/api";

const SAMPLES: Sample[] = [
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

stream = client.chat.completions.create(
    model="qwen3.8-max",
    messages=[{"role": "user", "content": "Explain closures."}],
    stream=True,
)

for chunk in stream:
    print(chunk.choices[0].delta.content or "", end="")`,
  },
  {
    lang: "TypeScript",
    code: `import OpenAI from "openai";

const client = new OpenAI({
  baseURL: "${BASE}/v1",
  apiKey: process.env.SYDE_API_KEY,
});

const stream = await client.chat.completions.create({
  model: "qwen3.8-max",
  messages: [{ role: "user", content: "Explain closures." }],
  stream: true,
});

for await (const chunk of stream) {
  process.stdout.write(chunk.choices[0]?.delta?.content ?? "");
}`,
  },
];

/**
 * Full-width single column, deliberately unlike every other section: the code
 * is the content, so nothing sits beside it competing for the eye.
 */
export function Quickstart() {
  return (
    <section className="border-b border-rule bg-[var(--paper-2)] py-20 md:py-28">
      <div className="field">
        <Reveal>
          <h2 className="h2 max-w-[20ch] text-ink">
            Change two lines. Keep your client.
          </h2>
          <p className="body mt-5">
            The OpenAI SDKs work unmodified against <code className="font-mono text-ink">/v1</code>.
            Anthropic SDKs and Claude Code use{" "}
            <code className="font-mono text-ink">/v1/messages</code> on the bare origin, since they
            append the path themselves.
          </p>
        </Reveal>

        <Reveal delay={0.08} className="mt-10">
          <CodeTabs samples={SAMPLES} />
        </Reveal>
      </div>
    </section>
  );
}

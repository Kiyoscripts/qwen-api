import { getT } from "@/lib/i18nServer";
import { Reveal } from "./Reveal";
import { CodeTabs } from "./CodeTabs";
import { BASE } from "./docs/samples";

/**
 * Full-width single column, deliberately unlike every other section: the code
 * is the content, so nothing sits beside it competing for the eye.
 */
export async function Quickstart() {
  const t = await getT();
  return (
    <section className="border-b border-rule bg-[var(--paper-2)] py-20 md:py-28">
      <div className="field">
        <Reveal>
          <h2 className="h2 max-w-[20ch] text-ink">{t("quickstart_title")}</h2>
          <p className="body mt-5">{t("quickstart_body")}</p>
        </Reveal>
        <Reveal delay={0.08} className="mt-10">
          <CodeTabs
            samples={[
              { lang: "curl", code: `curl ${BASE}/v1/chat/completions \\
  -H "Authorization: Bearer $SYDE_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{
    "model": "qwen3.8-max",
    "messages": [{ "role": "user", "content": "Explain closures." }]
  }'` },
              { lang: "Python", code: `from openai import OpenAI

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
    print(chunk.choices[0].delta.content or "", end="")` },
              { lang: "TypeScript", code: `import OpenAI from "openai";

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
}` },
            ]}
          />
        </Reveal>
      </div>
    </section>
  );
}

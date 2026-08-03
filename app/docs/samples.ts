// Code samples for the docs, kept out of the page so the page stays readable.
// Every one is written to run as-is once QWEN_API_KEY is set.

export const BASE = "https://qwen38-api-production.up.railway.app";

export const quickstart = [
  {
    lang: "curl",
    code: `curl ${BASE}/v1/chat/completions \\
  -H "Authorization: Bearer $QWEN_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{
    "model": "qwen3.8-max",
    "messages": [{ "role": "user", "content": "Explain closures in one sentence." }]
  }'`,
  },
  {
    lang: "Python",
    code: `# pip install openai
from openai import OpenAI

client = OpenAI(
    base_url="${BASE}/v1",
    api_key=os.environ["QWEN_API_KEY"],
)

r = client.chat.completions.create(
    model="qwen3.8-max",
    messages=[{"role": "user", "content": "Explain closures in one sentence."}],
)
print(r.choices[0].message.content)`,
  },
  {
    lang: "TypeScript",
    code: `// npm i openai
import OpenAI from "openai";

const client = new OpenAI({
  baseURL: "${BASE}/v1",
  apiKey: process.env.QWEN_API_KEY,
});

const r = await client.chat.completions.create({
  model: "qwen3.8-max",
  messages: [{ role: "user", content: "Explain closures in one sentence." }],
});
console.log(r.choices[0].message.content);`,
  },
  {
    lang: "Go",
    code: `// go get github.com/sashabaranov/go-openai
package main

import (
    "context"
    "fmt"
    "os"

    openai "github.com/sashabaranov/go-openai"
)

func main() {
    cfg := openai.DefaultConfig(os.Getenv("QWEN_API_KEY"))
    cfg.BaseURL = "${BASE}/v1"
    client := openai.NewClientWithConfig(cfg)

    resp, err := client.CreateChatCompletion(context.Background(), openai.ChatCompletionRequest{
        Model:    "qwen3.8-max",
        Messages: []openai.ChatCompletionMessage{{Role: "user", Content: "Explain closures in one sentence."}},
    })
    if err != nil {
        panic(err)
    }
    fmt.Println(resp.Choices[0].Message.Content)
}`,
  },
  {
    lang: "Ruby",
    code: `# gem install ruby-openai
require "openai"

client = OpenAI::Client.new(
  access_token: ENV.fetch("QWEN_API_KEY"),
  uri_base: "${BASE}/v1"
)

response = client.chat(parameters: {
  model: "qwen3.8-max",
  messages: [{ role: "user", content: "Explain closures in one sentence." }]
})
puts response.dig("choices", 0, "message", "content")`,
  },
  {
    lang: "PHP",
    code: `<?php
// composer require openai-php/client
require 'vendor/autoload.php';

$client = OpenAI::factory()
    ->withApiKey(getenv('QWEN_API_KEY'))
    ->withBaseUri('${BASE}/v1')
    ->make();

$result = $client->chat()->create([
    'model' => 'qwen3.8-max',
    'messages' => [['role' => 'user', 'content' => 'Explain closures in one sentence.']],
]);

echo $result->choices[0]->message->content;`,
  },
  {
    lang: "Java",
    code: `// A plain HTTP call — no SDK needed.
import java.net.URI;
import java.net.http.*;

var body = """
    {"model":"qwen3.8-max",
     "messages":[{"role":"user","content":"Explain closures in one sentence."}]}
    """;

var request = HttpRequest.newBuilder(URI.create("${BASE}/v1/chat/completions"))
    .header("Authorization", "Bearer " + System.getenv("QWEN_API_KEY"))
    .header("Content-Type", "application/json")
    .POST(HttpRequest.BodyPublishers.ofString(body))
    .build();

var response = HttpClient.newHttpClient()
    .send(request, HttpResponse.BodyHandlers.ofString());
System.out.println(response.body());`,
  },
  {
    lang: "C#",
    code: `// dotnet add package OpenAI
using OpenAI;
using OpenAI.Chat;
using System.ClientModel;

var options = new OpenAIClientOptions { Endpoint = new Uri("${BASE}/v1") };
var key = new ApiKeyCredential(Environment.GetEnvironmentVariable("QWEN_API_KEY")!);
var client = new ChatClient("qwen3.8-max", key, options);

ChatCompletion completion = client.CompleteChat("Explain closures in one sentence.");
Console.WriteLine(completion.Content[0].Text);`,
  },
];

export const streaming = [
  {
    lang: "curl",
    code: `curl -N ${BASE}/v1/chat/completions \\
  -H "Authorization: Bearer $QWEN_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{
    "model": "qwen3.8-max",
    "stream": true,
    "messages": [{ "role": "user", "content": "Count to five." }]
  }'

# Server-sent events. Lines beginning with ":" are keepalive comments —
# ignore them, as every SSE client already does.
#
# data: {"choices":[{"delta":{"content":"One"},"finish_reason":null}]}
# : keepalive
# data: {"choices":[{"delta":{},"finish_reason":"stop"}]}
# data: [DONE]`,
  },
  {
    lang: "Python",
    code: `stream = client.chat.completions.create(
    model="qwen3.8-max",
    messages=[{"role": "user", "content": "Count to five."}],
    stream=True,
)

for chunk in stream:
    delta = chunk.choices[0].delta
    # Reasoning arrives first, on its own field.
    if getattr(delta, "reasoning_content", None):
        print(delta.reasoning_content, end="", flush=True)
    if delta.content:
        print(delta.content, end="", flush=True)

    if chunk.choices[0].finish_reason == "length":
        print("\\n[cut off — send the partial back to continue]")`,
  },
  {
    lang: "TypeScript",
    code: `const stream = await client.chat.completions.create({
  model: "qwen3.8-max",
  messages: [{ role: "user", content: "Count to five." }],
  stream: true,
});

for await (const chunk of stream) {
  const choice = chunk.choices[0];
  // Reasoning models emit reasoning_content before any visible text.
  const reasoning = (choice.delta as any).reasoning_content;
  if (reasoning) process.stdout.write(reasoning);
  if (choice.delta.content) process.stdout.write(choice.delta.content);

  if (choice.finish_reason === "length") {
    console.warn("\\ncut off — resume by sending the partial back");
  }
}`,
  },
];

export const vision = [
  {
    lang: "curl",
    code: `curl ${BASE}/v1/chat/completions \\
  -H "Authorization: Bearer $QWEN_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{
    "model": "qwen3.8-max",
    "messages": [{
      "role": "user",
      "content": [
        { "type": "text", "text": "What is in this image?" },
        { "type": "image_url", "image_url": { "url": "https://example.com/cat.jpg" } }
      ]
    }]
  }'`,
  },
  {
    lang: "Python",
    code: `import base64

with open("cat.jpg", "rb") as f:
    b64 = base64.b64encode(f.read()).decode()

r = client.chat.completions.create(
    model="qwen3.8-max",
    messages=[{
        "role": "user",
        "content": [
            {"type": "text", "text": "What is in this image?"},
            # A public URL works too; data URLs avoid needing one.
            {"type": "image_url", "image_url": {"url": f"data:image/jpeg;base64,{b64}"}},
        ],
    }],
)
print(r.choices[0].message.content)`,
  },
  {
    lang: "TypeScript",
    code: `import { readFileSync } from "node:fs";

const b64 = readFileSync("cat.jpg").toString("base64");

const r = await client.chat.completions.create({
  model: "qwen3.8-max",
  messages: [{
    role: "user",
    content: [
      { type: "text", text: "What is in this image?" },
      { type: "image_url", image_url: { url: \`data:image/jpeg;base64,\${b64}\` } },
    ],
  }],
});`,
  },
];

export const tools = [
  {
    lang: "Python",
    code: `tools = [{
    "type": "function",
    "function": {
        "name": "get_weather",
        "description": "Current weather for a city",
        "parameters": {
            "type": "object",
            "properties": {
                "city": {"type": "string"},
                "days": {"type": "integer"},
            },
            "required": ["city"],
        },
    },
}]

messages = [{"role": "user", "content": "Weather in Paris?"}]
r = client.chat.completions.create(
    model="qwen3.8-max", messages=messages, tools=tools, tool_choice="auto"
)

call = r.choices[0].message.tool_calls[0]
messages.append(r.choices[0].message)
messages.append({
    "role": "tool",
    "tool_call_id": call.id,
    "name": call.function.name,
    "content": '{"temp_c": 19, "condition": "light rain"}',
})

final = client.chat.completions.create(
    model="qwen3.8-max", messages=messages, tools=tools
)
print(final.choices[0].message.content)`,
  },
  {
    lang: "TypeScript",
    code: `const tools = [{
  type: "function" as const,
  function: {
    name: "get_weather",
    description: "Current weather for a city",
    parameters: {
      type: "object",
      properties: { city: { type: "string" }, days: { type: "integer" } },
      required: ["city"],
    },
  },
}];

const messages: any[] = [{ role: "user", content: "Weather in Paris?" }];
const r = await client.chat.completions.create({
  model: "qwen3.8-max", messages, tools, tool_choice: "auto",
});

const call = r.choices[0].message.tool_calls![0];
messages.push(r.choices[0].message);
messages.push({
  role: "tool",
  tool_call_id: call.id,
  name: call.function.name,
  content: JSON.stringify({ temp_c: 19, condition: "light rain" }),
});

const final = await client.chat.completions.create({
  model: "qwen3.8-max", messages, tools,
});`,
  },
  {
    lang: "curl",
    code: `curl ${BASE}/v1/chat/completions \\
  -H "Authorization: Bearer $QWEN_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{
    "model": "qwen3.8-max",
    "messages": [{ "role": "user", "content": "Weather in Paris?" }],
    "tools": [{
      "type": "function",
      "function": {
        "name": "get_weather",
        "description": "Current weather for a city",
        "parameters": {
          "type": "object",
          "properties": { "city": { "type": "string" } },
          "required": ["city"]
        }
      }
    }],
    "tool_choice": "auto"
  }'`,
  },
];

export const images = [
  {
    lang: "curl",
    code: `# Generate
curl ${BASE}/v1/images/generations \\
  -H "Authorization: Bearer $QWEN_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{
    "model": "qwen-image-3.0",
    "prompt": "a lighthouse in a storm, oil painting",
    "size": "16:9"
  }'

# Edit — the presence of "image" is what switches generation to editing.
curl ${BASE}/v1/images/generations \\
  -H "Authorization: Bearer $QWEN_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{
    "model": "qwen-image-3.0",
    "prompt": "make it night time",
    "image": ["https://example.com/lighthouse.png"],
    "watermark": false
  }'`,
  },
  {
    lang: "Python",
    code: `import requests, os

r = requests.post(
    "${BASE}/v1/images/generations",
    headers={"Authorization": f"Bearer {os.environ['QWEN_API_KEY']}"},
    json={
        "model": "qwen-image-3.0",
        "prompt": "a lighthouse in a storm, oil painting",
        "size": "16:9",
        # "image": ["https://…/photo.png"],  # editing: up to several references
        # "watermark": False,                 # or a custom string
    },
    timeout=300,
)
print(r.json()["data"][0]["url"])`,
  },
];

export const video = [
  {
    lang: "curl",
    code: `# 1) Start the render. Returns immediately with a ticket.
curl ${BASE}/v1/videos/generations \\
  -H "Authorization: Bearer $QWEN_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{ "model": "qwen-wan", "prompt": "a paper boat sailing downstream", "size": "16:9" }'

# -> 202 { "id": "...", "ticket": "...", "status": "processing" }

# Image-to-video: add "image". The clip animates that picture.
#   -d '{ "prompt": "make it dance", "image": "data:image/png;base64,..." }'

# 2) Poll until it is done. The ticket pins polling to the right account.
curl "${BASE}/v1/videos/status?ticket=TICKET" \\
  -H "Authorization: Bearer $QWEN_API_KEY"

# -> { "status": "processing", "progress": 42 }
# -> { "status": "completed", "data": [{ "url": "https://…mp4" }] }`,
  },
  {
    lang: "Python",
    code: `import requests, time, os

H = {"Authorization": f"Bearer {os.environ['QWEN_API_KEY']}"}

start = requests.post(
    "${BASE}/v1/videos/generations",
    headers=H,
    json={
        "model": "qwen-wan",
        "prompt": "a paper boat sailing downstream",
        "size": "16:9",
        # "image": "data:image/png;base64,…",  # image-to-video
    },
).json()

# Renders take minutes, so poll rather than holding a request open.
while True:
    s = requests.get(
        "${BASE}/v1/videos/status",
        headers=H,
        params={"ticket": start["ticket"]},
    ).json()
    if s["status"] == "completed":
        print(s["data"][0]["url"])
        break
    if s["status"] == "failed":
        raise RuntimeError("render failed")
    print("progress:", s.get("progress"))
    time.sleep(5)`,
  },
];

export const speech = [
  {
    lang: "curl",
    code: `# List the ~78 voices
curl ${BASE}/v1/audio/voices -H "Authorization: Bearer $QWEN_API_KEY"

# Synthesise. Returns WAV bytes.
curl ${BASE}/v1/audio/speech \\
  -H "Authorization: Bearer $QWEN_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{ "input": "Hello from Qwen.", "voice": "Cherry" }' \\
  --output speech.wav`,
  },
  {
    lang: "Python",
    code: `import requests, os

audio = requests.post(
    "${BASE}/v1/audio/speech",
    headers={"Authorization": f"Bearer {os.environ['QWEN_API_KEY']}"},
    json={"input": "Hello from Qwen.", "voice": "Cherry"},
)
open("speech.wav", "wb").write(audio.content)`,
  },
];

export const anthropic = [
  {
    lang: "Claude Code",
    code: `# Point Claude Code at this API. Note the base URL is the ROOT —
# Claude Code appends /v1/messages itself.
export ANTHROPIC_BASE_URL="${BASE}"
export ANTHROPIC_API_KEY="qwen_sk_..."
export ANTHROPIC_MODEL="qwen3.8-max"
export ANTHROPIC_SMALL_FAST_MODEL="qwen3.8-max"

# ANTHROPIC_AUTH_TOKEN and CLAUDE_CODE_OAUTH_TOKEN take precedence over
# ANTHROPIC_API_KEY, so unset them or your key is ignored:
env -u ANTHROPIC_AUTH_TOKEN -u CLAUDE_CODE_OAUTH_TOKEN claude`,
  },
  {
    lang: "Python",
    code: `# pip install anthropic
from anthropic import Anthropic

client = Anthropic(
    base_url="${BASE}",      # root, not /v1
    api_key=os.environ["QWEN_API_KEY"],
)

msg = client.messages.create(
    model="qwen3.8-max",
    max_tokens=1024,
    messages=[{"role": "user", "content": "Explain closures in one sentence."}],
)
print(msg.content[0].text)`,
  },
  {
    lang: "curl",
    code: `curl ${BASE}/v1/messages \\
  -H "x-api-key: $QWEN_API_KEY" \\
  -H "anthropic-version: 2023-06-01" \\
  -H "Content-Type: application/json" \\
  -d '{
    "model": "qwen3.8-max",
    "max_tokens": 1024,
    "messages": [{ "role": "user", "content": "Explain closures in one sentence." }]
  }'

# Token counting is supported, which is what Claude Code calls before
# every message:
curl ${BASE}/v1/messages/count_tokens \\
  -H "x-api-key: $QWEN_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{ "model": "qwen3.8-max",
        "messages": [{ "role": "user", "content": "hi" }] }'`,
  },
];

export const continuation = [
  {
    lang: "Python",
    code: `def ask(messages):
    return client.chat.completions.create(
        model="qwen3.8-max", messages=messages
    )

messages = [{"role": "user", "content": "Write a long essay about TCP."}]
r = ask(messages)
text = r.choices[0].message.content

# "length" means the upstream stream was severed, not that you hit a token
# cap. Send the partial back and it continues from there — you pay for the
# remainder rather than regenerating the whole answer.
while r.choices[0].finish_reason == "length":
    messages += [
        {"role": "assistant", "content": text},
        {"role": "user", "content":
         "Continue from exactly where you stopped. Do not repeat anything."},
    ]
    r = ask(messages)
    text += r.choices[0].message.content

print(text)`,
  },
];

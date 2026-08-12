import { CANONICAL_URL } from "./canonicalHost";

/**
 * What the docs assistant is allowed to know.
 *
 * An assistant that answers from the model's own training will confidently
 * invent endpoints, parameter names and base URLs, and a wrong base URL is
 * worse than no answer: it fails at integration time with a 404 that looks like
 * our fault. So the reference below is the only source it gets, and the prompt
 * tells it to say when something is not covered rather than fill the gap.
 *
 * Kept in sync with app/syde/DocsBody.tsx by hand. It is deliberately terse:
 * this is a lookup table for a model, not prose for a human.
 */
const REFERENCE = `
BASE URLS
- OpenAI-compatible clients: ${CANONICAL_URL}/v1
- Anthropic-compatible clients and Claude Code: ${CANONICAL_URL} (no /v1; the SDK appends /v1/messages itself)
- Getting this backwards is the most common setup mistake and shows up as a hang or a 404 on the first message.

AUTHENTICATION
- Every request needs a key. Create one at /keys after linking Discord at /login.
- Header, either works on either endpoint: "Authorization: Bearer syde_sk_..." or "x-api-key: syde_sk_..."
- Keys are hashed at rest and shown exactly once on creation. Keys issued before the rename start with qwen_sk_ and still work.
- Requests from this site's own playground and chat authenticate with the session cookie instead.

ENDPOINTS
- POST /v1/chat/completions   OpenAI shape. stream, tools, tool_choice, temperature, max_tokens, enable_thinking, size, watermark.
- POST /v1/messages           Anthropic Messages API, including streaming and /v1/messages/count_tokens.
- GET  /v1/models             Every model the key can reach, with a capabilities block.
- POST /v1/images/generations Image generation and editing.
- POST /v1/videos/generations Video generation; it is a task, so it is started and then polled.
- POST /v1/audio/speech       Text to speech. GET /v1/audio/voices lists 78 voices.

STREAMING
- Set stream: true. Chunks are chat.completion.chunk and the stream closes with "data: [DONE]".
- Reasoning models put their thinking on delta.reasoning_content, separate from delta.content, so it can be shown or dropped.
- The stream sends ": keepalive" comment lines during long silences so proxies do not hang up. Every SSE client ignores them.

REASONING
- enable_thinking: false skips the thinking phase on models that offer both modes.
- qwen3.8-max-preview always reasons and ignores the flag.
- GET /v1/models is authoritative for the rest: capabilities.thinking says whether a model reasons at all.

TOOL CALLING
- Send OpenAI function schemas in "tools"; calls come back in choices[0].message.tool_calls.
- tool_choice takes "auto", "none", or a named function. parallel_tool_calls: false limits it to one call per turn.
- It works on every model on the endpoint, including ones with no native tool support.

INPUTS
- Read capabilities.input on any model rather than assuming.
- qwen3.8-max accepts image, file, video and audio. qwen3.8-max-preview accepts all of those except audio, which is the only difference between them. Other models differ, so read capabilities.input rather than assuming.
- Images are sent as a content part: { type: "image_url", image_url: { url } }, where url may be a data: URL.

MODELS
- Qwen ids look like qwen3.8-max. Other makers are prefixed: moonshotai/kimi-k3, openai/gpt-5.6-luna, deepseek/deepseek-v4-flash, deepseek/deepseek-v4-flash-zen, xai/grok-4.3, google/gemma-3.12b, nvidia/nemotron-3-ultra, cohere/north-mini-code, opencode/big-pickle, upstage/solar-pro-4, upstage/solar-open-2, z-ai/glm-5.2, meta/muse-glimmer-30b. Public ids never include "free".
- Media models: qwen-image-3.0, qwen-image-2.0 (both also edit), qwen-wan (video).
- Flagship context is 1,000,000 tokens.
- z-ai/glm-5.2 (GLM-5.2) comes from chatglm.cn and accepts image input. Its thinking modes are reasoning_effort none|medium|high, which map to the site's Fast, Standard and Deep; enable_thinking:true is Standard. Default is Fast.
- z-ai/glm-image (GLM Image) and z-ai/glm-image-fast (GLM Image Fast) generate images and reply with markdown media, like the Qwen image models. glm-image-fast also accepts a reference image; glm-image is text-to-image only. Both honour the watermark request field.
- meta/muse-glimmer-30b (Muse Glimmer 30B) comes from NVIDIA NIM and is listed only when NVIDIA_API_KEY is set. It reasons; the switch is enable_thinking (true/false), not reasoning_effort, and reasoning is ON by default. Cold starts can take a minute — stream to avoid a long silent wait.
- upstage/solar-pro-4 (Solar Pro 4) is Upstage's search agent: 512k context, text only, and it searches the web itself, appending the sources it cited. Its two headline modes are Instant (reasoning_effort "none", or enable_thinking false) and Thinking (reasoning_effort "xhigh", or enable_thinking true); "adaptive" lets the model pick. Default is Instant.

CODING CLIS
- Claude Code: ANTHROPIC_BASE_URL=${CANONICAL_URL} (no /v1), ANTHROPIC_AUTH_TOKEN=$SYDE_API_KEY, ANTHROPIC_MODEL=qwen3.8-max. Also set ANTHROPIC_SMALL_FAST_MODEL, or background calls fail while chat works.
- Codex: in ~/.codex/config.toml set model_provider with base_url = "${CANONICAL_URL}/v1", env_key = "SYDE_API_KEY", and wire_api = "chat". Without wire_api it defaults to the Responses API, which this endpoint does not implement.
- OpenCode: provider entry with npm "@ai-sdk/openai-compatible", baseURL "${CANONICAL_URL}/v1". Model id opencode/big-pickle is Big Pickle (only listed when OPENCODE_ZEN_API_KEY is set).
- Aider and most others: OPENAI_BASE_URL="${CANONICAL_URL}/v1" and OPENAI_API_KEY, then a model like openai/qwen3.8-max.
- reasoning_effort: multi-level effort when capabilities.reasoning_effort is present on /v1/models (e.g. deepseek/deepseek-v4-flash-zen: low|high|max; opencode/laguna-s-2.1: low|medium|high; moonshotai/kimi-k3 via TokenRouter: low|high|max; upstage/solar-pro-4: adaptive|none|minimal|low|medium|high|xhigh|max; z-ai/glm-5.2: none|medium|high for Fast/Standard/Deep). Omit or use enable_thinking only for models without that list.


ERRORS
- OpenAI envelope, and the Anthropic shape on /v1/messages. Upstream status codes pass through rather than being flattened.
- 401 missing or invalid key. 404 unknown model id. 429 rate limited, back off. 502 upstream refused or unreachable.
- finish_reason "length" means the reply was cut short and is resumable: send the partial back asking it to continue.

LIMITS
- Rate limits are per key and reported on x-ratelimit-* response headers.
- Prompts are capped by assembled character count, and an oversized request is refused immediately rather than failing slowly.
- Over the cap returns 413 with type context_length_exceeded and the measured size in the message. In agent sessions tool results usually dominate, not the user's own messages.

CLAUDE CODE SAYING "REQUEST TOO LARGE (MAX 32MB)"
- Claude Code shows this wording for two different things and does not distinguish them, so treat the 32MB figure as unreliable.
- It can be Claude Code's own guard refusing to send a request, usually after a very large file was read in.
- It can equally be our HTTP 413 for a prompt over the character cap, which Claude Code relabels with its own message. In that case the number and the mention of attachments are both wrong.
- The cap is a time budget rather than a context limit: upstream takes roughly a second per 1k characters against a 300s ceiling. The flagship context window itself is a million tokens.
- On a fresh session the prompt is mostly Claude Code's own system prompt, its tool schemas, any CLAUDE.md, and any MCP server tools, all of which are sent before the user types anything. Disconnecting unused MCP servers is the single biggest reduction.
- Remedies either way: /compact, press escape twice to rewind past a large file, drop unused MCP servers, or read part of a file rather than all of it.
`.trim();

export const DOCS_MODEL = "openai/gpt-5.6-luna";

/** The instruction the assistant runs under. */
export const DOCS_SYSTEM = `You help people use the Syde API. Answer only from the reference below.

Rules:
- If the reference does not cover something, say so plainly and point at the relevant docs section. Never invent an endpoint, parameter, model id or URL.
- Be brief. Two or three sentences, or a short code block. No preamble.
- When a base URL matters, state whether it takes /v1, because that is the most common mistake.
- Use the exact ids and header names from the reference.

REFERENCE
${REFERENCE}`;

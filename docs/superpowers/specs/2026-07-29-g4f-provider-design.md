# g4f.dev provider

Add `g4f.dev` as a third upstream alongside Qwen and OneCompiler, exposing 20
verified models through the existing OpenAI- and Anthropic-compatible endpoints.

## Why this upstream is cheap to add

Unlike Qwen (session creation, history flattening, proof-of-work) and OneCompiler
(raw-text stream, errors as HTTP 200), g4f speaks **plain OpenAI JSON** — real
roles, standard SSE, `reasoning_content` deltas. The client module is closer to a
passthrough than a translation layer.

## Upstream shape

Two URL forms, both OpenAI-compatible, both reached over `g4f.space`:

| Form | URL | Used by |
| --- | --- | --- |
| Named provider | `https://g4f.space/api/<provider>/chat/completions` | `ollama.pro` |
| Custom server | `https://g4f.space/custom/<srv_id>/chat/completions` | `crowllm` |

The difference is only in the base URL; request and response bodies are identical.
A single `route` field per registry entry absorbs it, so nothing downstream needs
to know which form a model uses.

### Authentication

**None.** All 20 models below were verified working with no `Authorization`
header and no cookies. The g4f client sends `Authorization: Bearer <token>` only
when `localStorage.g4f_session` exists (a logged-in account), and never sets
`credentials: 'include'` — `g4f.space` is cross-origin from `g4f.dev`, so cookies
are not sent on these calls at all.

An optional `G4F_TOKEN` is supported for future use, mirroring `ONECOMPILER_TOKEN`.
When unset — the expected case — requests go out anonymous and still work.

### Quota and throttling

Anonymous requests land in a **per-IP** bucket. Every response carries:

```
x-ratelimit-limit-requests: 200      x-ratelimit-remaining-requests: 81
x-ratelimit-limit-tokens: 500000     x-ratelimit-remaining-tokens: 495430
x-provider: ollama.pro               x-server: srv_mp2i8rco3148dd85bec1
```

The two routes throttle differently, and the wording matters because it is all we
get to distinguish them:

| Route | Message | Measured behaviour |
| --- | --- | --- |
| ollama.pro | `Rate limit 10s exceeded` | A **burst guard**, not a rate. Five sequential requests with no gap all pass; six concurrent all pass. It only fired when the whole 18-model registry was swept at once. |
| crowllm | `您已达到总请求数限制：1分钟内最多请求5次，包括失败次数` | A hard **5 requests per minute**, and failed attempts count against it. |

Two consequences drive the design:

- **No pre-emptive pacing.** An early draft spaced every request 10s apart. That
  was wrong: it cost each caller up to a full window on an idle route and bought
  nothing, because sequential traffic is not limited. Backoff is applied *after* a
  429, never before.
- **Cooldowns default to 60s, not 10s.** crowllm counts failures against its
  allowance, so returning early actively deepens the hole. The burst window is
  parsed out of the message when present (`Rate limit (\d+)s`); anything
  unrecognised gets the longer default.

On a deployment with one egress IP, this bucket is shared by every caller. That is
the binding capacity constraint for this provider, and the design accounts for it
rather than trying to escape it (see *Failover* and *Non-goals*).

## Model registry

Public ids are namespaced `g4f/<provider>/<model>`. Namespacing is required, not
cosmetic: `glm-5.2` exists on **both** ollama.pro and crowllm, and several ids
(`kimi-k2.6`, `deepseek-v4-pro`) collide with the existing OneCompiler registry.

Ids are matched **exactly**, as in `isOneCompilerModel` — a prefix test would
swallow ids belonging to other providers. An unknown id falls through to the Qwen
path rather than being claimed here.

Parsing splits on the first two `/` only; the remainder is the upstream model id.
None of the 20 entries below contain a slash, but other g4f servers expose ids
like `zai-org/GLM-5.1-FP8`, so the parser must not assume three segments.

### ollama.pro — 18 models, all verified

Route: `https://g4f.space/api/ollama.pro`

| Public id | Upstream id | Latency | `reasoning_content` |
| --- | --- | --- | --- |
| `g4f/ollama.pro/deepseek-v4-flash` | `deepseek-v4-flash` | 1.2s | yes |
| `g4f/ollama.pro/deepseek-v4-pro` | `deepseek-v4-pro` | 1.6s | yes |
| `g4f/ollama.pro/nemotron-3-nano:30b` | `nemotron-3-nano:30b` | 1.7s | yes |
| `g4f/ollama.pro/gpt-oss:20b` | `gpt-oss:20b` | 2.1s | yes |
| `g4f/ollama.pro/glm-5.2` | `glm-5.2` | 2.2s | yes |
| `g4f/ollama.pro/minimax-m3` | `minimax-m3` | 2.8s | yes |
| `g4f/ollama.pro/kimi-k2.6` | `kimi-k2.6` | 2.9s | yes |
| `g4f/ollama.pro/kimi-k2.7-code` | `kimi-k2.7-code` | 2.9s | yes |
| `g4f/ollama.pro/gpt-oss:120b` | `gpt-oss:120b` | 3.4s | yes |
| `g4f/ollama.pro/mistral-large-3:675b` | `mistral-large-3:675b` | 3.6s | no |
| `g4f/ollama.pro/kimi-k2.5` | `kimi-k2.5` | 3.7s | yes |
| `g4f/ollama.pro/nemotron-3-ultra` | `nemotron-3-ultra` | 3.8s | yes |
| `g4f/ollama.pro/glm-5.1` | `glm-5.1` | 4.1s | yes |
| `g4f/ollama.pro/minimax-m2.5` | `minimax-m2.5` | 5.4s | yes |
| `g4f/ollama.pro/minimax-m2.7` | `minimax-m2.7` | 6.2s | yes |
| `g4f/ollama.pro/nemotron-3-super` | `nemotron-3-super` | 10.3s | yes |
| `g4f/ollama.pro/qwen3.5:397b` | `qwen3.5:397b` | ~20s | yes |
| `g4f/ollama.pro/gemma4:31b` | `gemma4:31b` | **78.7s** | no |

Upstream ids use Ollama's colon convention (`gpt-oss:120b`), which differs from
the hyphenated form the same model carries on other g4f providers
(`gpt-oss-120b`). The registry stores the exact per-provider id; it is never
derived from the public id by substitution.

`gemma4:31b` at ~79s is well inside `maxDuration = 300` but is the entry most
likely to read as a hang to a caller. It ships, and the SSE keepalive already in
`app/api/v1/chat/completions/route.ts` covers the quiet stretch.

### crowllm — 2 models, all verified

Route: `https://g4f.space/custom/srv_mrgynwuz08a167112109`

| Public id | Upstream id | Latency |
| --- | --- | --- |
| `g4f/crowllm/glm-5.2` | `glm-5.2` | 2.1s |
| `g4f/crowllm/gemini-3.1-flash-lite` | `gemini-3.1-flash-lite` | 2.5s |

crowllm exposes 48 models; only these two are in scope. Adding more is a registry
edit and nothing else.

### Deliberately excluded

Ten combinations were requested and are **not** shipped, because each was verified
non-functional, anonymously, in both the browser UI and server-side:

| Combination | Why excluded |
| --- | --- |
| `big-pickle` / OpenCode Zen | `429 FreeUsageLimitError` — shared free pool exhausted |
| `gpt-5-2` / OpenaiChat | `401 Authentication required. Sign up at g4f.dev/members.html` |
| `claude45sonnet`, `o3`, `claude41opusthinking` / Perplexity | Anonymous tier allows exactly one model: `turbo` |
| `gpt-oss-120b`, `glm-4.7-flash` / Cloudflare AI | Provider absent from the logged-out catalogue |
| `hy3` / AnyProvider | Provider absent from the logged-out catalogue |
| `deepseek-r1`, `deepseek-v3` / DeepSeek (HAR Auth) | Provider absent from the logged-out catalogue |

These stay out of the registry entirely rather than shipping as entries that
always fail. `/v1/models` should advertise only what can actually run — a listed
model that 402s on every call is worse than an absent one, because callers build
against the catalogue.

`gpt-oss:120b` on ollama.pro covers the GPT-OSS 120B request; it is the same model
on a working route.

## Module design

`lib/g4f.ts`, following `lib/onecompiler.ts` structure:

```ts
export interface G4FModel {
  id: string;        // "g4f/ollama.pro/gpt-oss:120b"
  upstream: string;  // "gpt-oss:120b"
  route: string;     // "https://g4f.space/api/ollama.pro"
  name: string;      // "GPT-OSS 120B"
}

export const G4F_MODELS: G4FModel[]
export function isG4FModel(id: string): boolean
export function resolveG4FModel(id: string): G4FModel | null
export function openCompletion(opts): Promise<Response>
export async function* g4fDeltas(res): AsyncGenerator<G4FDelta>
export class G4FError extends Error { status: number }
```

`G4FDelta` is `{ kind: "text" | "reasoning", text: string }` so the route can
route reasoning to `reasoning_content` exactly as the Qwen path does, honouring
the existing `QWEN_SHOW_REASONING` behaviour rather than inventing a second knob.

Because the upstream is already OpenAI SSE, `g4fDeltas` is a `data:` line parser
over `choices[0].delta`, reading `.content` and `.reasoning_content`. It must
buffer across chunk boundaries — SSE events split mid-line — and skip
`data: [DONE]`.

### Error mapping

| Upstream | Surfaced as | Retries another route? |
| --- | --- | --- |
| `429` (any wording) | `429`, message passed through | **yes** |
| `401` / `403` | `402` with the upstream message | no — would fail identically |
| `5xx` | `502` | yes |
| unreachable | `502` | yes |
| other non-2xx | passed through, body truncated to 300 chars | no |

"Retryable" means *try a different route*, never the one that just refused. An
alternate is a separate host with an untouched budget, so a 429 is always worth
stepping over — which is why retryability is not conditioned on the message.

## Failover

Two mechanisms, neither of which evades a limit:

1. **Cross-route, same model.** `glm-5.2` exists on ollama.pro and crowllm. On a
   429 or 5xx, the same logical model is retried on its other route before
   failing. Registry entries carry an optional `alternates: string[]` of public
   ids, and the test suite asserts they resolve and are mutual.
2. **Reactive cooldown.** A route that returns 429 is marked cooling. Subsequent
   requests **skip** it in favour of an alternate rather than waiting — an idle
   alternate is strictly faster than sitting out a window — and only wait out the
   remainder when there is nothing else to try. This is a delay applied to our own
   traffic, not a bypass.

`x-ratelimit-remaining-requests` and `x-ratelimit-remaining-tokens` are read off
each response and logged, giving the same visibility the OneCompiler pool counter
provides today.

## Non-goals

**Quota evasion is out of scope.** The browser client derives an `x-user` header
from `localStorage`, which is why clearing site data appears to reset credits.
Rotating it per request is explicitly not implemented: it is abuse of a free
shared service, and `framework.js` deliberately obfuscates `getHeaders()` and
RSA-wraps a companion `x-secret` to prevent exactly that — making it both wrong
and unmaintainable. Capacity comes from failover, pacing, and (if ever needed)
tokens for accounts we own.

Also out of scope: tool calling (untested upstream — `lib/tools.ts` prompt
injection would apply unchanged if wanted later), vision, and image/audio/video
models.

## Wiring

Three integration points, matching how OneCompiler is wired:

1. **`app/api/v1/chat/completions/route.ts`** — an `isG4FModel(modelId)` branch
   before the Qwen fallthrough, dispatching to a `handleG4F` alongside
   `handleOneCompiler`.
2. **`app/api/v1/models/route.ts`** — a `g4fEntries` block from `G4F_MODELS`,
   `owned_by: "g4f"`, `capabilities: { vision: false, thinking: true, chat_types: ["t2t"] }`.
3. **`lib/modelIcons.ts`** — brand marks for the new makers (minimax, nemotron,
   mistral, gemma).

`/v1/messages` (Anthropic) needs no change: it normalises to the same internal
path and inherits the provider automatically.

## Testing

`tests/g4f.stream.test.mts`, added to the `test` script, offline like the
existing suite — synthetic `Response` objects, no network. Coverage:

- `data:` frames split across arbitrary chunk boundaries reassemble correctly,
  including multi-byte characters straddling a read boundary.
- `reasoning_content` deltas yield `kind: "reasoning"`, `content` yields
  `kind: "text"`, and interleaving is preserved.
- `data: [DONE]` terminates without emitting a delta.
- `isG4FModel` matches exactly: `g4f/ollama.pro/glm-5.2` hits,
  `g4f/crowllm/glm-5.2` hits a *different* entry, bare `glm-5.2` misses, and
  OneCompiler ids (`moonshotai/kimi-k2.6`) miss.
- Model id parsing survives an upstream id containing `/`.
- 429 with `Rate limit 10s exceeded` maps to a retryable error; 401 maps to 402.

## Risks

- **Shared IP budget.** 200 requests/500K tokens per IP is modest for a public
  API. Pacing and failover soften it; per-key rate limiting on our side (already
  flagged as a gap in `README.md`) is the real mitigation.
- **Upstream churn.** These are reverse-engineered free endpoints; server ids like
  `srv_mrgynwuz08a167112109` may be retired. Failure is a clean 502 and a
  registry edit, not a broken deploy.
- **`gemma4:31b` latency.** ~79s. Ships, but is the first candidate to drop if it
  degrades further.

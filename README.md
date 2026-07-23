# Qwen3.8 API

An **OpenAI-compatible** hosted API for `qwen3.8-max-preview` (with **vision**),
built on **Next.js + Vercel**, with API keys managed in **Supabase**. It proxies
to a chat.qwen.ai account (your token, server-side) and exposes a clean, keyed API.

- `POST /v1/chat/completions` — all models, streaming, vision, reasoning (`reasoning_content`), **tool/function calling**
- `POST /v1/images/generations` — text-to-image **& image editing** (OpenAI-compatible); models `qwen-image-3.0` / `qwen-image-2.0`, `size` aspect ratio, `image`/`images` references, and a `watermark` field (see below)
- `POST /v1/videos/generations` — text-to-video; returns `202 { id, chat_id, status, created }` immediately
- `GET  /v1/videos/status?task_id=…&chat_id=…&started=…` — poll a video task (**no timeout**); pass
  `started` (the `created` value from generation) to get an estimated `progress` back
- `POST /v1/audio/speech` — text-to-speech → `audio/wav` (`{ "input": "...", "voice": "Cherry" }`)
- `GET  /v1/audio/voices` — lists the ~78 TTS voices (name, gender, description)
- `GET  /v1/models` — lists **all** Qwen models
- `POST /api/keys` — **public** self-serve API key creation (also on the homepage)
- `/admin` — password-protected dashboard to manage the pooled Qwen tokens & view keys

### Tool / function calling

Standard OpenAI `tools` are supported on `POST /v1/chat/completions`. Qwen has no
native tool API, so the schemas are injected into the prompt (Qwen-native
`<tool_call>` convention) and parsed back into OpenAI `tool_calls`; send results
back as `role:"tool"` messages. It's best-effort emulation, not a guarantee, but
Qwen3 is trained for function calling so it's reliable for normal agent use.

- `tool_choice`: `"auto"` (default), `"none"` (ignore tools), `"required"`, or a
  specific `{ "type":"function","function":{"name":"..."} }`.
- Parallel tool calls, streaming (`tool_calls` deltas), and multi-turn loops work.
- Test it interactively in `/playground` and `/chat` (🔧 **Tools** toggle) — they
  ship built-in demo tools (`get_weather`, `get_current_time`, `calculator`) that
  execute in the browser so you can watch a full call loop.

> Tool-calling method credit: Discord user `.thereid`.

### Image watermark

Generated images are stamped with a **`Qwen3.8 API`** watermark (bottom-right) by
default. Callers control it per request with the `watermark` field — on both
`POST /v1/images/generations` and `POST /v1/chat/completions` (image models):

| `watermark` value | Result |
| --- | --- |
| *omitted* | default `Qwen3.8 API` |
| `false` (or `""`, `"none"`) | no watermark |
| `"your text"` | custom text (up to 64 chars) |

```bash
# custom text
curl .../v1/images/generations -H "Authorization: Bearer qwen_sk_..." \
  -d '{ "prompt": "a red apple", "watermark": "yourbrand.com" }'

# no watermark
  -d '{ "prompt": "a red apple", "watermark": false }'
```

The mark is composited into the pixels server-side, so it survives download. The
`/chat` and playground UIs always use the default watermark. Watermarked images are
served through `/api/media?t=…`, where the source URL + watermark are **AES-GCM
encrypted** into an opaque token — the underlying (signed) Qwen CDN URL is hidden
and the watermark is tamper-evident (editing the token fails the auth tag). Set
`MEDIA_SECRET` in production so tokens can't be forged. The link lives as long as
the underlying Qwen CDN signature.

### Image editing (reference images)

Send one or more `image`s (or `images`) with a prompt to **edit / use a reference**
instead of generating from scratch — the request switches from `t2i` to
`image_edit` automatically. Images can be public URLs or `data:` URLs.

```bash
# edit an existing image
curl .../v1/images/generations -H "Authorization: Bearer qwen_sk_..." \
  -d '{
    "model": "qwen-image-3.0",
    "prompt": "make it night time, add neon signs",
    "image": "https://example.com/street.jpg"
  }'

# multiple references
  -d '{ "prompt": "combine these into one scene", "images": ["https://…/a.png", "data:image/png;base64,…"] }'
```

Accepted shapes for `image`/`images`: a URL string, an array of URL strings, or
OpenAI-style `{ "url": "…" }` / `{ "image_url": { "url": "…" } }` objects. In the
**`/chat`** UI, pick an image model, click the 📎 attach button, add a prompt, and
send — the attached image becomes the edit reference. Same for the **playground**
Image mode.

### Video generation (`qwen-wan`)

On by default — set `ENABLE_VIDEO_GENERATION=false` to hide the `qwen-wan` model
and disable the `/v1/videos/*` endpoints. Generation is async (many minutes): the
POST returns a task id immediately and you poll for the result.

```bash
# 1) kick it off (optional: size, image for image-to-video, watermark)
curl .../v1/videos/generations -H "Authorization: Bearer qwen_sk_..." \
  -d '{ "prompt": "someone walking in New York", "size": "16:9" }'
# image-to-video:  -d '{ "prompt": "make it move", "image": "https://…/photo.jpg" }'
# -> 202 { "id": "<task>", "chat_id": "<chat>", "status": "processing",
#          "created": 1737…, "ticket": "<opaque>" }

# 2) poll with the ticket (carries task/chat/started AND pins to the right account)
curl ".../v1/videos/status?ticket=<opaque>" -H "Authorization: Bearer qwen_sk_..."
# -> { "status": "processing", "progress": 62 }
# -> { "status": "completed", "progress": 100, "data": [{ "url": "https://…mp4" }] }
```

**Always poll with the `ticket`.** A video task lives on exactly one pooled account,
but each request otherwise picks a random account — so polling a random one gets
"not found" and spins forever. The `ticket` (AES-GCM sealed) pins the poll to the
account that created the task. You *can* poll by `task_id` instead, but then the
server has to scan the whole pool each call to find the owner.

**Progress is an estimate.** Qwen's API exposes no real progress value — the web UI
animates a time-based curve, and so do we (an eased creep toward ~95%, snapping to
100% on completion). It comes from the ticket's `created` (or a `started` query
param). Image generation is synchronous (one request, returns the URL), so it has
no progress to report.

> Video status is polled at `GET /api/v1/tasks/status/{id}` upstream (Qwen moved it
> from `v2` to `v1`; the old path 404s, which looks like "video never finishes").

**Aspect ratio + reference image.** Pass `size` (`16:9`, `9:16`, `1:1`, `4:3`,
`3:4`) for the video's shape, and `image` (a URL or data URL) to seed **image-to-
video**. Video also works in `/v1/chat/completions` and the `/chat` UI: select
`qwen-wan`, optionally attach an image, and send a prompt.

**No watermark on video.** Unlike images, generated video is returned unwatermarked
— burning text into an MP4 means re-encoding the clip, which broke playback, so the
raw video is served (proxied through `/api/media` for display). The `watermark`
field only affects image generation.

### Multiple accounts (token pool)

The API rotates across a **pool of Qwen account tokens** so no single account gets
rate-limited or flagged. Add tokens in the `/admin` dashboard (password = your
`ADMIN_SECRET`). The `QWEN_TOKEN` env var is always included as a fallback. This is
what keeps a public deployment from hammering one account.

> ⚠️ Key creation is **public**: anyone can mint a key, and every key runs through
> your single shared Qwen account. Consider adding rate limiting / per-key usage
> caps before promoting this widely.

## 1. Supabase setup

1. Open your Supabase project → **SQL Editor** → **New query**.
2. Paste the contents of [`supabase/schema.sql`](./supabase/schema.sql) and **Run**.
   This creates `api_keys`, `usage_logs`, and **`qwen_tokens`** (the account pool) —
   all with RLS on and no policies, so only the service role can touch them —
   plus a `touch_api_key` function.

   > If you already ran an earlier version of this file, re-run it (or just run the
   > `qwen_tokens` table block) to add the token pool table.

## 2. Environment variables

Copy `.env.example` → `.env.local` and fill in (already done locally):

| Var | What |
| --- | --- |
| `SUPABASE_URL` | `https://<ref>.supabase.co` |
| `SUPABASE_SERVICE_ROLE_KEY` | Service role JWT (secret, server-only). |
| `SUPABASE_ANON_KEY` / `SUPABASE_PUBLISHABLE_KEY` | Public keys (kept for reference). |
| `ADMIN_SECRET` | Secret for the `/api/admin/keys` endpoint. |
| `QWEN_TOKEN` | Bearer token from chat.qwen.ai `localStorage["token"]`. |
| `QWEN_CLIENT_VERSION` | `Version` header (bump if Qwen updates their site). |
| `QWEN_THINKING` | `false` = final answer only; `true` = include reasoning. |
| `QWEN_FORGET_MEMORIES` | `true` = wipe Qwen's saved memories after each request. |

## 3. Run locally

```bash
npm install
npm run dev
# open http://localhost:3000
```

## 4. Deploy to Vercel

```bash
npm i -g vercel      # if needed
vercel                # link + deploy a preview
vercel --prod         # production
```

Then add every variable from `.env.local` in **Vercel → Project → Settings →
Environment Variables** (Production + Preview). Redeploy.

## 5. Get an API key

Visit the homepage and click **Generate key**. Key creation is protected by
**Vercel BotID** — it only works from a real browser session on the site, so
scripted/`curl` requests to `/api/keys` are blocked. It's also rate-limited
(3/hr, 10/day per IP) and an IP that mass-creates keys is auto-blacklisted and
its keys purged.

Abuse controls (all env-tunable):

| Var | Default | Purpose |
| --- | --- | --- |
| `PUBLIC_KEY_CREATION` | `true` | `false` = key creation becomes admin-only (kill switch). |
| `KEY_RL_PER_IP_HOUR` / `KEY_RL_PER_IP_DAY` | `3` / `10` | Per-IP creation limits. |
| `KEY_RL_GLOBAL_HOUR` | `0` (off) | Global/hour cap — leave off; it 429s everyone during a flood. |
| `KEY_BLACKLIST_THRESHOLD` | `12` | Auto-ban an IP + delete its keys after this many. |

The owner can always create keys out-of-band (bypasses BotID) via the admin
endpoint, and list/revoke keys there:

```bash
curl -X POST https://qwen3-8-api.vercel.app/api/admin/keys \
  -H "x-admin-secret: <ADMIN_SECRET>" -H "Content-Type: application/json" \
  -d '{"name":"my key"}'
curl https://qwen3-8-api.vercel.app/api/admin/keys -H "x-admin-secret: <ADMIN_SECRET>"
```

## 6. Use it

```bash
curl https://qwen3-8-api.vercel.app/v1/chat/completions \
  -H "Authorization: Bearer qwen_sk_..." \
  -H "Content-Type: application/json" \
  -d '{"model":"qwen3.8-max-preview","messages":[{"role":"user","content":"Hi"}]}'
```

Vision — send `image_url` parts (base64 data URL or public URL):

```json
{
  "model": "qwen3.8-max-preview",
  "messages": [{
    "role": "user",
    "content": [
      { "type": "text", "text": "Describe this image." },
      { "type": "image_url", "image_url": { "url": "data:image/png;base64,..." } }
    ]
  }]
}
```

## Video generation (no timeout)

Video can take many minutes and a serverless function can't stay open forever, so
generation is **asynchronous**: you get a task id back instantly and poll it for
as long as you like.

```bash
# 1. start the render -> 202
curl -X POST https://qwen3-8-api.vercel.app/v1/videos/generations \
  -H "Authorization: Bearer qwen_sk_..." -H "Content-Type: application/json" \
  -d '{"prompt":"a man waving hello"}'
# -> {"id":"<task>","chat_id":"<chat>","status":"processing"}

# 2. poll until done (as long as it takes)
curl "https://qwen3-8-api.vercel.app/v1/videos/status?task_id=<task>&chat_id=<chat>" \
  -H "Authorization: Bearer qwen_sk_..."
# -> {"status":"processing"}  ... then {"status":"completed","data":[{"url":"…mp4"}]}
```

Pass `"wait": true` if you'd rather block and get the URL directly (bounded by the
function's max duration; it falls back to a 202 task id if it runs long).

## Serving generated media

Qwen's CDN URLs are signed and referer-checked, so they often won't load directly
in a browser `<img>`/`<video>`. Re-serve them through `GET /api/media?url=<encoded>`
(host-allowlisted to Qwen/Alibaba CDNs only). The playground does this automatically.

## Text-to-speech

```bash
curl -X POST https://qwen3-8-api.vercel.app/v1/audio/speech \
  -H "Authorization: Bearer qwen_sk_..." -H "Content-Type: application/json" \
  -d '{"input":"Hello there","voice":"Cherry"}' --output speech.wav
```

Output is 24 kHz, 16-bit mono WAV. List voices with `GET /v1/audio/voices`
(Cherry, Dylan, Kiki, Vivian, Serena, Momo, Moon, …).

Two honest caveats about how Qwen's TTS works:

- Qwen can only *read aloud a message that exists in a chat* — there's no raw
  text→speech endpoint. So this route first has the model echo your text back
  verbatim, then runs "read aloud" on that message. That means an extra model
  call per request, and very occasionally the echo isn't 100% word-for-word.
- The voice is an **account-level setting**, not a per-request parameter. The
  route sets it on the pooled account right before synthesising, so two
  concurrent requests with different voices on the *same* token can race. More
  tokens in the pool makes this less likely.

## How it works / notes

- **Stateless** like the OpenAI API: send the full `messages` history each call.
  Internally the proxy collapses it into one Qwen message (Qwen only accepts one
  message per call and keeps state server-side).
- Each request runs in a **throwaway Qwen chat** that is created, used, then
  deleted, and Qwen's auto-saved memories are wiped — so the shared account and
  its sidebar stay clean between requests/users.
- **All traffic uses one shared Qwen account** (your token). Its rate limits and
  Terms of Service apply to the whole API. Keep `QWEN_TOKEN` fresh (see below).
- **Tool/function-calling is not supported.** chat.qwen.ai ignores custom function
  schemas, and emulating it via prompting proved unreliable, so it was removed.
  Sending `tools` returns a clear 400 rather than silently answering in prose.
- If completions start failing with `Internal error`, Qwen probably updated their
  frontend: set `QWEN_CLIENT_VERSION` to the new `Version` header value from
  DevTools → Network on chat.qwen.ai. If you see `unauthorized`, refresh
  `QWEN_TOKEN`.

## Security

- `SUPABASE_SERVICE_ROLE_KEY`, `ADMIN_SECRET`, and `QWEN_TOKEN` are **secrets** —
  they live only in `.env.local` (gitignored) and Vercel env. Never commit them.
- API keys are stored as SHA-256 hashes; the raw key is shown only once at creation.

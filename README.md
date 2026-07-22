# Qwen3.8 API

An **OpenAI-compatible** hosted API for `qwen3.8-max-preview` (with **vision**),
built on **Next.js + Vercel**, with API keys managed in **Supabase**. It proxies
to a chat.qwen.ai account (your token, server-side) and exposes a clean, keyed API.

- `POST /v1/chat/completions` — all models, streaming, vision, reasoning (`reasoning_content`)
- `POST /v1/images/generations` — text-to-image (OpenAI-compatible)
- `POST /v1/videos/generations` — text-to-video; returns `202 { id, chat_id, status }` immediately
- `GET  /v1/videos/status?task_id=…&chat_id=…` — poll a video task (**no timeout** — render as long as it needs)
- `POST /v1/audio/speech` — text-to-speech → `audio/wav` (`{ "input": "...", "voice": "Cherry" }`)
- `GET  /v1/audio/voices` — lists the ~78 TTS voices (name, gender, description)
- `GET  /v1/models` — lists **all** Qwen models
- `POST /api/keys` — **public** self-serve API key creation (also on the homepage)
- `/admin` — password-protected dashboard to manage the pooled Qwen tokens & view keys

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

# Qwen3.8 API

An **OpenAI-compatible** hosted API for `qwen3.8-max-preview` (with **vision**),
built on **Next.js + Vercel**, with API keys managed in **Supabase**. It proxies
to a chat.qwen.ai account (your token, server-side) and exposes a clean, keyed API.

- `POST /v1/chat/completions` — streaming & non-streaming, supports image inputs
- `GET  /v1/models` — the single available model
- `POST /api/admin/keys` — issue an API key (admin-only)
- `GET  /api/admin/keys` — list keys (admin-only)

## 1. Supabase setup

1. Open your Supabase project → **SQL Editor** → **New query**.
2. Paste the contents of [`supabase/schema.sql`](./supabase/schema.sql) and **Run**.
   This creates `api_keys` + `usage_logs` (RLS on, no policies — only the service
   role can touch them) and a `touch_api_key` function.

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

## 5. Issue an API key

```bash
curl -X POST https://YOUR-DEPLOYMENT.vercel.app/api/admin/keys \
  -H "x-admin-secret: <ADMIN_SECRET>" \
  -H "Content-Type: application/json" \
  -d '{"name":"my first key"}'
# -> { "key": "qwen_sk_...", ... }   (shown once; only its hash is stored)
```

## 6. Use it

```bash
curl https://YOUR-DEPLOYMENT.vercel.app/v1/chat/completions \
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

## How it works / notes

- **Stateless** like the OpenAI API: send the full `messages` history each call.
  Internally the proxy collapses it into one Qwen message (Qwen only accepts one
  message per call and keeps state server-side).
- Each request runs in a **throwaway Qwen chat** that is created, used, then
  deleted, and Qwen's auto-saved memories are wiped — so the shared account and
  its sidebar stay clean between requests/users.
- **All traffic uses one shared Qwen account** (your token). Its rate limits and
  Terms of Service apply to the whole API. Keep `QWEN_TOKEN` fresh (see below).
- **Tool/function-calling is not supported** — chat.qwen.ai doesn't accept custom
  function schemas (its tools are its own built-ins / MCP).
- If completions start failing with `Internal error`, Qwen probably updated their
  frontend: set `QWEN_CLIENT_VERSION` to the new `Version` header value from
  DevTools → Network on chat.qwen.ai. If you see `unauthorized`, refresh
  `QWEN_TOKEN`.

## Security

- `SUPABASE_SERVICE_ROLE_KEY`, `ADMIN_SECRET`, and `QWEN_TOKEN` are **secrets** —
  they live only in `.env.local` (gitignored) and Vercel env. Never commit them.
- API keys are stored as SHA-256 hashes; the raw key is shown only once at creation.

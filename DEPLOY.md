# Deploying to Google Cloud Run

Why: a serverless function is capped at 300s, which severs long generations
mid-reply. Cloud Run runs a real container and allows up to 60 minutes per
request, so the ceiling stops being the binding constraint.

Vercel still works from the same repo — `output: "standalone"` is ignored there
— so you can run both until you're happy.

---

## 1. Install and sign in

```bash
brew install --cask google-cloud-sdk     # or https://cloud.google.com/sdk/docs/install
gcloud init                              # sign in, pick/create a project
```

Note the project id it prints; everything below uses it.

## 2. Enable the services

```bash
gcloud services enable run.googleapis.com \
                       cloudbuild.googleapis.com \
                       artifactregistry.googleapis.com \
                       secretmanager.googleapis.com
```

Billing must be enabled on the project. The always-free quota (2M requests,
180k vCPU-seconds, 360k GiB-seconds per month) is permanent, not a trial, and
step 5 caps spend so an unexpected spike can't run up a bill.

## 3. Put the secrets in Secret Manager

Do **not** pass these with `--set-env-vars`: that stores them in plain text on
the service, visible to anyone with console read access.

```bash
for k in QWEN_TOKEN SUPABASE_URL SUPABASE_SERVICE_ROLE_KEY SUPABASE_ANON_KEY \
         SUPABASE_PUBLISHABLE_KEY ADMIN_SECRET MEDIA_SECRET LINK_BOT_SECRET; do
  v=$(grep "^$k=" .env.local | cut -d= -f2- | sed 's/^"//; s/"$//')
  [ -n "$v" ] || { echo "skip $k (not set locally)"; continue; }
  printf '%s' "$v" | gcloud secrets create "$k" --data-file=- 2>/dev/null \
    || printf '%s' "$v" | gcloud secrets versions add "$k" --data-file=-
done
```

Grant the runtime service account read access:

```bash
PROJECT=$(gcloud config get-value project)
NUM=$(gcloud projects describe "$PROJECT" --format='value(projectNumber)')
for k in QWEN_TOKEN SUPABASE_URL SUPABASE_SERVICE_ROLE_KEY SUPABASE_ANON_KEY \
         SUPABASE_PUBLISHABLE_KEY ADMIN_SECRET MEDIA_SECRET LINK_BOT_SECRET; do
  gcloud secrets add-iam-policy-binding "$k" \
    --member="serviceAccount:${NUM}-compute@developer.gserviceaccount.com" \
    --role=roles/secretmanager.secretAccessor >/dev/null 2>&1
done
```

Two of these are not in `.env.local` and must come from the Vercel dashboard
(Settings → Environment Variables), or the corresponding feature breaks:

- `LINK_BOT_SECRET` — the shared secret the Discord bot uses for `/api/discord/code`.
- `CRON_SECRET` — optional; see step 6.

**`ADMIN_SECRET` must be copied across byte-for-byte.** `lib/secureToken.ts`
derives its key from `MEDIA_SECRET || ADMIN_SECRET || <dev default>`, and you
have no `MEDIA_SECRET` set, so `ADMIN_SECRET` is what currently signs:

- every `qwen_session` login cookie — a different value logs everyone out;
- every `/api/media` token — a different value 404s images already handed out.

Keep it identical and the migration is invisible to users. (Setting an explicit
`MEDIA_SECRET` equal to today's `ADMIN_SECRET` is tidier long-term, but do that
as a separate change, not during the move.)

## 4. Deploy

Building from source uses Cloud Build, which builds on x86_64. That matters:
`sharp` ships architecture-specific binaries, so an image built locally on an
Apple-silicon Mac would install arm64 and fail on Cloud Run. Let Cloud Build do
it, or use `docker buildx build --platform linux/amd64`.

```bash
gcloud run deploy qwen38-api \
  --source . \
  --region us-central1 \
  --allow-unauthenticated \
  --timeout 3600 \
  --memory 1Gi \
  --cpu 1 \
  --max-instances 2 \
  --concurrency 40 \
  --set-secrets QWEN_TOKEN=QWEN_TOKEN:latest,\
SUPABASE_URL=SUPABASE_URL:latest,\
SUPABASE_SERVICE_ROLE_KEY=SUPABASE_SERVICE_ROLE_KEY:latest,\
SUPABASE_ANON_KEY=SUPABASE_ANON_KEY:latest,\
SUPABASE_PUBLISHABLE_KEY=SUPABASE_PUBLISHABLE_KEY:latest,\
ADMIN_SECRET=ADMIN_SECRET:latest,\
MEDIA_SECRET=MEDIA_SECRET:latest,\
LINK_BOT_SECRET=LINK_BOT_SECRET:latest \
  --set-env-vars QWEN_SHOW_REASONING=true,QWEN_FORGET_MEMORIES=true
```

- `--region us-central1` — the free quota is region-locked (`us-central1`,
  `us-west1`, `us-east1`).
- `--timeout 3600` — the whole point. 60 minutes instead of 300 seconds.
- `--max-instances 2` — the spend cap. Two containers is plenty for this
  traffic and means a flood can't scale you into a bill.
- `--concurrency 40` — one container serves many streams at once; they are
  almost entirely idle, waiting on Qwen.

Add `QWEN_CLIENT_VERSION` to `--set-env-vars` if you pin it locally.

## 5. Cap the spend

```bash
gcloud billing budgets create \
  --billing-account="$(gcloud billing projects describe "$PROJECT" \
      --format='value(billingAccountName)' | cut -d/ -f2)" \
  --display-name="qwen38-api" \
  --budget-amount=1USD \
  --threshold-rule=percent=0.5 --threshold-rule=percent=1.0
```

A budget alerts, it does not stop traffic — `--max-instances` is what actually
bounds the cost.

## 6. Replace the cron

`vercel.json` runs `/api/cron/cleanup` daily at 03:00. Cloud Scheduler's free
tier covers three jobs:

```bash
gcloud services enable cloudscheduler.googleapis.com
gcloud scheduler jobs create http qwen38-cleanup \
  --location us-central1 \
  --schedule "0 3 * * *" \
  --uri "https://YOUR-SERVICE-URL/api/cron/cleanup" \
  --http-method GET
```

`/api/cron/cleanup` only enforces auth when `CRON_SECRET` is set, and you don't
set it — so on a public URL anyone can trigger it. It only deletes anonymous
keys older than three days, so the blast radius is small, but this is a good
moment to close it:

```bash
printf '%s' "$(openssl rand -hex 24)" | gcloud secrets create CRON_SECRET --data-file=-
# add CRON_SECRET=CRON_SECRET:latest to --set-secrets, redeploy, then:
gcloud scheduler jobs update http qwen38-cleanup --location us-central1 \
  --update-headers "Authorization=Bearer $(gcloud secrets versions access latest --secret=CRON_SECRET)"
```

The cleanup also runs opportunistically from `/api/stats`, so the schedule is a
backstop rather than the only path.

## 7. Point the domain

Cloud Run gives you a `*.run.app` URL immediately. To keep the current
hostname, map it:

```bash
gcloud beta run domain-mappings create \
  --service qwen38-api --domain api.yourdomain.com --region us-central1
```

Then update `BASE` in `app/page.tsx` and the docs so the copy-paste snippets
show the new URL.

---

## Known differences from Vercel

- **BotID** (`botid`) is a Vercel product. Off-platform `checkBotId` does not
  challenge, so `/api/keys` loses that protection. The per-IP rate limiting and
  blacklisting in that route still apply. Remove the dependency or accept the
  gap.
- **No `maxDuration`.** The `export const maxDuration = 300` lines become inert;
  the container limit is `--timeout`. Harmless to leave for Vercel parity.
- **Cold starts** are roughly a second — the standalone server boots in ~110ms,
  the rest is pulling the image. Far below Render's 30–60s, but not zero. Set
  `--min-instances 1` to remove them entirely; that runs a container full time
  and leaves the free tier.

## Verifying the fix

The reason for all this is the request ceiling, so confirm it moved:

```bash
curl -N https://YOUR-SERVICE-URL/v1/chat/completions \
  -H "Authorization: Bearer $KEY" -H "Content-Type: application/json" \
  -d '{"model":"qwen3.8-max-preview","stream":true,
       "messages":[{"role":"user","content":"Write a very long, detailed essay."}]}' \
  | tail -5
```

A healthy finish ends `"finish_reason":"stop"`. `"length"` means it was severed
again — check the logs for the `[truncated] … after ~Ns of …` line to see how
far it got:

```bash
gcloud run services logs read qwen38-api --region us-central1 --limit 50 \
  | grep truncated
```

If those still cluster near a limit, the ceiling was never the cause and Qwen
is dropping the connection — no amount of extra duration will help.

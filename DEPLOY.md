# Deploying to Google Cloud Run

Why: a serverless function is capped at 300s, which severs long generations
mid-reply. Cloud Run runs a real container and allows up to 60 minutes per
request, so the ceiling stops being the binding constraint.

Vercel still works from the same repo — `output: "standalone"` is ignored there
— so you can run both until you're happy.

**Where this runs.** On Google's infrastructure, not your machine. `gcloud run
deploy` uploads the source, Cloud Build builds it on Google's servers, and Cloud
Run serves it from Google's servers. Your laptop is involved only while that one
command is in flight; afterwards you can close it and the API keeps answering.
Step 8 removes even that, deploying straight from a GitHub push.

Not to be confused with `npm run dev`, which serves `localhost:3000` from your
machine and stops when you close the lid. That is only for development.

---

## 1. Install and sign in

```bash
brew install --cask google-cloud-sdk     # or https://cloud.google.com/sdk/docs/install
gcloud init                              # sign in, pick/create a project
```

Note the project id it prints; everything below uses it.

## 2. Link a billing account — do this first

Google will not let you enable *any* API on a project without one, so skipping
this makes every later step fail with a confusing error somewhere else.

```bash
gcloud billing accounts list
```

If that lists an account, link it:

```bash
gcloud billing projects link qwen38-api --billing-account=XXXXXX-XXXXXX-XXXXXX
```

If it lists nothing, create one — this part cannot be scripted:

1. Open <https://console.cloud.google.com/billing> and choose
   **Create account** (or **Add billing account**).
2. Pick your country and accept the terms.
3. Enter the card. Google runs a small authorization, typically ~$0–1, and
   refunds it; it is a verification, not a charge.
4. If it offers the **$300 / 90-day free trial**, take it. While the trial is
   active you cannot be charged at all, and when it ends Google does *not*
   silently start billing — the account stays suspended until you manually
   upgrade it. That is a useful backstop on top of `--max-instances`.
5. Back in the terminal, `gcloud billing accounts list` should now show it.

Being billable is not the same as being billed. The always-free quota (2M
requests, 180k vCPU-seconds, 360k GiB-seconds per month) is permanent rather
than a trial, `--max-instances 2` in step 5 bounds how much can ever run, and
step 6 adds an alert. New accounts also get a $300 credit that would absorb any
mistake long before real money moved.

If you would rather not attach a card at all, stop here — see
"No-card alternatives" at the end.

## 3. Enable the services

```bash
gcloud services enable run.googleapis.com \
                       cloudbuild.googleapis.com \
                       artifactregistry.googleapis.com \
                       secretmanager.googleapis.com
```

Wait for this to return before continuing; enabling propagates for a minute or
two, and the secret commands below fail until it has.

## 4. Put the secrets in Secret Manager

Do **not** pass these with `--set-env-vars`: that stores them in plain text on
the service, visible to anyone with console read access.

```bash
set -e
gcloud secrets list >/dev/null   # fails fast if step 3 hasn't taken effect yet

for k in QWEN_TOKEN SUPABASE_URL SUPABASE_SERVICE_ROLE_KEY SUPABASE_ANON_KEY \
         SUPABASE_PUBLISHABLE_KEY ADMIN_SECRET MEDIA_SECRET LINK_BOT_SECRET; do
  v=$(grep "^$k=" .env.local | cut -d= -f2- | sed 's/^"//; s/"$//')
  [ -n "$v" ] || { echo "skip $k (not set locally)"; continue; }
  if gcloud secrets describe "$k" >/dev/null 2>&1; then
    printf '%s' "$v" | gcloud secrets versions add "$k" --data-file=-
  else
    printf '%s' "$v" | gcloud secrets create "$k" --data-file=-
  fi
done
```

`set -e` and the probe stop the loop on the first real failure rather than
repeating the same error once per secret.

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
- `CRON_SECRET` — optional; see step 7.

**`ADMIN_SECRET` must be copied across byte-for-byte.** `lib/secureToken.ts`
derives its key from `MEDIA_SECRET || ADMIN_SECRET || <dev default>`, and you
have no `MEDIA_SECRET` set, so `ADMIN_SECRET` is what currently signs:

- every `qwen_session` login cookie — a different value logs everyone out;
- every `/api/media` token — a different value 404s images already handed out.

Keep it identical and the migration is invisible to users. (Setting an explicit
`MEDIA_SECRET` equal to today's `ADMIN_SECRET` is tidier long-term, but do that
as a separate change, not during the move.)

## 5. Deploy

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

## 6. Cap the spend

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

## 7. Replace the cron

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

## 8. Optional: deploy from GitHub instead of your laptop

Nothing after step 5 depends on your machine — the service runs on Google's
infrastructure and keeps serving with your laptop shut. But the *deploy command*
still starts locally. Wiring Cloud Build to the repo removes even that, so a
push to `main` (including an edit made in GitHub's web UI) builds and rolls out
on its own:

```bash
gcloud run deploy qwen38-api \
  --source . \
  --region us-central1 \
  --set-build-service-account "projects/$PROJECT/serviceAccounts/${NUM}-compute@developer.gserviceaccount.com"

# then connect the repo (opens a browser once to authorise GitHub):
gcloud builds triggers create github \
  --name=qwen38-api-main \
  --repo-name=qwen3.8-api \
  --repo-owner=UltraFEmotes \
  --branch-pattern='^main$' \
  --build-config=cloudbuild.yaml \
  --region=us-central1
```

Or do it in the console, which is less fiddly for the one-time GitHub OAuth
step: Cloud Run → your service → *Set up continuous deployment*. Point it at
`UltraFEmotes/qwen3.8-api`, branch `main`, build type Dockerfile.

Either way the flow becomes: push to GitHub → Cloud Build builds on Google's
servers → Cloud Run rolls out the new revision. No laptop involved, and it
matches how you already edit files directly on GitHub.

## 9. Point the domain

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

## Railway (no card, ~30 days)

Railway runs a real container, so there is **no request timeout** — same win as
Cloud Run. It is a trial rather than a free tier: a one-time $5 credit, expiring
after 30 days or when the credit runs out, whichever comes first. Services pause
after that unless you move to Hobby ($5/month minimum).

At ~$0.000463 per GB-minute, a 512MB service left running continuously costs
about $10/month, so the credit would be gone in under two weeks. **Enable App
Sleeping** (service → Settings → Serverless) and you only spend while serving
requests, which with low traffic stretches the credit across the full trial.

1. Sign in at <https://railway.com> with GitHub — no card for the trial.
2. **New Project → Deploy from GitHub repo →** `UltraFEmotes/qwen3.8-api`.
   Railway detects the `Dockerfile` and uses it, building on x86_64, so `sharp`
   gets the right binaries.
3. **Variables → Raw Editor**, and paste the contents of `.env.local`, then add:

   ```
   QWEN_SHOW_REASONING=true
   QWEN_FORGET_MEMORIES=true
   ```

   `PORT` is injected by Railway; the standalone server already honours it, so
   do not set it yourself.
4. **Settings → Networking → Generate Domain** for a `*.up.railway.app` URL.
5. **Settings → Serverless → enable App Sleeping.**
6. Replace the cron: Railway can schedule a service, but the simplest path is a
   free job at <https://cron-job.org> hitting
   `https://YOUR-APP.up.railway.app/api/cron/cleanup` daily. See step 7 above
   for closing that endpoint with `CRON_SECRET` first.

Everything in "Known differences from Vercel" below applies here too —
especially copying `ADMIN_SECRET` across byte-for-byte, or every existing login
cookie and media URL breaks.

When the trial ends the service pauses rather than deleting anything, so you can
move to Render (below) without losing state — all persistent data lives in
Supabase, not on the host.

## No-card alternatives

Cloud Run needs billing enabled even to sit inside the free tier. If that's a
blocker, in order of fit:

1. **Stay on Vercel.** Free, already working, and the only thing wrong is the
   300s ceiling — which may not even be what's cutting you off. Check first
   (below). If Qwen is dropping the connection at 90s, no move helps.
2. **Cloudflare Workers** — no card, and *no request duration limit on any
   plan*. The catch is 10ms of CPU per request on the free plan, and this proxy
   parses an SSE frame per token. A long reply lands around 12ms, so it may
   die on exactly the replies you're trying to save. Testable in an afternoon,
   not a safe default.
3. **Render** — no card. Real server, no request cap, but free instances sleep
   after 15 minutes and cold-start in 30–60s. Fine for a personal API, poor for
   a public site and for Claude Code, which calls `count_tokens` before every
   message.

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

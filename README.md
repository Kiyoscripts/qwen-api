# Qwen API

A self-hosted, OpenAI-compatible AI gateway with username/password accounts, invite-only registration, API keys, PostgreSQL persistence, Qwen token pooling, and configurable OpenAI-compatible providers.

## Features

- OpenAI-compatible `GET /v1/models` and `POST /v1/chat/completions`
- Streaming and non-streaming chat completions
- Qwen token pool with health checks, parking, and coordinated routing
- Custom OpenAI-compatible providers with encrypted credentials and model discovery
- Invite-only local authentication; administrators can enable public registration
- Restricted API keys with expiration, model/IP allowlists, quotas, and rotation overlap
- Admin dashboard for users, invites, providers, models, analytics, jobs, incidents, and security events
- PostgreSQL migrations, durable jobs, audit logs, request IDs, health checks, readiness, and metrics
- Interactive API documentation and playground
- Docker image automatically built and published by GitHub Actions

## Requirements

For Docker deployment you need:

- A PostgreSQL 14+ database reachable from the container
- At least one Qwen token or one configured custom OpenAI-compatible provider
- Docker 24+ (or another OCI-compatible runtime)
- An HTTPS reverse proxy for public production use

The image listens on port `3000` and runs database migrations on startup by default.

## Container Image

Every push to `main` runs tests, builds the production application on GitHub Actions, and publishes:

```text
ghcr.io/kiyoscripts/qwen-api:latest
```

Immutable commit images are also published as `sha-<commit>` tags. Tagged Git releases produce matching image tags.

If the GHCR package is private, authenticate before pulling:

```bash
echo "$GITHUB_TOKEN" | docker login ghcr.io -u Kiyoscripts --password-stdin
docker pull ghcr.io/kiyoscripts/qwen-api:latest
```

The token needs `read:packages`. Public packages can be pulled without authentication.

## Configuration

Copy `.env.example` to `.env` and replace every placeholder secret. Never commit `.env`.

Required core values:

| Variable | Purpose |
| --- | --- |
| `DATABASE_URL` | PostgreSQL connection URL. Use TLS options required by your provider, commonly `?sslmode=require`. |
| `ADMIN_SECRET` | Long random server-side administrative secret. |
| `PROVIDER_CREDENTIAL_KEY` | Separate secret of at least 32 random characters used to encrypt custom-provider credentials. Losing it makes stored credentials unreadable. |
| `MEDIA_SECRET` | Long random secret used to seal media URLs and tickets. |
| `TRUSTED_PROXY_SECRET` | Shared secret inserted by a trusted reverse proxy before forwarded client-IP headers are accepted. |
| `CRON_SECRET` | Protects the durable job worker endpoint. |
| `QWEN_TOKEN` | Optional Qwen account token. It can be omitted when usable custom-provider capacity is configured. |

Generate independent secrets, for example:

```bash
openssl rand -base64 48
```

Do not reuse a secret for multiple settings. Do not rotate `PROVIDER_CREDENTIAL_KEY` without first re-encrypting provider credentials.

Important optional values:

| Variable | Default | Purpose |
| --- | --- | --- |
| `DATABASE_POOL_SIZE` | `10` | Maximum PostgreSQL connections per app instance. |
| `RUN_MIGRATIONS` | `true` | Run authoritative migrations before starting the container. Set false on all but one instance if your platform has unusual startup coordination. |
| `ALLOW_PRIVATE_PROVIDER_URLS` | `false` | Permit private/HTTP provider URLs. Use only for trusted development networks. |
| `ENABLE_VIDEO_GENERATION` | `true` | Enable Qwen video endpoints. |
| `PUBLIC_KEY_CREATION` | `true` | Legacy public-key creation switch; account registration is controlled in admin settings. |
| `QWEN_CLIENT_VERSION` | See `.env.example` | Qwen web-client version header. Update when the legitimate upstream client changes. |

See `.env.example` for optional OneCompiler, OpenCode Zen, NVIDIA, Solar, ChatGLM, proxy, timeout, and abuse-control settings.

## Deploy With Docker Compose

Create `compose.yml`:

```yaml
services:
  app:
    image: ghcr.io/kiyoscripts/qwen-api:latest
    restart: unless-stopped
    env_file: .env
    ports:
      - "127.0.0.1:3000:3000"
    depends_on:
      database:
        condition: service_healthy

  database:
    image: postgres:16-alpine
    restart: unless-stopped
    environment:
      POSTGRES_DB: qwen_api
      POSTGRES_USER: qwen_api
      POSTGRES_PASSWORD: change-this-password
    volumes:
      - postgres-data:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U qwen_api -d qwen_api"]
      interval: 5s
      timeout: 5s
      retries: 20

volumes:
  postgres-data:
```

For this compose network, use:

```dotenv
DATABASE_URL=postgresql://qwen_api:change-this-password@database:5432/qwen_api
```

Start and verify it:

```bash
docker compose pull
docker compose up -d
docker compose logs -f app
curl --fail http://127.0.0.1:3000/api/health
curl --fail http://127.0.0.1:3000/api/ready
```

`/api/health` confirms that the process is alive. `/api/ready` additionally checks PostgreSQL and usable provider capacity.

## Existing Managed PostgreSQL

When using Aiven, Neon, RDS, or another managed database, omit the `database` service and provide its TLS connection URL in `.env`:

```dotenv
DATABASE_URL=postgresql://USER:PASSWORD@HOST:PORT/DATABASE?sslmode=require
```

Migrations are ordered, checksum-verified, transaction-protected, and guarded by a PostgreSQL advisory lock. Multiple containers may start together, but one migration runner is operationally simpler. Existing untracked databases may require an explicit baseline; review migration status before doing so:

```bash
docker run --rm --env-file .env ghcr.io/kiyoscripts/qwen-api:latest node scripts/migrate.mjs --status
docker run --rm --env-file .env ghcr.io/kiyoscripts/qwen-api:latest node scripts/migrate.mjs --baseline
```

Only baseline a database whose schema is already known to match the migrations.

## First Administrator

After the database is migrated, open the site and use the administrator bootstrap flow. Create the first administrator only from a trusted connection. Registration is invite-only by default; administrators can create users and invitations or enable public registration from settings.

New users do not receive API keys automatically. Users create keys explicitly from their account page.

## Reverse Proxy and TLS

Put Caddy, Nginx, Traefik, Cloudflare Tunnel, or your platform ingress in front of port `3000`. Terminate HTTPS at the proxy and do not expose PostgreSQL publicly.

Forwarded IP headers are ignored unless the trusted proxy overwrites `X-Origin-Proxy-Secret` with the exact `TRUSTED_PROXY_SECRET`. Never allow clients to preserve or choose this header.

Example Nginx location:

```nginx
location / {
    proxy_pass http://127.0.0.1:3000;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Origin-Proxy-Secret "replace-with-trusted-proxy-secret";
    proxy_buffering off;
    proxy_read_timeout 300s;
}
```

`proxy_buffering off` is important for streaming SSE responses.

## Background Jobs

Durable provider health, discovery, exports, and maintenance jobs are processed by:

```text
GET or POST /api/cron/worker
Authorization: Bearer <CRON_SECRET>
```

Call it every minute from a scheduler. Example:

```bash
curl --fail -X POST https://api.example.com/api/cron/worker \
  -H "Authorization: Bearer $CRON_SECRET"
```

## API Usage

Create an API key in the account UI, then discover the currently enabled models:

```bash
curl https://api.example.com/v1/models \
  -H "Authorization: Bearer $API_KEY"
```

Non-streaming chat:

```bash
curl https://api.example.com/v1/chat/completions \
  -H "Authorization: Bearer $API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"model":"xqapi/gpt-5.6-sol","messages":[{"role":"user","content":"Hello"}]}'
```

Add `"stream":true` for OpenAI-compatible SSE streaming. The deployed `/docs` and `/playground` pages provide live model discovery and generated cURL, JavaScript, and Python examples.

## Build Locally

GitHub Actions is the recommended builder. To build manually:

```bash
docker build -t qwen-api:local .
docker run --rm --env-file .env -p 3000:3000 qwen-api:local
```

The multi-stage image installs dependencies, builds Next.js standalone output, and copies only runtime assets into the final non-root image.

## GitHub Workflow

`.github/workflows/docker.yml` performs:

1. Dependency installation with the lockfile.
2. Security, custom-provider, integration, packaging, and TypeScript checks.
3. A cached BuildKit production build on an `ubuntu-latest` runner.
4. Publication to GitHub Container Registry using the repository-scoped `GITHUB_TOKEN`.

No personal access token is stored in the workflow. In repository settings, ensure **Actions > General > Workflow permissions** allows read and write permissions. After the first publish, set the GHCR package visibility to public if anonymous pulls are desired.

## Operations and Security

- Back up PostgreSQL before upgrades and test restore procedures.
- Pin production deployments to a `sha-*` image rather than `latest` when reproducibility matters.
- Keep `.env`, database URLs, Qwen tokens, provider credentials, cookies, and API keys out of Git and logs.
- Restrict `/admin`, bootstrap, and database access to trusted operators.
- Monitor `/api/ready`, container health, job failures, provider health, security events, and disk/database growth.
- Upgrade by pulling a new image and recreating the app container; startup migrations run before the server.
- Roll back the image only when its expected database schema remains compatible. Database migrations are not automatically reversed.
- The project does not bypass upstream anti-bot protections. Unhealthy credentials are parked or disabled instead.

## License and Upstream Services

Review the repository license and the terms, quotas, and acceptable-use policies of every configured upstream provider before operating a public service.

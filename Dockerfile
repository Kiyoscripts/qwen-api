# Container image for Cloud Run (or any host that runs a real server).
#
# The point of moving off serverless is the request ceiling: a function is capped
# at 300s, which severs long generations mid-reply. A container has no such cap —
# Cloud Run allows up to 60 minutes per request.
#
# Debian slim rather than Alpine on purpose: `sharp` (image watermarking) ships
# prebuilt glibc binaries, and musl would force a slow source build.

# ---- dependencies ----------------------------------------------------------
FROM node:22-slim AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund

# ---- build -----------------------------------------------------------------
FROM node:22-slim AS builder
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# No secrets are needed here: every server module reads its env lazily at request
# time, so the build works with none set. Do not add ARG/ENV secrets — they would
# be baked into the image layers.
RUN npm run build

# ---- run -------------------------------------------------------------------
FROM node:22-slim AS runner
WORKDIR /app

ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    HOSTNAME=0.0.0.0 \
    PORT=8080

RUN groupadd --system --gid 1001 nodejs \
 && useradd --system --uid 1001 --gid nodejs nextjs

# public/ and .next/static are not part of the standalone bundle.
COPY --from=builder --chown=nextjs:nodejs /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static
# lib/watermark.ts reads this via process.cwd(), which output tracing cannot see,
# so it has to be copied explicitly or image watermarking throws at runtime.
COPY --from=builder --chown=nextjs:nodejs /app/assets ./assets

USER nextjs
EXPOSE 8080

# Cloud Run injects PORT; the standalone server honours PORT and HOSTNAME.
CMD ["node", "server.js"]

FROM node:20-alpine AS base
ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"
RUN corepack enable && corepack prepare pnpm@9.14.4 --activate

# ── pruner ────────────────────────────────────────────────────────────────────
FROM base AS pruner
WORKDIR /app
RUN pnpm add -g turbo@2
COPY . .
RUN turbo prune @mammoth/worker-browser --docker

# ── deps ──────────────────────────────────────────────────────────────────────
FROM base AS deps
WORKDIR /app
COPY --from=pruner /app/out/json/ .
COPY --from=pruner /app/out/pnpm-lock.yaml ./pnpm-lock.yaml
RUN pnpm install --frozen-lockfile

# ── builder ───────────────────────────────────────────────────────────────────
FROM base AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY --from=pruner /app/out/full/ .
RUN pnpm --filter @mammoth/worker-browser build
RUN pnpm --filter @mammoth/worker-browser deploy --prod /deploy/worker-browser

# ── runner: Playwright-enabled image ──────────────────────────────────────────
# Uses official Playwright image so Chromium + all system deps are pre-installed.
# Security constraints enforced at docker run level:
#   --memory=256m --cpus=0.5 --network=none (except target URL)
FROM mcr.microsoft.com/playwright:v1.49.0-jammy AS runner

WORKDIR /app

COPY --from=builder /deploy/worker-browser/dist ./dist
COPY --from=builder /deploy/worker-browser/node_modules ./node_modules
COPY --from=builder /deploy/worker-browser/package.json ./package.json

# Non-root user — browser automation must never run as root
RUN groupadd --gid 1001 mammoth && \
    useradd --uid 1001 --gid mammoth --shell /bin/bash --create-home mammoth

USER mammoth
EXPOSE 3003
ENV NODE_ENV=production
CMD ["node", "dist/index.js"]

FROM node:20-alpine AS base
ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"
RUN corepack enable && corepack prepare pnpm@9.14.4 --activate

# ── pruner ────────────────────────────────────────────────────────────────────
FROM base AS pruner
WORKDIR /app
RUN pnpm add -g turbo@2
COPY . .
RUN turbo prune @mammoth/worker-agent --docker

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
RUN pnpm --filter @mammoth/worker-agent build
RUN pnpm --filter @mammoth/worker-agent deploy --prod /deploy/worker-agent

# ── runner ────────────────────────────────────────────────────────────────────
FROM node:20-alpine AS runner
RUN addgroup --system --gid 1001 mammoth && adduser --system --uid 1001 mammoth
WORKDIR /app

COPY --from=builder --chown=mammoth:mammoth /deploy/worker-agent/dist ./dist
COPY --from=builder --chown=mammoth:mammoth /deploy/worker-agent/node_modules ./node_modules
COPY --from=builder --chown=mammoth:mammoth /deploy/worker-agent/package.json ./package.json

USER mammoth
ENV NODE_ENV=production
CMD ["node", "dist/index.js"]

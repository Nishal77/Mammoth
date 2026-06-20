FROM node:20-alpine AS base
ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"
RUN npm install -g pnpm@9.14.4

# ── pruner ────────────────────────────────────────────────────────────────────
FROM base AS pruner
WORKDIR /app
RUN pnpm add -g turbo@2
COPY . .
RUN turbo prune @mammoth/notifications --docker

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
RUN pnpm --filter @mammoth/notifications build
RUN pnpm --filter @mammoth/notifications deploy --prod /deploy/notifications

# ── runner ────────────────────────────────────────────────────────────────────
FROM node:20-alpine AS runner
RUN addgroup --system --gid 1001 mammoth && adduser --system --uid 1001 mammoth
WORKDIR /app

COPY --from=builder --chown=mammoth:mammoth /deploy/notifications/dist ./dist
COPY --from=builder --chown=mammoth:mammoth /deploy/notifications/node_modules ./node_modules
COPY --from=builder --chown=mammoth:mammoth /deploy/notifications/package.json ./package.json

USER mammoth
EXPOSE 3002
ENV NODE_ENV=production
CMD ["node", "dist/index.js"]

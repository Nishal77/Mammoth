FROM node:20-alpine AS base
ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"
RUN npm install -g pnpm@9.14.4

# ── pruner: use turbo prune to get a minimal workspace for this service ────────
FROM base AS pruner
WORKDIR /app
RUN pnpm add -g turbo@2
COPY . .
RUN turbo prune @mammoth/api --docker

# ── deps: install only the pruned workspace's dependencies ────────────────────
FROM base AS deps
WORKDIR /app
COPY --from=pruner /app/out/json/ .
COPY --from=pruner /app/out/pnpm-lock.yaml ./pnpm-lock.yaml
RUN pnpm install --frozen-lockfile

# ── builder: compile with tsup ────────────────────────────────────────────────
FROM base AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY --from=pruner /app/out/full/ .
RUN pnpm --filter @mammoth/api build
RUN pnpm --filter @mammoth/api deploy --prod /deploy/api

# ── runner: minimal production image ──────────────────────────────────────────
FROM node:20-alpine AS runner
RUN addgroup --system --gid 1001 mammoth && adduser --system --uid 1001 mammoth
WORKDIR /app

COPY --from=builder --chown=mammoth:mammoth /deploy/api/dist ./dist
COPY --from=builder --chown=mammoth:mammoth /deploy/api/node_modules ./node_modules
COPY --from=builder --chown=mammoth:mammoth /deploy/api/package.json ./package.json

USER mammoth
EXPOSE 4000
ENV NODE_ENV=production
CMD ["node", "dist/index.js"]

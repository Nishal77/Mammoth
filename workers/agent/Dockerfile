FROM node:20-alpine AS base
ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"
RUN corepack enable && corepack prepare pnpm@9.14.4 --activate

# ── deps ──────────────────────────────────────────────────────────────────────
FROM base AS deps
WORKDIR /app
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY apps/agent-worker/package.json ./apps/agent-worker/
COPY packages/agents/package.json ./packages/agents/
COPY packages/db/package.json ./packages/db/
COPY packages/shared/package.json ./packages/shared/
COPY packages/config/typescript-config/package.json ./packages/config/typescript-config/
RUN pnpm install --frozen-lockfile

# ── builder ───────────────────────────────────────────────────────────────────
FROM base AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/apps/agent-worker/node_modules ./apps/agent-worker/node_modules
COPY . .
RUN pnpm --filter @mammoth/agent-worker build
RUN pnpm --filter @mammoth/agent-worker deploy --prod /deploy/agent-worker

# ── runner ────────────────────────────────────────────────────────────────────
FROM node:20-alpine AS runner
RUN addgroup --system --gid 1001 mammoth && adduser --system --uid 1001 mammoth
WORKDIR /app

COPY --from=builder --chown=mammoth:mammoth /deploy/agent-worker/dist ./dist
COPY --from=builder --chown=mammoth:mammoth /deploy/agent-worker/node_modules ./node_modules
COPY --from=builder --chown=mammoth:mammoth /deploy/agent-worker/package.json ./package.json

USER mammoth
ENV NODE_ENV=production
CMD ["node", "dist/index.js"]

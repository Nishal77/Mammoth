FROM node:20-alpine AS base
ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"
RUN corepack enable && corepack prepare pnpm@9.14.4 --activate

# ── deps: install all workspace dependencies ──────────────────────────────────
FROM base AS deps
WORKDIR /app
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY apps/api/package.json ./apps/api/
COPY packages/db/package.json ./packages/db/
COPY packages/shared/package.json ./packages/shared/
COPY packages/config/typescript-config/package.json ./packages/config/typescript-config/
RUN pnpm install --frozen-lockfile

# ── builder: compile with tsup (bundles @mammoth/* workspace deps inline) ─────
FROM base AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/apps/api/node_modules ./apps/api/node_modules
COPY . .
RUN pnpm --filter @mammoth/api build

# pnpm deploy creates a standalone dir with only production node_modules
RUN pnpm --filter @mammoth/api deploy --prod /deploy/api

# ── runner ────────────────────────────────────────────────────────────────────
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

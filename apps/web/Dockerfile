FROM node:20-alpine AS base
ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"
RUN corepack enable && corepack prepare pnpm@9.14.4 --activate

# ── deps ──────────────────────────────────────────────────────────────────────
FROM base AS deps
WORKDIR /app
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY apps/web/package.json ./apps/web/
COPY packages/config/typescript-config/package.json ./packages/config/typescript-config/
RUN pnpm install --frozen-lockfile

# ── builder ───────────────────────────────────────────────────────────────────
FROM base AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/apps/web/node_modules ./apps/web/node_modules
COPY . .

# Build args baked at build time for Next.js public env vars
ARG NEXT_PUBLIC_API_URL
ARG NEXT_PUBLIC_APP_URL
ENV NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL
ENV NEXT_PUBLIC_APP_URL=$NEXT_PUBLIC_APP_URL

RUN pnpm --filter @mammoth/web build

# ── runner ────────────────────────────────────────────────────────────────────
FROM node:20-alpine AS runner
RUN addgroup --system --gid 1001 mammoth && adduser --system --uid 1001 mammoth
WORKDIR /app

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1

# next build --standalone produces a self-contained server in .next/standalone
COPY --from=builder --chown=mammoth:mammoth /app/apps/web/.next/standalone ./
COPY --from=builder --chown=mammoth:mammoth /app/apps/web/.next/static ./apps/web/.next/static
COPY --from=builder --chown=mammoth:mammoth /app/apps/web/public ./apps/web/public

USER mammoth
EXPOSE 3000
ENV PORT=3000
ENV HOSTNAME="0.0.0.0"

CMD ["node", "apps/web/server.js"]

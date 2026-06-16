# MAMMOTH

An AI Company Operating System. One revenue goal. Nine autonomous departments working continuously to hit it.

---

## What it does

A founder sets a single revenue target. MAMMOTH deploys nine AI departments — CEO Brain, Marketing, Sales, Engineering, Support, Finance, Research, HR, and Content — that decompose the goal into OKRs, generate weekly targets, execute daily tasks, and continuously learn from outcomes.

Every action goes through a trust-gated autonomy ring before it executes. The system earns the right to act faster as it demonstrates alignment with the founder.

---

## Architecture

```
apps/
  api/                  Fastify REST + Socket.io (port 4000)
  agent-worker/         BullMQ consumer — runs all 9 agents
  orchestrator/         Schedules repeatable jobs (CEO Brain every 6h, expiry checks every 5m)
  notification-service/ Dispatches email + in-app notifications
  web/                  Next.js 15 App Router dashboard (port 3000)

packages/
  db/                   Drizzle ORM schema + migrations (PostgreSQL)
  agents/               BaseAgent + 9 department agents
  shared/               Error types, Result types, shared Zod schemas
  config/
    typescript-config/  Shared tsconfig base
    eslint-config/      Shared ESLint rules

infrastructure/
  docker/               docker-compose.prod.yml (all services + Postgres + Redis + Qdrant)

scripts/
  seed-demo-company.ts  Creates a demo company with memory, goal, and 7 weeks of metrics
```

### Three rings of autonomy

| Ring | Behavior |
|------|----------|
| 1 | Executes automatically, no notification |
| 2 | Notifies founder, auto-approves after 4-hour veto window |
| 3 | Hard gate — requires explicit founder approval |

### Progressive trust engine

10 consecutive unmodified Ring 2 approvals for a specific action type promotes that action to Ring 1. Any founder modification resets the counter to zero. Trust is tracked per action type, per department, per company.

### Job queue

All agent tasks flow through BullMQ backed by Redis. The agent-worker consumes them. The orchestrator enqueues repeatable jobs. The API never calls agents directly.

### Real-time

Agent-worker publishes to Redis pub/sub (`socket:events:{companyId}`). The API Socket.io server subscribes and relays to the browser. Services never import each other.

---

## Tech stack

| Layer | Technology |
|-------|-----------|
| Runtime | Node.js 20, TypeScript 5.7 (ESM) |
| Monorepo | pnpm workspaces + Turborepo |
| API | Fastify 5, Better Auth, Zod |
| Frontend | Next.js 15 App Router |
| Database | PostgreSQL 16 + Drizzle ORM |
| Queue | BullMQ + Redis 7 |
| Vector store | Qdrant |
| AI | Anthropic Claude (Sonnet/Haiku), OpenAI GPT-4o-mini |
| Build | tsup (ESM bundles for all Node apps) |
| Containers | Docker, docker-compose |

---

## Getting started

### Prerequisites

- Node.js >= 20
- pnpm >= 9
- Docker + Docker Compose
- An Anthropic API key

### 1. Clone and install

```bash
git clone https://github.com/Nishal77/Mammoth.git
cd Mammoth
pnpm install
```

### 2. Configure environment

```bash
cp .env.example .env
```

Fill in at minimum:

```env
DATABASE_URL=postgresql://mammoth:mammoth@localhost:5432/mammoth
REDIS_URL=redis://localhost:6379
ANTHROPIC_API_KEY=sk-ant-...
BETTER_AUTH_SECRET=<random 32-char string>
BETTER_AUTH_URL=http://localhost:3000
```

### 3. Start infrastructure

```bash
docker compose -f infrastructure/docker/docker-compose.dev.yml up -d
```

### 4. Run migrations

Generate migration files from the schema, then apply them:

```bash
pnpm db:generate
pnpm db:migrate
```

### 5. Seed demo data (optional)

```bash
pnpm tsx scripts/seed-demo-company.ts
```

### 6. Start development

```bash
pnpm dev
```

Services start on:
- Web: http://localhost:3000
- API: http://localhost:4000

---

## Running in production

```bash
docker compose -f infrastructure/docker/docker-compose.prod.yml up -d
```

All services build with multi-stage Dockerfiles. The agent-worker scales horizontally via `AGENT_WORKER_REPLICAS`.

---

## Security model

- PostgreSQL RLS on every company-scoped table. Queries run through `SET LOCAL app.current_company_id`.
- External data passed to agents is wrapped in `<external_data>` tags. System prompts explicitly forbid following instructions inside them.
- Engineering agent has no push-to-main tool — blocked structurally, not by configuration.
- Finance agent is read-only by architecture. It has no write tools.
- Code execution runs in isolated Docker containers: no outbound network, read-only filesystem, non-root user, 30s timeout, 256MB RAM.
- Hard daily AI cost cap per company (`MAX_AGENT_COST_PER_DAY_USD`). Agents check before every LLM call.

---

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md).

---

## License

MIT

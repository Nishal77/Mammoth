# Contributing to MAMMOTH

## Before you start

Open an issue before writing code for anything non-trivial. This avoids duplicate effort and keeps PRs focused.

---

## Developer quickstart (clone → running in 5 minutes)

```bash
# 1. Clone
git clone https://github.com/your-org/mammoth.git
cd mammoth

# 2. Install all dependencies
pnpm install

# 3. Copy and fill in environment variables
cp .env.example .env
# Edit .env — minimum needed:
#   ANTHROPIC_API_KEY=sk-ant-...
#   OPENAI_API_KEY=sk-...
#   DATABASE_URL=postgresql://mammoth:mammoth_dev@localhost:5432/mammoth
#   REDIS_URL=redis://localhost:6379

# 4. Start infrastructure (Postgres, Redis, Qdrant, MinIO)
docker compose -f infrastructure/docker/docker-compose.dev.yml up -d

# 5. Run migrations
pnpm db:migrate

# 6. Start everything in watch mode
pnpm dev
```

Dashboard → http://localhost:3000  
API → http://localhost:4000

**CLI development** — work on the `mammoth` CLI without publishing:

```bash
cd tools/cli
pnpm build            # compile to dist/
node dist/index.js init    # test locally
# or link globally:
npm link
mammoth init
```

---

## Setup

See the [README](README.md) for full setup instructions. Once the dev environment is running:

```bash
pnpm install
pnpm dev
```

---

## Code conventions

Conventions are defined in `CLAUDE.md`. The short version:

- TypeScript everywhere. No `any`. No type assertions without a comment explaining why.
- `camelCase` for variables and functions. `PascalCase` for types and React components. `kebab-case` for filenames.
- Booleans start with `is`, `has`, `can`, or `should`.
- No files named `utils.ts`, `helpers.ts`, `misc.ts`, or `common.ts`. Name by what the file does.
- Max 40 lines per function. Max 4 parameters. Early returns over nesting.
- No N+1 queries. Never `select *`. All multi-table operations use transactions.
- Every async function returns a typed result or throws a typed error.
- JSDoc on every exported function.
- Comments explain WHY, not WHAT.

---

## Pull requests

- One concern per PR. If you're fixing a bug and refactoring, split them.
- PR title follows [Conventional Commits](https://www.conventionalcommits.org/): `feat:`, `fix:`, `chore:`, `docs:`, `refactor:`, `test:`.
- Include a clear description of what changed and why.
- All checks must pass before review.

---

## Adding a new agent

1. Create `packages/agents/src/agents/<department>-agent.ts` extending `BaseAgent`.
2. Implement `execute(input: AgentTaskInput): Promise<AgentTaskOutput>`.
3. Export from `packages/agents/src/agents/index.ts`.
4. Add entry to `DEPARTMENT_AGENT_MAP` in `apps/agent-worker/src/index.ts`.
5. Add the department to the seed script if relevant.

Ring levels:
- Ring 1: no approval, no notification, executes immediately.
- Ring 2: call `this.createApproval(...)` with `ringLevel: 2`. Auto-approves after 4 hours unless vetoed.
- Ring 3: call `this.createApproval(...)` with `ringLevel: 3`. Never auto-approves.

---

## Database changes

1. Add or modify schema files in `packages/db/src/schema/`.
2. Update `packages/db/src/schema/index.ts` and `packages/db/src/schema/relations.ts`.
3. Run `pnpm db:generate` to generate a migration.
4. Review the generated SQL before running `pnpm db:migrate`.
5. If the table contains company data, add an RLS policy in a migration file.

---

## Reporting bugs

Use the GitHub issue template. Include:
- What you expected
- What happened instead
- Reproduction steps
- Relevant logs or error messages

---

## License

By contributing, you agree that your contributions will be licensed under the MIT License.

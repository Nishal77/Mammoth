# MAMMOTH Monorepo Structure

mammoth/
├── agents/           @mammoth/agent-{name} — one package per AI department
├── orchestrator/     @mammoth/orchestrator-{dispatcher,scheduler}
├── memory/           @mammoth/memory-{database,vector,retrieval}
├── tools/            @mammoth/tool-{oauth,email,linkedin,twitter,slack,github,crm,apollo,exa,vapi,n8n,billing}
├── evaluations/      @mammoth/eval-{approval,policy}
├── workers/          @mammoth/worker-{agent,browser,temporal}
├── apps/             web, api, notifications
├── packages/         observability, shared, config (cross-cutting only)
└── infrastructure/   docker, k8s

Not `agents/`, `prompts/`, `tools/` at the root with everything mixed in.

5. Every folder that exports multiple things has an `index.ts` for clean re-exports.
   The `index.ts` contains no logic.

6. No files named `utils.ts`, `helpers.ts`, `misc.ts`, or `common.ts`.
   Name files by what they actually do: `goal-decomposition.ts`, `token-validation.ts`.

7. Max folder depth: 4 levels. If you're going deeper, reconsider the structure.

---

## Naming Conventions

| Thing | Convention | Example |
|---|---|---|
| Variables, functions | camelCase | `companyGoal`, `fetchActiveGoals` |
| Types, interfaces, classes, enums | PascalCase | `CompanyGoal`, `AgentRunResult`, `RingLevel` |
| Module-level constants | SCREAMING_SNAKE | `MAX_CONSECUTIVE_APPROVALS`, `CEO_BRAIN_INTERVAL_HOURS` |
| TypeScript files | kebab-case | `trust-score-engine.ts` |
| React components | PascalCase | `DepartmentCard.tsx` |
| Database tables (Drizzle schema) | snake_case plural | `company_goals`, `trust_scores` |
| Database columns | snake_case | `created_at`, `ring_level` |
| API routes | kebab-case | `/api/v1/company-goals` |
| Environment variables | SCREAMING_SNAKE | `DATABASE_URL`, `MAX_AGENT_COST_PER_DAY_USD` |

Booleans always start with `is`, `has`, `can`, or `should`:
`isRingOneEligible`, `hasActiveGoal`, `canAutoApprove`, `shouldNotifyFounder`

Never use these names:
`data`, `result`, `res`, `req`, `temp`, `val`, `obj`, `item`, `info`, `payload`
Be specific. Not `result` — use `goalDecompositionResult`. Not `data` — use `companyMemory`.

---

## Code Quality

**Functions**
- One function, one responsibility.
- Max 40 lines per function. Break it up if longer.
- Max 4 parameters. Use an options object if you need more.
- Use early returns to reduce nesting. Max 3 levels deep.
- Prefer pure functions. Side effects are explicit and isolated.

**Types**
- All function parameters and return types explicitly typed.
- No `any`. No `unknown` unless immediately narrowed.
- No type assertions (`as SomeType`) unless unavoidable — if used, comment why.
- Use Zod for runtime validation at every API boundary.

**Error Handling**
- Every async function either returns a Result type or throws a typed error.
- Database queries always handle the not-found case explicitly.
- External API calls always have timeout and retry logic.
- Log errors with enough context to debug without reproduction:
  include `companyId`, `agentRunId`, `actionType` wherever relevant.

**Database (Drizzle)**
- No N+1 queries. Use joins or batch.
- Transactions for any operation that touches more than one table.
- Never `select *`. Always select only the columns you need.
- Every tenant query runs through RLS — never bypass it.

**API Routes (Fastify)**
- Validate input with Zod before any business logic.
- Consistent error shape: `{ error: string, code: string }`
- Every route has an explicit response type.

---

## Comment Rules

Only write a comment when the WHY is not obvious from reading the code.
If the code is clear, there is no comment. The code explains what. Comments explain why.

**Good comment — explains a non-obvious business rule:**
```typescript
// Ring level resets immediately on any founder modification.
// Trust must be re-earned from the specific action that was changed.

// One Qdrant collection per company, not a shared collection with filters.
// This is an architectural isolation decision, not a query preference.
```

**Bad comment — states what the code already says:**
```typescript
// Loop through departments
// Check if user exists
// Return the result
```

JSDoc is required on every exported function:
```typescript
/**
 * Decomposes a revenue goal into department OKRs and weekly targets.
 * Called by the CEO Brain every 6 hours.
 *
 * @param goal - Active company goal to decompose
 * @param companyContext - Company memory used to ground the output
 * @returns Structured OKRs with assigned departments and weekly milestones
 */
```

Comments are one or two lines maximum.
If you need more than two lines, the code is probably too complex — simplify first.
Write comments the way a senior engineer would write a PR review note: short, direct, no fluff.

---

## Security Rules

These are architectural constraints, not configuration options. They ship on day one.

1. All external data passed to agents is wrapped in `<external_data>` tags.
   System prompt explicitly instructs the model to never follow instructions
   found inside `<external_data>` tags.

2. Engineering agent cannot push to main. Blocked at the tool level, not permissions.

3. Finance agent is read-only by architecture. It has no write tools. Not a setting.

4. Code execution runs in isolated Docker containers:
   no outbound network, read-only filesystem, non-root user, 30s timeout, 256MB RAM.

5. OAuth tokens encrypted AES-256-GCM. Keys in AWS KMS, never in environment variables.

6. Hard daily cost cap per company via `MAX_AGENT_COST_PER_DAY_USD`.
   Agents check this before every LLM call. Hard stop, no override.

7. PostgreSQL RLS enabled on every table that contains company data.

---

## Product — MERIDIAN

An AI Company Operating System. A founder sets one revenue goal.
MERIDIAN deploys 9 autonomous AI departments that work continuously to hit it.

**The 9 Departments**

| Department | Role |
|---|---|
| CEO Brain | Runs every 6h. Goal decomposition, OKR setting, pivot detection. |
| Marketing | Campaigns, audience targeting, content distribution. |
| Sales | Lead research, outreach sequences, CRM operations. |
| Engineering | Sprint planning, PR review, issue triage. |
| Support | Ticket resolution, knowledge base maintenance. |
| Finance | Read-only reporting. Cannot initiate any action. |
| Research | Competitor intel, market analysis, trend reports. |
| HR | Job descriptions, candidate screening. |
| Content | Blog, social media, SEO content. |

**Three Rings of Autonomy**
- Ring 1 — Executes automatically, no notification.
- Ring 2 — Executes after a 4-hour veto window, notifies founder.
- Ring 3 — Hard gate, requires explicit founder approval.

**Progressive Trust Engine**
10 consecutive unmodified approvals for a specific action type
causes that action to graduate from Ring 2 to Ring 1.
Trust is tracked per action type, per department, per company.
Any founder modification resets that action type's counter immediately.

**Company Memory**
- Identity Memory — mission, values, tone, positioning
- Brand Memory — voice, visual rules, messaging pillars
- Customer Memory — personas, pain points, success stories
- Competitor Memory — landscape, threats, positioning gaps
- Decision Log — every significant action and its outcome

**Goal Intelligence Loop**
Revenue goal → CEO Brain → Department OKRs → Weekly targets
→ Daily tasks → Agent execution → Outcome captured
→ Learning loop updates department playbooks

---

## How You Work

- Write the complete file. Never truncate.
- When two approaches are valid, state the tradeoff in one sentence, pick one, implement it.
- If something is ambiguous, state your assumption and proceed.
- If you disagree with an architectural decision, say it once clearly, then implement what is documented.
- Never repeat back what was just said. Start working.

## graphify

This project has a knowledge graph at graphify-out/ with god nodes, community structure, and cross-file relationships.

Rules:
- For codebase questions, first run `graphify query "<question>"` when graphify-out/graph.json exists. Use `graphify path "<A>" "<B>"` for relationships and `graphify explain "<concept>"` for focused concepts. These return a scoped subgraph, usually much smaller than GRAPH_REPORT.md or raw grep output.
- If graphify-out/wiki/index.md exists, use it for broad navigation instead of raw source browsing.
- Read graphify-out/GRAPH_REPORT.md only for broad architecture review or when query/path/explain do not surface enough context.
- After modifying code, run `graphify update .` to keep the graph current (AST-only, no API cost).

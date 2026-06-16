-- RLS policies for all company-scoped tables.
-- Every table that holds company data enforces row-level security.
-- Application sets app.current_company_id and app.current_user_id per transaction.

-- ============================================================
-- ENABLE RLS
-- ============================================================
ALTER TABLE companies ENABLE ROW LEVEL SECURITY;
ALTER TABLE company_goals ENABLE ROW LEVEL SECURITY;
ALTER TABLE strategy_decisions ENABLE ROW LEVEL SECURITY;
ALTER TABLE company_memory ENABLE ROW LEVEL SECURITY;
ALTER TABLE memory_embeddings ENABLE ROW LEVEL SECURITY;
ALTER TABLE departments ENABLE ROW LEVEL SECURITY;
ALTER TABLE department_tasks ENABLE ROW LEVEL SECURITY;
ALTER TABLE task_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE approvals ENABLE ROW LEVEL SECURITY;
ALTER TABLE trust_scores ENABLE ROW LEVEL SECURITY;
ALTER TABLE leads ENABLE ROW LEVEL SECURITY;
ALTER TABLE outreach_sequences ENABLE ROW LEVEL SECURITY;
ALTER TABLE customers ENABLE ROW LEVEL SECURITY;
ALTER TABLE content_pieces ENABLE ROW LEVEL SECURITY;
ALTER TABLE metrics_daily ENABLE ROW LEVEL SECURITY;
ALTER TABLE integrations ENABLE ROW LEVEL SECURITY;
ALTER TABLE briefings ENABLE ROW LEVEL SECURITY;
ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE agent_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_log ENABLE ROW LEVEL SECURITY;

-- ============================================================
-- companies — owner access only
-- ============================================================
CREATE POLICY companies_owner ON companies
  USING (owner_id = current_setting('app.current_user_id', true)::uuid);

-- ============================================================
-- company_goals
-- ============================================================
CREATE POLICY company_goals_tenant ON company_goals
  USING (company_id = current_setting('app.current_company_id', true)::uuid);

-- ============================================================
-- strategy_decisions
-- ============================================================
CREATE POLICY strategy_decisions_tenant ON strategy_decisions
  USING (company_id = current_setting('app.current_company_id', true)::uuid);

-- ============================================================
-- company_memory
-- ============================================================
CREATE POLICY company_memory_tenant ON company_memory
  USING (company_id = current_setting('app.current_company_id', true)::uuid);

-- ============================================================
-- memory_embeddings — accessed via company_memory join
-- ============================================================
CREATE POLICY memory_embeddings_tenant ON memory_embeddings
  USING (
    memory_id IN (
      SELECT id FROM company_memory
      WHERE company_id = current_setting('app.current_company_id', true)::uuid
    )
  );

-- ============================================================
-- departments
-- ============================================================
CREATE POLICY departments_tenant ON departments
  USING (company_id = current_setting('app.current_company_id', true)::uuid);

-- ============================================================
-- department_tasks
-- ============================================================
CREATE POLICY department_tasks_tenant ON department_tasks
  USING (
    department_id IN (
      SELECT id FROM departments
      WHERE company_id = current_setting('app.current_company_id', true)::uuid
    )
  );

-- ============================================================
-- task_runs — accessed via department_tasks
-- ============================================================
CREATE POLICY task_runs_tenant ON task_runs
  USING (
    task_id IN (
      SELECT dt.id FROM department_tasks dt
      JOIN departments d ON d.id = dt.department_id
      WHERE d.company_id = current_setting('app.current_company_id', true)::uuid
    )
  );

-- ============================================================
-- approvals
-- ============================================================
CREATE POLICY approvals_tenant ON approvals
  USING (company_id = current_setting('app.current_company_id', true)::uuid);

-- ============================================================
-- trust_scores
-- ============================================================
CREATE POLICY trust_scores_tenant ON trust_scores
  USING (company_id = current_setting('app.current_company_id', true)::uuid);

-- ============================================================
-- leads
-- ============================================================
CREATE POLICY leads_tenant ON leads
  USING (company_id = current_setting('app.current_company_id', true)::uuid);

-- ============================================================
-- outreach_sequences — accessed via leads
-- ============================================================
CREATE POLICY outreach_sequences_tenant ON outreach_sequences
  USING (
    lead_id IN (
      SELECT id FROM leads
      WHERE company_id = current_setting('app.current_company_id', true)::uuid
    )
  );

-- ============================================================
-- customers
-- ============================================================
CREATE POLICY customers_tenant ON customers
  USING (company_id = current_setting('app.current_company_id', true)::uuid);

-- ============================================================
-- content_pieces
-- ============================================================
CREATE POLICY content_pieces_tenant ON content_pieces
  USING (company_id = current_setting('app.current_company_id', true)::uuid);

-- ============================================================
-- metrics_daily
-- ============================================================
CREATE POLICY metrics_daily_tenant ON metrics_daily
  USING (company_id = current_setting('app.current_company_id', true)::uuid);

-- ============================================================
-- integrations
-- ============================================================
CREATE POLICY integrations_tenant ON integrations
  USING (company_id = current_setting('app.current_company_id', true)::uuid);

-- ============================================================
-- briefings
-- ============================================================
CREATE POLICY briefings_tenant ON briefings
  USING (company_id = current_setting('app.current_company_id', true)::uuid);

-- ============================================================
-- notifications — user + company scoped
-- ============================================================
CREATE POLICY notifications_user ON notifications
  USING (
    user_id = current_setting('app.current_user_id', true)::uuid
    AND company_id = current_setting('app.current_company_id', true)::uuid
  );

-- ============================================================
-- agent_runs
-- ============================================================
CREATE POLICY agent_runs_tenant ON agent_runs
  USING (company_id = current_setting('app.current_company_id', true)::uuid);

-- ============================================================
-- audit_log — append-only; SELECT scoped to company
-- ============================================================
CREATE POLICY audit_log_tenant_read ON audit_log
  FOR SELECT
  USING (company_id = current_setting('app.current_company_id', true)::uuid);

-- Audit log rows may only be inserted, never updated or deleted
CREATE POLICY audit_log_insert_only ON audit_log
  FOR INSERT
  WITH CHECK (company_id IS NOT NULL);

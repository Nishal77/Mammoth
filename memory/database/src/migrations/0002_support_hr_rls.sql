-- RLS policies for support and HR tables added after initial migration.

ALTER TABLE support_tickets ENABLE ROW LEVEL SECURITY;
ALTER TABLE knowledge_base_articles ENABLE ROW LEVEL SECURITY;
ALTER TABLE job_postings ENABLE ROW LEVEL SECURITY;
ALTER TABLE candidates ENABLE ROW LEVEL SECURITY;

CREATE POLICY support_tickets_tenant ON support_tickets
  USING (company_id = current_setting('app.current_company_id', true)::uuid);

CREATE POLICY knowledge_base_articles_tenant ON knowledge_base_articles
  USING (company_id = current_setting('app.current_company_id', true)::uuid);

CREATE POLICY job_postings_tenant ON job_postings
  USING (company_id = current_setting('app.current_company_id', true)::uuid);

-- candidates scoped via job_posting or directly via company_id
CREATE POLICY candidates_tenant ON candidates
  USING (company_id = current_setting('app.current_company_id', true)::uuid);

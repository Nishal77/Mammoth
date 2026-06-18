-- Add Stripe customer ID to companies for MAMMOTH subscription billing.
-- This is used to:
--   1. Create the Stripe Customer Portal session (manage subscription)
--   2. Look up the company when Stripe fires billing webhooks

ALTER TABLE companies
  ADD COLUMN IF NOT EXISTS stripe_customer_id TEXT;

-- Index for webhook lookup: Stripe sends customer_id, we look up the company
CREATE UNIQUE INDEX IF NOT EXISTS idx_companies_stripe_customer
  ON companies(stripe_customer_id)
  WHERE stripe_customer_id IS NOT NULL;

-- RLS: only the company owner can read/write their own stripe_customer_id.
-- This column is already covered by the existing companies RLS policy:
--   "companies_tenant_policy" which filters on owner_id = current_user_id.
-- No separate RLS change needed — the column inherits the row-level policy.

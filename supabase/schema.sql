CREATE EXTENSION IF NOT EXISTS vector;
CREATE EXTENSION IF NOT EXISTS pgcrypto; -- for gen_random_uuid()

CREATE TYPE root_cause_bucket AS ENUM
  ('insufficient_funds','bank_decline','expired_card','abandoned_checkout',
   'mandate_failure','overdue_invoice','unknown');
CREATE TYPE intervention_type AS ENUM
  ('wait_and_retry','send_payment_link_with_alt_method','send_discounted_payment_link',
   'notify_and_recreate_mandate','promise_to_pay_tracker','manual_review','stop');
CREATE TYPE case_status AS ENUM
  ('detected','diagnosed','decided','executed','recovered',
   'failed_to_recover','requires_manual_review');

CREATE TABLE events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  razorpay_event_id TEXT,
  event_type TEXT NOT NULL,
  entity_id TEXT,
  amount INTEGER,
  currency TEXT DEFAULT 'INR',
  customer_id TEXT,
  customer_contact TEXT,
  error_code TEXT,
  error_description TEXT,
  raw_payload JSONB NOT NULL,
  embedding vector(1536),
  processed BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE recovery_cases (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id UUID REFERENCES events(id),
  root_cause_bucket root_cause_bucket,
  classification_confidence NUMERIC,
  classification_evidence JSONB,
  intervention_type intervention_type,
  status case_status DEFAULT 'detected',
  attempts INTEGER DEFAULT 0,
  revenue_at_risk INTEGER,
  revenue_recovered INTEGER DEFAULT 0,
  explanation TEXT,
  audit_trail JSONB DEFAULT '[]', -- Temporary before full actions table migration
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE actions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id UUID REFERENCES recovery_cases(id),
  action_type TEXT,
  success BOOLEAN,
  detail TEXT,
  prev_hash TEXT,
  this_hash TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE contact_consent (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id TEXT,
  channel TEXT,
  opt_in_at TIMESTAMPTZ,
  opt_out_at TIMESTAMPTZ,
  jurisdiction TEXT
);

CREATE TABLE manual_review_queue (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id UUID REFERENCES recovery_cases(id),
  reason TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE batch_budget (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  batch_id UUID,
  max_total_discount INTEGER,
  max_contacts_per_hour INTEGER,
  spent_so_far INTEGER DEFAULT 0,
  contacts_sent_this_hour INTEGER DEFAULT 0,
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE batch_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  label TEXT, -- 'naive_baseline' | 'recoverai'
  total_at_risk INTEGER,
  total_recovered INTEGER,
  created_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE events ENABLE ROW LEVEL SECURITY;
ALTER TABLE recovery_cases ENABLE ROW LEVEL SECURITY;
ALTER TABLE actions ENABLE ROW LEVEL SECURITY;
-- service_role: full access; anon: read-only on cases/actions for dashboard

-- Phase 3: Postgres Webhook Trigger
-- This calls out to either the Edge Function or the Node backend directly via pg_net
CREATE EXTENSION IF NOT EXISTS pg_net;

CREATE OR REPLACE FUNCTION public.handle_new_event() 
RETURNS TRIGGER AS $$
BEGIN
  PERFORM net.http_post(
      -- Defaulting to the local Node backend for local testing, 
      -- but in production this can be the Edge Function URL.
      url := COALESCE(current_setting('app.settings.webhook_url', true), 'http://host.docker.internal:3000/internal/process-event'),
      headers := '{"Content-Type": "application/json"}',
      body := json_build_object('type', 'INSERT', 'record', row_to_json(NEW))::text
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS on_event_created ON public.events;
CREATE TRIGGER on_event_created
  AFTER INSERT ON public.events
  FOR EACH ROW EXECUTE PROCEDURE public.handle_new_event();

-- Phase 5: Vector Search and Case Matching
CREATE OR REPLACE FUNCTION match_cases (
  query_embedding vector(1536),
  match_threshold float,
  match_count int
)
RETURNS TABLE (
  case_id uuid,
  event_type text,
  root_cause_bucket root_cause_bucket,
  intervention_type intervention_type,
  status case_status,
  raw_payload jsonb,
  similarity float
)
LANGUAGE plpgsql
AS $$
BEGIN
  RETURN QUERY
  SELECT
    rc.id AS case_id,
    e.event_type,
    rc.root_cause_bucket,
    rc.intervention_type,
    rc.status,
    e.raw_payload,
    1 - (e.embedding <=> query_embedding) AS similarity
  FROM events e
  JOIN recovery_cases rc ON rc.event_id = e.id
  WHERE 1 - (e.embedding <=> query_embedding) > match_threshold
    AND rc.status IN ('recovered', 'failed_to_recover', 'executed')
  ORDER BY e.embedding <=> query_embedding
  LIMIT match_count;
END;
$$;

-- Create an HNSW index for fast vector search on events
CREATE INDEX IF NOT EXISTS events_embedding_idx ON events USING hnsw (embedding vector_cosine_ops);

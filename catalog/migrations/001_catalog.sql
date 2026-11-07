-- [HNI-DB-05] Re-runnable schema. This file inserts no people.
-- [HNI-AUDIT-02] audit_events rejects update, delete, and truncate.

CREATE TABLE IF NOT EXISTS schema_migrations (
  filename text PRIMARY KEY,
  applied_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS users (
  object_id uuid PRIMARY KEY,
  role text NOT NULL CHECK (role IN ('Catalog.Read', 'Catalog.Approve')),
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS apps (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL UNIQUE CHECK (name ~ '^[a-z0-9]+([._-][a-z0-9]+)*$'),
  owner_object_id uuid NOT NULL,
  owner_display_name text,
  description text NOT NULL,
  url text NOT NULL,
  revision text NOT NULL,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'retired')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS apps_status_name_idx ON apps (status, name, id);

CREATE TABLE IF NOT EXISTS approvals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  app_name text NOT NULL,
  bitbucket_repo text NOT NULL,
  environment text NOT NULL CHECK (environment IN ('dev', 'qa', 'production')),
  pipeline_client_id uuid NOT NULL,
  federated_subject text NOT NULL,
  requester_object_id uuid NOT NULL,
  decision text NOT NULL DEFAULT 'pending' CHECK (decision IN ('pending', 'approved', 'rejected')),
  approver_object_id uuid,
  approver_subject text,
  decided_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS approvals_requester_decision_idx
  ON approvals (requester_object_id, decision, created_at, id);

CREATE TABLE IF NOT EXISTS pipeline_bindings (
  app_name text PRIMARY KEY,
  pipeline_client_id uuid NOT NULL UNIQUE,
  federated_subject text NOT NULL,
  bitbucket_repo text NOT NULL,
  environment text NOT NULL,
  approved_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS audit_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  actor text NOT NULL,
  action text NOT NULL,
  record_type text NOT NULL,
  record_id text NOT NULL,
  before_state jsonb,
  after_state jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS audit_events_record_idx
  ON audit_events (record_type, record_id, created_at);

CREATE OR REPLACE FUNCTION catalog_audit_immutable()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'audit_events cannot be changed';
END;
$$;

DROP TRIGGER IF EXISTS audit_events_no_update ON audit_events;
CREATE TRIGGER audit_events_no_update
  BEFORE UPDATE OR DELETE ON audit_events
  FOR EACH ROW
  EXECUTE FUNCTION catalog_audit_immutable();

DROP TRIGGER IF EXISTS audit_events_no_truncate ON audit_events;
CREATE TRIGGER audit_events_no_truncate
  BEFORE TRUNCATE ON audit_events
  FOR EACH STATEMENT
  EXECUTE FUNCTION catalog_audit_immutable();

-- [HNI-DB-05] Re-runnable. Bindings key on (ci_provider, repo_id), not a CI subject.
-- No CHECK on ci_provider: the catalog accepts only providers it has a validator for.
-- Rows approved before this migration have no repo_id and cannot register until re-approved.

ALTER TABLE approvals ADD COLUMN IF NOT EXISTS ci_provider text;
ALTER TABLE approvals ADD COLUMN IF NOT EXISTS repo_id text;

ALTER TABLE pipeline_bindings ADD COLUMN IF NOT EXISTS ci_provider text;
ALTER TABLE pipeline_bindings ADD COLUMN IF NOT EXISTS repo_id text;

CREATE UNIQUE INDEX IF NOT EXISTS pipeline_bindings_ci_repo_idx
  ON pipeline_bindings (ci_provider, repo_id);

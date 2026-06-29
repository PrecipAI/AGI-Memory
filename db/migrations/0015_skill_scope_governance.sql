BEGIN;

ALTER TABLE skill
    ADD COLUMN IF NOT EXISTS origin_scope text NOT NULL DEFAULT 'session',
    ADD COLUMN IF NOT EXISTS availability_scope text NOT NULL DEFAULT 'session_only',
    ADD COLUMN IF NOT EXISTS governance_level text NOT NULL DEFAULT 'session',
    ADD COLUMN IF NOT EXISTS promotion_status text NOT NULL DEFAULT 'active';

CREATE INDEX IF NOT EXISTS idx_skill_scope_availability
    ON skill (tenant_id, scope, origin_scope, availability_scope, promotion_status, created_at DESC);

COMMIT;

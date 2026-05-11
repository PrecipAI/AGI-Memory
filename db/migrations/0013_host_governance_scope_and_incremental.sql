BEGIN;

CREATE TABLE IF NOT EXISTS host_governance_event (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id text NOT NULL,
    scope text NOT NULL,
    status record_status NOT NULL DEFAULT 'recorded',
    version integer NOT NULL DEFAULT 1,
    host text NOT NULL,
    thread_id text NOT NULL,
    session_file text NOT NULL,
    source_kind text NOT NULL,
    source_timestamp timestamptz,
    candidate_type text NOT NULL,
    event_hash text NOT NULL,
    origin_scope text NOT NULL DEFAULT 'session',
    availability_scope text NOT NULL DEFAULT 'session_only',
    promotion_status text NOT NULL DEFAULT 'candidate',
    output_object_type text,
    output_object_id uuid,
    metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
    trace_id text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (tenant_id, scope, host, event_hash)
);

CREATE INDEX IF NOT EXISTS idx_host_governance_event_thread
    ON host_governance_event (tenant_id, scope, host, thread_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_host_governance_event_promotion
    ON host_governance_event (tenant_id, scope, availability_scope, promotion_status, created_at DESC);

ALTER TABLE rule
    ADD COLUMN IF NOT EXISTS origin_scope text NOT NULL DEFAULT 'session',
    ADD COLUMN IF NOT EXISTS availability_scope text NOT NULL DEFAULT 'session_only',
    ADD COLUMN IF NOT EXISTS promotion_status text NOT NULL DEFAULT 'active',
    ADD COLUMN IF NOT EXISTS rule_domain text NOT NULL DEFAULT 'execution',
    ADD COLUMN IF NOT EXISTS rule_scope text NOT NULL DEFAULT 'session';

CREATE INDEX IF NOT EXISTS idx_rule_scope_domain
    ON rule (tenant_id, scope, rule_domain, rule_scope, promotion_status, priority DESC);

ALTER TABLE memory
    ADD COLUMN IF NOT EXISTS origin_scope text NOT NULL DEFAULT 'session',
    ADD COLUMN IF NOT EXISTS availability_scope text NOT NULL DEFAULT 'session_only',
    ADD COLUMN IF NOT EXISTS promotion_status text NOT NULL DEFAULT 'active';

CREATE INDEX IF NOT EXISTS idx_memory_availability_scope
    ON memory (tenant_id, scope, availability_scope, promotion_status, importance DESC);

ALTER TABLE governance_change_proposal
    ADD COLUMN IF NOT EXISTS origin_scope text NOT NULL DEFAULT 'session',
    ADD COLUMN IF NOT EXISTS availability_scope text NOT NULL DEFAULT 'session_only',
    ADD COLUMN IF NOT EXISTS promotion_status text NOT NULL DEFAULT 'needs_review';

CREATE INDEX IF NOT EXISTS idx_governance_change_proposal_availability
    ON governance_change_proposal (tenant_id, scope, availability_scope, promotion_status, created_at DESC);

COMMIT;

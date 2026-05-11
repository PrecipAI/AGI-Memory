BEGIN;

ALTER TABLE host_governance_event
    ADD COLUMN IF NOT EXISTS governance_level text NOT NULL DEFAULT 'session';

CREATE INDEX IF NOT EXISTS idx_host_governance_event_level
    ON host_governance_event (tenant_id, scope, host, governance_level, promotion_status, created_at DESC);

ALTER TABLE rule
    ADD COLUMN IF NOT EXISTS governance_level text NOT NULL DEFAULT 'session';

CREATE INDEX IF NOT EXISTS idx_rule_governance_level
    ON rule (tenant_id, scope, governance_level, rule_domain, promotion_status, priority DESC);

ALTER TABLE memory
    ADD COLUMN IF NOT EXISTS governance_level text NOT NULL DEFAULT 'session';

CREATE INDEX IF NOT EXISTS idx_memory_governance_level
    ON memory (tenant_id, scope, governance_level, promotion_status, importance DESC);

ALTER TABLE governance_change_proposal
    ADD COLUMN IF NOT EXISTS governance_level text NOT NULL DEFAULT 'session';

CREATE INDEX IF NOT EXISTS idx_governance_change_proposal_level
    ON governance_change_proposal (tenant_id, scope, governance_level, promotion_status, created_at DESC);

COMMIT;

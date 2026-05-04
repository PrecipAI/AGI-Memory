BEGIN;

CREATE TABLE IF NOT EXISTS governance_change_proposal (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id text NOT NULL,
    scope text NOT NULL,
    status record_status NOT NULL DEFAULT 'recorded',
    version integer NOT NULL DEFAULT 1,
    target_object_type text NOT NULL,
    target_object_id uuid,
    proposed_action text NOT NULL,
    proposed_payload jsonb NOT NULL DEFAULT '{}'::jsonb,
    reason text NOT NULL,
    risk_level risk_level NOT NULL DEFAULT 'medium',
    source_ref text,
    human_decision text,
    human_response jsonb,
    decided_at timestamptz,
    trace_id text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_governance_change_proposal_scope_status
    ON governance_change_proposal (tenant_id, scope, status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_governance_change_proposal_target
    ON governance_change_proposal (target_object_type, target_object_id, status);

COMMIT;

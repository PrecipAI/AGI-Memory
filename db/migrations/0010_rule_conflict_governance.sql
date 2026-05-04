BEGIN;

CREATE TABLE IF NOT EXISTS rule_conflict (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id text NOT NULL,
    scope text NOT NULL,
    status record_status NOT NULL DEFAULT 'recorded',
    version integer NOT NULL DEFAULT 1,
    left_rule_id uuid NOT NULL REFERENCES rule(id) ON DELETE CASCADE,
    right_rule_id uuid NOT NULL REFERENCES rule(id) ON DELETE CASCADE,
    conflict_type text NOT NULL,
    severity risk_level NOT NULL DEFAULT 'medium',
    resolution_action text NOT NULL DEFAULT 'lower_priority_rule_dirtied',
    details jsonb NOT NULL DEFAULT '{}'::jsonb,
    trace_id text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (tenant_id, scope, left_rule_id, right_rule_id, conflict_type)
);

CREATE INDEX IF NOT EXISTS idx_rule_conflict_scope_status ON rule_conflict (tenant_id, scope, status);
CREATE INDEX IF NOT EXISTS idx_rule_conflict_rules ON rule_conflict (left_rule_id, right_rule_id);

COMMIT;

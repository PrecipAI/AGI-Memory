BEGIN;

CREATE TABLE IF NOT EXISTS rule (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id text NOT NULL,
    scope text NOT NULL,
    status record_status NOT NULL DEFAULT 'active',
    version integer NOT NULL DEFAULT 1,
    rule_key text NOT NULL,
    rule_type text NOT NULL,
    title text NOT NULL,
    statement text NOT NULL,
    normalized_statement text NOT NULL,
    applies_to jsonb NOT NULL DEFAULT '[]'::jsonb,
    trigger_conditions jsonb NOT NULL DEFAULT '{}'::jsonb,
    enforcement_level text NOT NULL DEFAULT 'should_follow',
    priority smallint NOT NULL DEFAULT 50,
    risk_level risk_level NOT NULL DEFAULT 'medium',
    verification_status text NOT NULL,
    source_refs jsonb NOT NULL DEFAULT '[]'::jsonb,
    evidence_refs jsonb NOT NULL DEFAULT '[]'::jsonb,
    supersedes_rule_id uuid REFERENCES rule(id),
    metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
    trace_id text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (tenant_id, scope, rule_key, version)
);

CREATE INDEX IF NOT EXISTS idx_rule_scope_status ON rule (tenant_id, scope, status);
CREATE INDEX IF NOT EXISTS idx_rule_type_enforcement ON rule (rule_type, enforcement_level);
CREATE INDEX IF NOT EXISTS idx_rule_priority_risk ON rule (priority DESC, risk_level);

COMMIT;

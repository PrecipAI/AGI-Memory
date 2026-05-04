BEGIN;

CREATE TABLE IF NOT EXISTS extension_pack (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id text NOT NULL,
    scope text NOT NULL,
    status record_status NOT NULL DEFAULT 'recorded',
    version integer NOT NULL DEFAULT 1,
    pack_key text NOT NULL,
    title text NOT NULL,
    description text NOT NULL,
    author_ref text,
    source_ref text,
    risk_level risk_level NOT NULL DEFAULT 'medium',
    activation_policy jsonb NOT NULL DEFAULT '{}'::jsonb,
    metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
    trace_id text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (tenant_id, scope, pack_key, version)
);
CREATE INDEX IF NOT EXISTS idx_extension_pack_scope_status
    ON extension_pack (tenant_id, scope, status, pack_key);

CREATE TABLE IF NOT EXISTS task_binding (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id text NOT NULL,
    scope text NOT NULL,
    status record_status NOT NULL DEFAULT 'active',
    version integer NOT NULL DEFAULT 1,
    binding_key text NOT NULL,
    title text NOT NULL,
    description text NOT NULL,
    extension_pack_id uuid REFERENCES extension_pack(id) ON DELETE SET NULL,
    task_types text[] NOT NULL DEFAULT ARRAY[]::text[],
    hosts text[] NOT NULL DEFAULT ARRAY[]::text[],
    projects text[] NOT NULL DEFAULT ARRAY[]::text[],
    trigger_conditions jsonb NOT NULL DEFAULT '{}'::jsonb,
    rule_keys text[] NOT NULL DEFAULT ARRAY[]::text[],
    skill_keys text[] NOT NULL DEFAULT ARRAY[]::text[],
    priority smallint NOT NULL DEFAULT 50,
    risk_level risk_level NOT NULL DEFAULT 'medium',
    activation_policy jsonb NOT NULL DEFAULT '{}'::jsonb,
    source_ref text,
    metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
    trace_id text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (tenant_id, scope, binding_key, version)
);
CREATE INDEX IF NOT EXISTS idx_task_binding_scope_status
    ON task_binding (tenant_id, scope, status, priority DESC);
CREATE INDEX IF NOT EXISTS idx_task_binding_task_types
    ON task_binding USING gin (task_types);
CREATE INDEX IF NOT EXISTS idx_task_binding_hosts
    ON task_binding USING gin (hosts);

CREATE TABLE IF NOT EXISTS rule_checkpoint (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id text NOT NULL,
    scope text NOT NULL,
    status record_status NOT NULL DEFAULT 'active',
    version integer NOT NULL DEFAULT 1,
    rule_id uuid NOT NULL REFERENCES rule(id) ON DELETE CASCADE,
    checkpoint_key text NOT NULL,
    checkpoint_phase text NOT NULL,
    operation text,
    requirement text NOT NULL,
    evidence_required jsonb NOT NULL DEFAULT '[]'::jsonb,
    verifier_ref text,
    failure_behavior text NOT NULL DEFAULT 'block_and_report',
    priority smallint NOT NULL DEFAULT 50,
    metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
    trace_id text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (tenant_id, scope, rule_id, checkpoint_key, version)
);
CREATE INDEX IF NOT EXISTS idx_rule_checkpoint_rule_phase
    ON rule_checkpoint (tenant_id, scope, rule_id, checkpoint_phase, status);
CREATE INDEX IF NOT EXISTS idx_rule_checkpoint_operation
    ON rule_checkpoint (tenant_id, scope, operation, status);

CREATE TABLE IF NOT EXISTS rule_gate_audit (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id text NOT NULL,
    scope text NOT NULL,
    status record_status NOT NULL DEFAULT 'recorded',
    version integer NOT NULL DEFAULT 1,
    task_request_id uuid REFERENCES task_request(id) ON DELETE SET NULL,
    task_step_id uuid REFERENCES task_step(id) ON DELETE SET NULL,
    rule_id uuid REFERENCES rule(id) ON DELETE SET NULL,
    checkpoint_id uuid REFERENCES rule_checkpoint(id) ON DELETE SET NULL,
    gate_key text NOT NULL,
    operation text NOT NULL,
    decision text NOT NULL,
    evidence jsonb NOT NULL DEFAULT '{}'::jsonb,
    reason text,
    actor_ref text,
    trace_id text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_rule_gate_audit_task_time
    ON rule_gate_audit (tenant_id, scope, task_request_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_rule_gate_audit_rule_decision
    ON rule_gate_audit (tenant_id, scope, rule_id, decision);

COMMIT;

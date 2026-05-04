BEGIN;

CREATE TABLE drift_check_result (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id text NOT NULL,
    scope text NOT NULL,
    status record_status NOT NULL DEFAULT 'recorded',
    version integer NOT NULL DEFAULT 1,
    task_request_id uuid NOT NULL REFERENCES task_request(id),
    task_step_id uuid REFERENCES task_step(id),
    resource_locator jsonb NOT NULL DEFAULT '{}'::jsonb,
    probe_payload jsonb NOT NULL DEFAULT '{}'::jsonb,
    match_result text NOT NULL,
    drift_reason text,
    trace_id text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_drift_check_result_scope_status ON drift_check_result (tenant_id, scope, status);
CREATE INDEX idx_drift_check_result_task_time ON drift_check_result (task_request_id, task_step_id, created_at DESC);
CREATE INDEX idx_drift_check_result_match ON drift_check_result (match_result, created_at DESC);

CREATE TABLE zombie_state (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id text NOT NULL,
    scope text NOT NULL,
    status record_status NOT NULL DEFAULT 'parked',
    version integer NOT NULL DEFAULT 1,
    task_request_id uuid NOT NULL REFERENCES task_request(id),
    task_step_id uuid REFERENCES task_step(id),
    resource_locator jsonb NOT NULL DEFAULT '{}'::jsonb,
    handoff_reason text NOT NULL,
    operator_owner text NOT NULL,
    remediation_payload jsonb NOT NULL DEFAULT '{}'::jsonb,
    trace_id text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_zombie_state_scope_status ON zombie_state (tenant_id, scope, status);
CREATE INDEX idx_zombie_state_task_time ON zombie_state (task_request_id, task_step_id, created_at DESC);

CREATE TABLE reconciliation_item (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id text NOT NULL,
    scope text NOT NULL,
    status record_status NOT NULL DEFAULT 'recorded',
    version integer NOT NULL DEFAULT 1,
    task_request_id uuid NOT NULL REFERENCES task_request(id),
    task_step_id uuid REFERENCES task_step(id),
    reconciliation_type text NOT NULL,
    expected_state jsonb NOT NULL DEFAULT '{}'::jsonb,
    observed_state jsonb NOT NULL DEFAULT '{}'::jsonb,
    action_state text NOT NULL DEFAULT 'recorded',
    trace_id text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_reconciliation_item_scope_status ON reconciliation_item (tenant_id, scope, status);
CREATE INDEX idx_reconciliation_item_task_time ON reconciliation_item (task_request_id, task_step_id, created_at DESC);
CREATE INDEX idx_reconciliation_item_type_state ON reconciliation_item (reconciliation_type, action_state, created_at DESC);

CREATE TABLE task_attempt (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id text NOT NULL,
    scope text NOT NULL,
    status record_status NOT NULL DEFAULT 'recorded',
    version integer NOT NULL DEFAULT 1,
    task_request_id uuid NOT NULL REFERENCES task_request(id),
    task_plan_id uuid REFERENCES task_plan(id),
    task_step_id uuid NOT NULL REFERENCES task_step(id),
    attempt_no integer NOT NULL,
    dispatch_payload jsonb NOT NULL DEFAULT '{}'::jsonb,
    dispatch_started_at timestamptz NOT NULL DEFAULT now(),
    dispatch_finished_at timestamptz,
    outcome_code text,
    outcome_payload jsonb NOT NULL DEFAULT '{}'::jsonb,
    trace_id text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (task_step_id, attempt_no)
);
CREATE INDEX idx_task_attempt_scope_status ON task_attempt (tenant_id, scope, status);
CREATE INDEX idx_task_attempt_step_time ON task_attempt (task_step_id, dispatch_started_at DESC);
CREATE INDEX idx_task_attempt_request_time ON task_attempt (task_request_id, dispatch_started_at DESC);

COMMIT;

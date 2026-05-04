BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TYPE risk_level AS ENUM ('low', 'medium', 'high', 'critical');
CREATE TYPE task_request_status AS ENUM (
    'requested', 'planned', 'running', 'blocked', 'succeeded', 'failed',
    'aborting', 'closed_clean', 'closed_partial', 'dlq_parked',
    'quarantined_drifted', 'manual_recovery_required', 'cancelled'
);
CREATE TYPE task_plan_status AS ENUM ('draft', 'resolved', 'approved', 'executing', 'replanned', 'finalized');
CREATE TYPE task_step_status AS ENUM ('pending', 'ready', 'running', 'blocked', 'succeeded', 'failed', 'cancelled', 'aborting');
CREATE TYPE task_result_status AS ENUM ('open', 'finalized', 'revoked', 'blocked', 'failed');
CREATE TYPE stream_state AS ENUM ('provisional', 'committed', 'revoked', 'replanned', 'blocked');
CREATE TYPE side_effect_class AS ENUM ('none', 'read_only', 'external_resource', 'state_change', 'approval');
CREATE TYPE record_status AS ENUM ('active', 'disabled', 'retired', 'superseded', 'dirty', 'rebuilding', 'recorded', 'parked', 'resolved');
CREATE TYPE verification_phase AS ENUM ('precheck', 'postcheck', 'acceptance', 'cleanup');
CREATE TYPE verification_verdict AS ENUM ('passed', 'failed', 'waived');

CREATE TABLE task_request (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id text NOT NULL,
    scope text NOT NULL,
    status task_request_status NOT NULL DEFAULT 'requested',
    version integer NOT NULL DEFAULT 1,
    request_channel text NOT NULL,
    requester_id text,
    task_type text NOT NULL,
    goal text NOT NULL,
    input_payload jsonb NOT NULL DEFAULT '{}'::jsonb,
    normalized_envelope jsonb NOT NULL DEFAULT '{}'::jsonb,
    priority smallint NOT NULL DEFAULT 50,
    idempotency_key text NOT NULL,
    trace_id text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (tenant_id, idempotency_key)
);
CREATE INDEX idx_task_request_scope_status ON task_request (tenant_id, scope, status);
CREATE INDEX idx_task_request_type_status ON task_request (task_type, status);

CREATE TABLE task_plan (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id text NOT NULL,
    scope text NOT NULL,
    status task_plan_status NOT NULL DEFAULT 'draft',
    version integer NOT NULL DEFAULT 1,
    task_request_id uuid NOT NULL REFERENCES task_request(id),
    planning_model text,
    plan_hash text NOT NULL,
    goal text NOT NULL,
    acceptance_criteria jsonb NOT NULL DEFAULT '[]'::jsonb,
    risk_level risk_level NOT NULL DEFAULT 'medium',
    plan_payload jsonb NOT NULL DEFAULT '{}'::jsonb,
    trace_id text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (task_request_id, version),
    UNIQUE (tenant_id, plan_hash)
);
CREATE INDEX idx_task_plan_scope_status ON task_plan (tenant_id, scope, status);

CREATE TABLE capability_registry (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id text NOT NULL,
    scope text NOT NULL,
    status record_status NOT NULL DEFAULT 'active',
    version integer NOT NULL DEFAULT 1,
    capability_key text NOT NULL,
    capability_type text NOT NULL,
    display_name text NOT NULL,
    endpoint_ref text NOT NULL,
    task_types text[] NOT NULL DEFAULT ARRAY[]::text[],
    risk_level risk_level NOT NULL DEFAULT 'low',
    fingerprint_requirement text,
    approval_mode text NOT NULL DEFAULT 'none',
    input_schema_ref text NOT NULL,
    output_schema_ref text NOT NULL,
    metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
    trace_id text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (tenant_id, scope, capability_key, version)
);
CREATE INDEX idx_capability_registry_scope_status ON capability_registry (tenant_id, scope, status);
CREATE INDEX idx_capability_registry_type_risk ON capability_registry (capability_type, risk_level);

CREATE TABLE task_step (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id text NOT NULL,
    scope text NOT NULL,
    status task_step_status NOT NULL DEFAULT 'pending',
    version integer NOT NULL DEFAULT 1,
    task_plan_id uuid NOT NULL REFERENCES task_plan(id),
    step_key text NOT NULL,
    step_order integer NOT NULL,
    title text NOT NULL,
    step_type text NOT NULL,
    dependency_keys text[] NOT NULL DEFAULT ARRAY[]::text[],
    input_payload jsonb NOT NULL DEFAULT '{}'::jsonb,
    expected_output jsonb NOT NULL DEFAULT '{}'::jsonb,
    acceptance_criteria jsonb NOT NULL DEFAULT '[]'::jsonb,
    risk_level risk_level NOT NULL DEFAULT 'medium',
    side_effect_class side_effect_class NOT NULL DEFAULT 'none',
    capability_hint text,
    compensation_hint jsonb,
    idempotency_key text NOT NULL,
    assigned_capability_id uuid REFERENCES capability_registry(id),
    current_attempt integer NOT NULL DEFAULT 0,
    trace_id text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (task_plan_id, step_key),
    UNIQUE (tenant_id, idempotency_key)
);
CREATE INDEX idx_task_step_scope_status ON task_step (tenant_id, scope, status);
CREATE INDEX idx_task_step_capability_status ON task_step (assigned_capability_id, status);

CREATE TABLE task_result (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id text NOT NULL,
    scope text NOT NULL,
    status task_result_status NOT NULL DEFAULT 'open',
    version integer NOT NULL DEFAULT 1,
    task_request_id uuid NOT NULL REFERENCES task_request(id),
    task_plan_id uuid NOT NULL REFERENCES task_plan(id),
    final_step_id uuid REFERENCES task_step(id),
    output_state stream_state NOT NULL DEFAULT 'provisional',
    user_summary text NOT NULL,
    system_result jsonb NOT NULL DEFAULT '{}'::jsonb,
    verification_summary jsonb,
    cleanup_summary jsonb,
    trace_id text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (task_request_id, version)
);
CREATE INDEX idx_task_result_scope_status ON task_result (tenant_id, scope, status);
CREATE INDEX idx_task_result_output_state ON task_result (output_state, status);

CREATE TABLE execution_journal (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id text NOT NULL,
    scope text NOT NULL,
    status record_status NOT NULL DEFAULT 'recorded',
    version integer NOT NULL DEFAULT 1,
    task_request_id uuid NOT NULL REFERENCES task_request(id),
    task_plan_id uuid NOT NULL REFERENCES task_plan(id),
    task_step_id uuid NOT NULL REFERENCES task_step(id),
    journal_seq bigint NOT NULL,
    checkpoint text NOT NULL,
    effect_phase text NOT NULL,
    dependency_id text,
    resource_locator jsonb,
    payload_hash text,
    journal_payload jsonb NOT NULL DEFAULT '{}'::jsonb,
    idempotency_key text NOT NULL,
    trace_id text NOT NULL,
    occurred_at timestamptz NOT NULL DEFAULT now(),
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (task_step_id, journal_seq)
);
CREATE INDEX idx_execution_journal_scope_status ON execution_journal (tenant_id, scope, status);
CREATE INDEX idx_execution_journal_task_time ON execution_journal (task_request_id, task_step_id, occurred_at);

CREATE TABLE compensation_capsule (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id text NOT NULL,
    scope text NOT NULL,
    status record_status NOT NULL DEFAULT 'active',
    version integer NOT NULL DEFAULT 1,
    task_request_id uuid NOT NULL REFERENCES task_request(id),
    task_plan_id uuid NOT NULL REFERENCES task_plan(id),
    task_step_id uuid NOT NULL REFERENCES task_step(id),
    side_effect_class side_effect_class NOT NULL,
    idempotency_key text NOT NULL,
    target_dependency text NOT NULL,
    compensator_id text NOT NULL,
    compensator_version text NOT NULL,
    resource_locator jsonb NOT NULL DEFAULT '{}'::jsonb,
    request_payload_hash text NOT NULL,
    precondition_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
    cleanup_precondition jsonb,
    fingerprint_at_execution text NOT NULL,
    committed_resource_id text,
    response_handle text,
    revision text,
    capsule_payload jsonb NOT NULL DEFAULT '{}'::jsonb,
    trace_id text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (tenant_id, task_step_id, idempotency_key)
);
CREATE INDEX idx_compensation_capsule_scope_status ON compensation_capsule (tenant_id, scope, status);
CREATE INDEX idx_compensation_capsule_dependency ON compensation_capsule (target_dependency, compensator_id);

CREATE TABLE failure_event (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id text NOT NULL,
    scope text NOT NULL,
    status record_status NOT NULL DEFAULT 'active',
    version integer NOT NULL DEFAULT 1,
    task_request_id uuid NOT NULL REFERENCES task_request(id),
    task_plan_id uuid NOT NULL REFERENCES task_plan(id),
    task_step_id uuid REFERENCES task_step(id),
    failure_code text NOT NULL,
    failure_class text NOT NULL,
    error_signature text NOT NULL,
    dependency_id text,
    retryable boolean NOT NULL DEFAULT false,
    severity smallint NOT NULL DEFAULT 1,
    verifier_phase verification_phase,
    detail_payload jsonb NOT NULL DEFAULT '{}'::jsonb,
    trace_id text NOT NULL,
    occurred_at timestamptz NOT NULL DEFAULT now(),
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_failure_event_scope_status ON failure_event (tenant_id, scope, status);
CREATE INDEX idx_failure_event_dependency_signature ON failure_event (dependency_id, error_signature);
CREATE INDEX idx_failure_event_task_time ON failure_event (task_request_id, occurred_at);

CREATE TABLE verification_result (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id text NOT NULL,
    scope text NOT NULL,
    status record_status NOT NULL DEFAULT 'active',
    version integer NOT NULL DEFAULT 1,
    task_request_id uuid NOT NULL REFERENCES task_request(id),
    task_plan_id uuid NOT NULL REFERENCES task_plan(id),
    task_step_id uuid REFERENCES task_step(id),
    verification_phase verification_phase NOT NULL,
    verdict verification_verdict NOT NULL,
    verifier_id text NOT NULL,
    evidence_payload jsonb NOT NULL DEFAULT '{}'::jsonb,
    failure_event_id uuid REFERENCES failure_event(id),
    trace_id text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_verification_result_scope_status ON verification_result (tenant_id, scope, status);
CREATE INDEX idx_verification_result_phase_verdict ON verification_result (verification_phase, verdict);
CREATE INDEX idx_verification_result_task_step ON verification_result (task_request_id, task_step_id);

CREATE TABLE cleanup_dlq (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id text NOT NULL,
    scope text NOT NULL,
    status record_status NOT NULL DEFAULT 'parked',
    version integer NOT NULL DEFAULT 1,
    task_request_id uuid NOT NULL REFERENCES task_request(id),
    task_plan_id uuid NOT NULL REFERENCES task_plan(id),
    task_step_id uuid REFERENCES task_step(id),
    dependency_id text NOT NULL,
    error_signature text NOT NULL,
    compensator_id text NOT NULL,
    fingerprint text NOT NULL,
    failure_window_start timestamptz NOT NULL,
    failure_window_end timestamptz NOT NULL,
    retry_count integer NOT NULL DEFAULT 0,
    replay_after timestamptz,
    frozen_scope boolean NOT NULL DEFAULT false,
    last_failure_payload jsonb NOT NULL DEFAULT '{}'::jsonb,
    trace_id text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_cleanup_dlq_scope_status ON cleanup_dlq (tenant_id, scope, status);
CREATE INDEX idx_cleanup_dlq_dependency_replay ON cleanup_dlq (dependency_id, status, replay_after);
CREATE INDEX idx_cleanup_dlq_signature ON cleanup_dlq (error_signature, compensator_id, fingerprint);

CREATE TABLE cleanup_incident_cluster (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id text NOT NULL,
    scope text NOT NULL,
    status record_status NOT NULL DEFAULT 'active',
    version integer NOT NULL DEFAULT 1,
    dependency_id text NOT NULL,
    error_signature text NOT NULL,
    compensator_id text NOT NULL,
    fingerprint text NOT NULL,
    failure_window_start timestamptz NOT NULL,
    failure_window_end timestamptz NOT NULL,
    affected_item_count integer NOT NULL DEFAULT 0,
    dependency_state_snapshot text NOT NULL,
    thaw_eligible boolean NOT NULL DEFAULT false,
    trace_id text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (tenant_id, scope, dependency_id, error_signature, compensator_id, fingerprint, failure_window_start)
);
CREATE INDEX idx_cleanup_cluster_scope_status ON cleanup_incident_cluster (tenant_id, scope, status);

CREATE TABLE dependency_state (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id text NOT NULL,
    scope text NOT NULL,
    status text NOT NULL CHECK (status IN ('DOWN', 'HALF-OPEN', 'UP')),
    version integer NOT NULL DEFAULT 1,
    dependency_id text NOT NULL,
    display_name text NOT NULL,
    last_probe_result jsonb,
    failure_rate numeric(5,2),
    last_failure_at timestamptz,
    last_recovered_at timestamptz,
    half_open_since timestamptz,
    trace_id text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (tenant_id, scope, dependency_id)
);
CREATE INDEX idx_dependency_state_scope_status ON dependency_state (tenant_id, scope, status);

CREATE TABLE memory (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id text NOT NULL,
    scope text NOT NULL,
    status record_status NOT NULL DEFAULT 'active',
    version integer NOT NULL DEFAULT 1,
    memory_type text NOT NULL,
    title text NOT NULL,
    content text NOT NULL,
    normalized_content text,
    source_kind text NOT NULL,
    source_ref text NOT NULL,
    verification_status text NOT NULL,
    fingerprint_requirement text,
    tags text[] NOT NULL DEFAULT ARRAY[]::text[],
    metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
    importance smallint NOT NULL DEFAULT 50,
    confidence_score numeric(4,3) NOT NULL DEFAULT 0.500,
    supersedes_id uuid REFERENCES memory(id),
    trace_id text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_memory_scope_status ON memory (tenant_id, scope, status);
CREATE INDEX idx_memory_type_verification ON memory (memory_type, verification_status);
CREATE INDEX idx_memory_fingerprint ON memory (fingerprint_requirement);

CREATE TABLE skill (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id text NOT NULL,
    scope text NOT NULL,
    status record_status NOT NULL DEFAULT 'active',
    version integer NOT NULL DEFAULT 1,
    skill_key text NOT NULL,
    title text NOT NULL,
    description text NOT NULL,
    skill_type text NOT NULL,
    trigger_conditions jsonb NOT NULL DEFAULT '{}'::jsonb,
    procedure_payload jsonb NOT NULL DEFAULT '{}'::jsonb,
    verification_status text NOT NULL,
    fingerprint_requirement text,
    risk_level risk_level NOT NULL DEFAULT 'medium',
    success_rate numeric(5,2),
    tags text[] NOT NULL DEFAULT ARRAY[]::text[],
    trace_id text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (tenant_id, scope, skill_key, version)
);
CREATE INDEX idx_skill_scope_status ON skill (tenant_id, scope, status);
CREATE INDEX idx_skill_fingerprint_risk ON skill (fingerprint_requirement, risk_level);

CREATE TABLE resident_snapshot (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id text NOT NULL,
    scope text NOT NULL,
    status record_status NOT NULL DEFAULT 'active',
    version integer NOT NULL DEFAULT 1,
    snapshot_key text NOT NULL,
    snapshot_payload jsonb NOT NULL DEFAULT '{}'::jsonb,
    source_memory_ids uuid[] NOT NULL DEFAULT ARRAY[]::uuid[],
    source_skill_ids uuid[] NOT NULL DEFAULT ARRAY[]::uuid[],
    dirty_reason text,
    generated_at timestamptz NOT NULL DEFAULT now(),
    expires_at timestamptz,
    trace_id text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (tenant_id, scope, snapshot_key, version)
);
CREATE INDEX idx_resident_snapshot_scope_status ON resident_snapshot (tenant_id, scope, status);

COMMIT;

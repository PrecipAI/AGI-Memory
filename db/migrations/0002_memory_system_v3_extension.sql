BEGIN;

CREATE TYPE task_run_status AS ENUM ('created', 'running', 'succeeded', 'failed', 'aborting');
CREATE TYPE memory_candidate_status AS ENUM ('extracted', 'ranked', 'routed', 'persisted', 'dropped', 'blocked');
CREATE TYPE fingerprint_status AS ENUM ('matched', 'matched_or_na', 'mismatch', 'unknown');

CREATE TABLE message (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id text NOT NULL,
    scope text NOT NULL,
    status record_status NOT NULL DEFAULT 'active',
    version integer NOT NULL DEFAULT 1,
    task_request_id uuid NOT NULL REFERENCES task_request(id),
    role text NOT NULL,
    content text NOT NULL,
    normalized_content text,
    message_type text NOT NULL,
    metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
    trace_id text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_message_scope_status ON message (tenant_id, scope, status);
CREATE INDEX idx_message_task_time ON message (task_request_id, created_at);

CREATE TABLE task_run (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id text NOT NULL,
    scope text NOT NULL,
    status record_status NOT NULL DEFAULT 'active',
    version integer NOT NULL DEFAULT 1,
    task_request_id uuid NOT NULL REFERENCES task_request(id),
    run_status task_run_status NOT NULL DEFAULT 'created',
    goal text NOT NULL,
    started_at timestamptz NOT NULL DEFAULT now(),
    finished_at timestamptz,
    recovery_state jsonb NOT NULL DEFAULT '{}'::jsonb,
    trace_id text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (task_request_id)
);
CREATE INDEX idx_task_run_scope_status ON task_run (tenant_id, scope, status);
CREATE INDEX idx_task_run_run_status ON task_run (run_status, started_at);

CREATE TABLE artifact (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id text NOT NULL,
    scope text NOT NULL,
    status record_status NOT NULL DEFAULT 'active',
    version integer NOT NULL DEFAULT 1,
    task_request_id uuid NOT NULL REFERENCES task_request(id),
    task_plan_id uuid REFERENCES task_plan(id),
    task_step_id uuid REFERENCES task_step(id),
    artifact_type text NOT NULL,
    artifact_tag text NOT NULL,
    content text,
    structured_payload jsonb NOT NULL DEFAULT '{}'::jsonb,
    verification_status text NOT NULL,
    side_effect_class side_effect_class NOT NULL DEFAULT 'none',
    source_ref text NOT NULL,
    trace_id text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_artifact_scope_status ON artifact (tenant_id, scope, status);
CREATE INDEX idx_artifact_task_ref ON artifact (task_request_id, task_step_id, created_at);
CREATE INDEX idx_artifact_tag_verification ON artifact (artifact_tag, verification_status);

CREATE TABLE conversation_summary (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id text NOT NULL,
    scope text NOT NULL,
    status record_status NOT NULL DEFAULT 'active',
    version integer NOT NULL DEFAULT 1,
    task_request_id uuid NOT NULL REFERENCES task_request(id),
    summary_key text NOT NULL,
    summary_type text NOT NULL,
    source_range_start integer NOT NULL DEFAULT 0,
    source_range_end integer NOT NULL DEFAULT 0,
    summary_payload jsonb NOT NULL DEFAULT '{}'::jsonb,
    supersedes_id uuid REFERENCES conversation_summary(id),
    rebuild_status text NOT NULL DEFAULT 'fresh',
    trace_id text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (tenant_id, scope, summary_key, version)
);
CREATE INDEX idx_conversation_summary_scope_status ON conversation_summary (tenant_id, scope, status);
CREATE INDEX idx_conversation_summary_task_type ON conversation_summary (task_request_id, summary_type, status);

CREATE TABLE memory_candidate (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id text NOT NULL,
    scope text NOT NULL,
    status memory_candidate_status NOT NULL DEFAULT 'extracted',
    version integer NOT NULL DEFAULT 1,
    task_request_id uuid NOT NULL REFERENCES task_request(id),
    task_step_id uuid REFERENCES task_step(id),
    source_type text NOT NULL,
    source_ref text NOT NULL,
    artifact_tag text NOT NULL,
    error_code text,
    verification_status text NOT NULL,
    side_effect_class side_effect_class NOT NULL DEFAULT 'none',
    fingerprint text,
    fingerprint_status fingerprint_status NOT NULL DEFAULT 'unknown',
    routing_decision text,
    rank_score numeric(6,3) NOT NULL DEFAULT 0.000,
    persist_target text,
    candidate_payload jsonb NOT NULL DEFAULT '{}'::jsonb,
    llm_refined_payload jsonb,
    trace_id text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_memory_candidate_scope_status ON memory_candidate (tenant_id, scope, status);
CREATE INDEX idx_memory_candidate_routing ON memory_candidate (routing_decision, fingerprint_status, verification_status);
CREATE INDEX idx_memory_candidate_task_time ON memory_candidate (task_request_id, task_step_id, created_at);

CREATE TABLE environment_fingerprint (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id text NOT NULL,
    scope text NOT NULL,
    status record_status NOT NULL DEFAULT 'active',
    version integer NOT NULL DEFAULT 1,
    fingerprint_key text NOT NULL,
    capability_version text NOT NULL,
    config_hash text NOT NULL,
    schema_version text NOT NULL,
    dependency_signature text NOT NULL,
    deployment_baseline_id text NOT NULL,
    trace_id text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (tenant_id, scope, fingerprint_key)
);
CREATE INDEX idx_environment_fingerprint_scope_status ON environment_fingerprint (tenant_id, scope, status);
CREATE INDEX idx_environment_fingerprint_key_status ON environment_fingerprint (fingerprint_key, status);

COMMIT;

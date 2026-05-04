BEGIN;

CREATE TABLE memory_access_log (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id text NOT NULL,
    scope text NOT NULL,
    status record_status NOT NULL DEFAULT 'active',
    version integer NOT NULL DEFAULT 1,
    memory_id uuid REFERENCES memory(id) ON DELETE SET NULL,
    query_kind text NOT NULL,
    query_payload jsonb NOT NULL DEFAULT '{}'::jsonb,
    decision_payload jsonb NOT NULL DEFAULT '{}'::jsonb,
    object_type text NOT NULL DEFAULT 'memory',
    object_ref text,
    trace_id text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_memory_access_log_scope_status ON memory_access_log (tenant_id, scope, status);
CREATE INDEX idx_memory_access_log_query_time ON memory_access_log (query_kind, created_at DESC);
CREATE INDEX idx_memory_access_log_memory_time ON memory_access_log (memory_id, created_at DESC);

COMMIT;

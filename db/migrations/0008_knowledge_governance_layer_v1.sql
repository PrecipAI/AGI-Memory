BEGIN;

CREATE TABLE IF NOT EXISTS kp_governance_decision (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id text NOT NULL,
    scope text NOT NULL,
    status record_status NOT NULL DEFAULT 'active',
    version integer NOT NULL DEFAULT 1,
    governance_job_id uuid NOT NULL REFERENCES kp_governance_job(id) ON DELETE CASCADE,
    governance_type text NOT NULL,
    target_object_type text NOT NULL,
    target_object_id uuid,
    decision text NOT NULL,
    confidence_score numeric(5,4) NOT NULL DEFAULT 0.7500,
    risk_level risk_level NOT NULL DEFAULT 'low',
    evidence_refs jsonb NOT NULL DEFAULT '[]'::jsonb,
    reason text NOT NULL,
    before_state jsonb NOT NULL DEFAULT '{}'::jsonb,
    after_state jsonb NOT NULL DEFAULT '{}'::jsonb,
    model_name text NOT NULL DEFAULT 'rules-v1',
    prompt_version text NOT NULL DEFAULT 'n/a',
    ruleset_version text NOT NULL DEFAULT 'governance-rules-v1',
    trace_id text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_kp_governance_decision_job
    ON kp_governance_decision (governance_job_id, governance_type, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_kp_governance_decision_target
    ON kp_governance_decision (tenant_id, scope, target_object_type, target_object_id);

CREATE TABLE IF NOT EXISTS kp_governance_cleaning_log (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id text NOT NULL,
    scope text NOT NULL,
    status record_status NOT NULL DEFAULT 'active',
    version integer NOT NULL DEFAULT 1,
    governance_job_id uuid NOT NULL REFERENCES kp_governance_job(id) ON DELETE CASCADE,
    document_id uuid NOT NULL REFERENCES kp_document(id) ON DELETE CASCADE,
    cleaning_type text NOT NULL,
    before_hash text,
    after_hash text,
    removed_sections_summary jsonb NOT NULL DEFAULT '[]'::jsonb,
    removed_line_count integer NOT NULL DEFAULT 0,
    kept_line_count integer NOT NULL DEFAULT 0,
    trace_id text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_kp_governance_cleaning_log_doc
    ON kp_governance_cleaning_log (tenant_id, scope, document_id, created_at DESC);

CREATE TABLE IF NOT EXISTS kp_synthesized_knowledge (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id text NOT NULL,
    scope text NOT NULL,
    status record_status NOT NULL DEFAULT 'active',
    version integer NOT NULL DEFAULT 1,
    memory_domain text NOT NULL DEFAULT 'knowledge',
    lifecycle_state text NOT NULL DEFAULT 'curated',
    review_state text NOT NULL DEFAULT 'model_accepted',
    recall_state text NOT NULL DEFAULT 'active',
    knowledge_type text NOT NULL,
    title text NOT NULL,
    content text NOT NULL,
    normalized_content text NOT NULL,
    source_object_ids jsonb NOT NULL DEFAULT '[]'::jsonb,
    evidence_ids jsonb NOT NULL DEFAULT '[]'::jsonb,
    reasoning_summary text NOT NULL,
    confidence_score numeric(5,4) NOT NULL DEFAULT 0.7500,
    risk_level risk_level NOT NULL DEFAULT 'low',
    governance_job_id uuid REFERENCES kp_governance_job(id) ON DELETE SET NULL,
    metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
    trace_id text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (tenant_id, scope, knowledge_type, normalized_content)
);
CREATE INDEX IF NOT EXISTS idx_kp_synthesized_knowledge_scope_type
    ON kp_synthesized_knowledge (tenant_id, scope, knowledge_type, lifecycle_state, recall_state);
CREATE INDEX IF NOT EXISTS idx_kp_synthesized_knowledge_content_fts
    ON kp_synthesized_knowledge USING GIN (to_tsvector('simple', normalized_content));

CREATE TABLE IF NOT EXISTS kp_synthesized_knowledge_evidence (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id text NOT NULL,
    scope text NOT NULL,
    status record_status NOT NULL DEFAULT 'active',
    synthesized_knowledge_id uuid NOT NULL REFERENCES kp_synthesized_knowledge(id) ON DELETE CASCADE,
    evidence_id uuid NOT NULL REFERENCES kp_evidence(id) ON DELETE CASCADE,
    source_object_type text NOT NULL,
    source_object_id uuid NOT NULL,
    support_role text NOT NULL DEFAULT 'supports',
    trace_id text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (synthesized_knowledge_id, evidence_id, source_object_type, source_object_id)
);
CREATE INDEX IF NOT EXISTS idx_kp_synthesized_knowledge_evidence_synth
    ON kp_synthesized_knowledge_evidence (synthesized_knowledge_id);

CREATE TABLE IF NOT EXISTS kp_object_revision (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id text NOT NULL,
    scope text NOT NULL,
    status record_status NOT NULL DEFAULT 'active',
    version integer NOT NULL DEFAULT 1,
    governance_job_id uuid REFERENCES kp_governance_job(id) ON DELETE SET NULL,
    object_type text NOT NULL,
    object_id uuid NOT NULL,
    revision_type text NOT NULL,
    before_state jsonb NOT NULL DEFAULT '{}'::jsonb,
    after_state jsonb NOT NULL DEFAULT '{}'::jsonb,
    reason text NOT NULL,
    trace_id text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_kp_object_revision_object
    ON kp_object_revision (tenant_id, scope, object_type, object_id, created_at DESC);

CREATE TABLE IF NOT EXISTS kp_recall_surface_state (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id text NOT NULL,
    scope text NOT NULL,
    status record_status NOT NULL DEFAULT 'active',
    version integer NOT NULL DEFAULT 1,
    object_type text NOT NULL,
    object_id uuid NOT NULL,
    recall_state text NOT NULL,
    context_assembly_state text NOT NULL,
    governance_job_id uuid REFERENCES kp_governance_job(id) ON DELETE SET NULL,
    reason text NOT NULL,
    metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
    trace_id text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (tenant_id, scope, object_type, object_id)
);
CREATE INDEX IF NOT EXISTS idx_kp_recall_surface_state_scope
    ON kp_recall_surface_state (tenant_id, scope, recall_state, context_assembly_state);

COMMIT;

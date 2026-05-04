BEGIN;

CREATE TABLE IF NOT EXISTS kp_document (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id text NOT NULL,
    scope text NOT NULL,
    status record_status NOT NULL DEFAULT 'active',
    version integer NOT NULL DEFAULT 1,
    memory_domain text NOT NULL,
    object_type text NOT NULL DEFAULT 'document',
    lifecycle_state text NOT NULL DEFAULT 'inbox',
    review_state text NOT NULL DEFAULT 'unreviewed',
    title text NOT NULL,
    source_type text NOT NULL,
    source_uri text NOT NULL,
    source_hash text,
    author text,
    language text,
    captured_at timestamptz,
    published_at timestamptz,
    valid_from timestamptz,
    valid_to timestamptz,
    metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
    trace_id text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (tenant_id, scope, source_uri, source_hash)
);
CREATE INDEX IF NOT EXISTS idx_kp_document_scope_state ON kp_document (tenant_id, scope, lifecycle_state);
CREATE INDEX IF NOT EXISTS idx_kp_document_scope_domain ON kp_document (tenant_id, scope, memory_domain);

CREATE TABLE IF NOT EXISTS kp_section (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    document_id uuid NOT NULL REFERENCES kp_document(id) ON DELETE CASCADE,
    tenant_id text NOT NULL,
    scope text NOT NULL,
    status record_status NOT NULL DEFAULT 'active',
    version integer NOT NULL DEFAULT 1,
    memory_domain text NOT NULL,
    object_type text NOT NULL DEFAULT 'section',
    lifecycle_state text NOT NULL DEFAULT 'inbox',
    review_state text NOT NULL DEFAULT 'unreviewed',
    heading_path text[] NOT NULL DEFAULT ARRAY[]::text[],
    section_key text NOT NULL,
    ordinal integer NOT NULL DEFAULT 0,
    title text,
    summary text,
    content text NOT NULL,
    content_hash text,
    token_count integer,
    metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
    trace_id text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (document_id, section_key)
);
CREATE INDEX IF NOT EXISTS idx_kp_section_scope_state ON kp_section (tenant_id, scope, lifecycle_state);
CREATE INDEX IF NOT EXISTS idx_kp_section_document_ordinal ON kp_section (document_id, ordinal);
CREATE INDEX IF NOT EXISTS idx_kp_section_content_fts ON kp_section USING GIN (to_tsvector('simple', content));

CREATE TABLE IF NOT EXISTS kp_evidence (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id text NOT NULL,
    scope text NOT NULL,
    status record_status NOT NULL DEFAULT 'active',
    version integer NOT NULL DEFAULT 1,
    memory_domain text NOT NULL,
    object_type text NOT NULL DEFAULT 'evidence',
    lifecycle_state text NOT NULL DEFAULT 'inbox',
    review_state text NOT NULL DEFAULT 'unreviewed',
    evidence_type text NOT NULL,
    source_type text NOT NULL,
    source_uri text NOT NULL,
    raw_ref text,
    content_excerpt text,
    content_hash text,
    trust_level text NOT NULL DEFAULT 'internal_verified',
    captured_at timestamptz,
    metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
    trace_id text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (tenant_id, scope, source_uri, raw_ref, content_hash)
);
CREATE INDEX IF NOT EXISTS idx_kp_evidence_scope_type ON kp_evidence (tenant_id, scope, evidence_type);
CREATE INDEX IF NOT EXISTS idx_kp_evidence_scope_state ON kp_evidence (tenant_id, scope, lifecycle_state);

CREATE TABLE IF NOT EXISTS kp_entity (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id text NOT NULL,
    scope text NOT NULL,
    status record_status NOT NULL DEFAULT 'active',
    version integer NOT NULL DEFAULT 1,
    memory_domain text NOT NULL,
    object_type text NOT NULL DEFAULT 'entity',
    lifecycle_state text NOT NULL DEFAULT 'inbox',
    review_state text NOT NULL DEFAULT 'unreviewed',
    entity_type text NOT NULL,
    canonical_name text NOT NULL,
    aliases text[] NOT NULL DEFAULT ARRAY[]::text[],
    slug text NOT NULL,
    summary text,
    valid_from timestamptz,
    valid_to timestamptz,
    last_verified_at timestamptz,
    review_at timestamptz,
    staleness_score numeric(5,4),
    metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
    trace_id text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (tenant_id, scope, entity_type, slug)
);
CREATE INDEX IF NOT EXISTS idx_kp_entity_scope_name ON kp_entity (tenant_id, scope, canonical_name);
CREATE INDEX IF NOT EXISTS idx_kp_entity_scope_state ON kp_entity (tenant_id, scope, lifecycle_state);
CREATE INDEX IF NOT EXISTS idx_kp_entity_aliases_gin ON kp_entity USING GIN (aliases);

CREATE TABLE IF NOT EXISTS kp_fact (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id text NOT NULL,
    scope text NOT NULL,
    status record_status NOT NULL DEFAULT 'active',
    version integer NOT NULL DEFAULT 1,
    memory_domain text NOT NULL,
    object_type text NOT NULL DEFAULT 'fact',
    lifecycle_state text NOT NULL DEFAULT 'candidate',
    review_state text NOT NULL DEFAULT 'unreviewed',
    fact_kind text NOT NULL,
    fact_subtype text,
    subject_entity_id uuid REFERENCES kp_entity(id) ON DELETE SET NULL,
    title text NOT NULL,
    statement text NOT NULL,
    normalized_statement text NOT NULL,
    confidence_score numeric(5,4) NOT NULL DEFAULT 0.7500,
    importance integer NOT NULL DEFAULT 50,
    verification_status text NOT NULL DEFAULT 'verified',
    valid_from timestamptz,
    valid_to timestamptz,
    last_verified_at timestamptz,
    review_at timestamptz,
    staleness_score numeric(5,4),
    supersedes_fact_id uuid REFERENCES kp_fact(id) ON DELETE SET NULL,
    metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
    trace_id text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_kp_fact_scope_kind ON kp_fact (tenant_id, scope, memory_domain, fact_kind);
CREATE INDEX IF NOT EXISTS idx_kp_fact_scope_state ON kp_fact (tenant_id, scope, lifecycle_state, review_state);
CREATE INDEX IF NOT EXISTS idx_kp_fact_subject_entity ON kp_fact (subject_entity_id);
CREATE INDEX IF NOT EXISTS idx_kp_fact_statement_fts ON kp_fact USING GIN (to_tsvector('simple', normalized_statement));

CREATE TABLE IF NOT EXISTS kp_relation (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id text NOT NULL,
    scope text NOT NULL,
    status record_status NOT NULL DEFAULT 'active',
    version integer NOT NULL DEFAULT 1,
    memory_domain text NOT NULL,
    object_type text NOT NULL DEFAULT 'relation',
    lifecycle_state text NOT NULL DEFAULT 'candidate',
    review_state text NOT NULL DEFAULT 'unreviewed',
    relation_type text NOT NULL,
    from_object_type text NOT NULL,
    from_object_id uuid NOT NULL,
    to_object_type text NOT NULL,
    to_object_id uuid NOT NULL,
    statement text,
    confidence_score numeric(5,4) NOT NULL DEFAULT 0.7500,
    valid_from timestamptz,
    valid_to timestamptz,
    last_verified_at timestamptz,
    review_at timestamptz,
    staleness_score numeric(5,4),
    metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
    trace_id text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (tenant_id, scope, relation_type, from_object_type, from_object_id, to_object_type, to_object_id)
);
CREATE INDEX IF NOT EXISTS idx_kp_relation_scope_type ON kp_relation (tenant_id, scope, relation_type);
CREATE INDEX IF NOT EXISTS idx_kp_relation_from_object ON kp_relation (from_object_id);
CREATE INDEX IF NOT EXISTS idx_kp_relation_to_object ON kp_relation (to_object_id);
CREATE INDEX IF NOT EXISTS idx_kp_relation_scope_state ON kp_relation (tenant_id, scope, lifecycle_state, review_state);

CREATE TABLE IF NOT EXISTS kp_candidate_link (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id text NOT NULL,
    scope text NOT NULL,
    status record_status NOT NULL DEFAULT 'active',
    version integer NOT NULL DEFAULT 1,
    candidate_id uuid NOT NULL REFERENCES memory_candidate(id) ON DELETE CASCADE,
    target_object_type text NOT NULL,
    target_object_id uuid NOT NULL,
    link_role text NOT NULL,
    metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
    trace_id text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (candidate_id, target_object_type, target_object_id, link_role)
);
CREATE INDEX IF NOT EXISTS idx_kp_candidate_link_candidate ON kp_candidate_link (candidate_id);
CREATE INDEX IF NOT EXISTS idx_kp_candidate_link_target ON kp_candidate_link (target_object_type, target_object_id);

CREATE TABLE IF NOT EXISTS kp_review_queue (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id text NOT NULL,
    scope text NOT NULL,
    status record_status NOT NULL DEFAULT 'active',
    version integer NOT NULL DEFAULT 1,
    target_object_type text NOT NULL,
    target_object_id uuid NOT NULL,
    review_reason text NOT NULL,
    priority integer NOT NULL DEFAULT 50,
    assigned_to text,
    payload jsonb NOT NULL DEFAULT '{}'::jsonb,
    resolution_action text,
    resolution_payload jsonb,
    resolved_at timestamptz,
    trace_id text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_kp_review_queue_scope_status ON kp_review_queue (tenant_id, scope, status, priority);
CREATE INDEX IF NOT EXISTS idx_kp_review_queue_target ON kp_review_queue (target_object_type, target_object_id);

CREATE TABLE IF NOT EXISTS kp_context_bundle (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id text NOT NULL,
    scope text NOT NULL,
    status record_status NOT NULL DEFAULT 'active',
    version integer NOT NULL DEFAULT 1,
    request_ref text NOT NULL,
    bundle_type text NOT NULL,
    summary text,
    facts jsonb NOT NULL DEFAULT '[]'::jsonb,
    entities jsonb NOT NULL DEFAULT '[]'::jsonb,
    relations jsonb NOT NULL DEFAULT '[]'::jsonb,
    evidence_refs jsonb NOT NULL DEFAULT '[]'::jsonb,
    section_refs jsonb NOT NULL DEFAULT '[]'::jsonb,
    warnings jsonb NOT NULL DEFAULT '[]'::jsonb,
    assembly_trace jsonb NOT NULL DEFAULT '{}'::jsonb,
    trace_id text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_kp_context_bundle_scope_request ON kp_context_bundle (tenant_id, scope, request_ref, created_at DESC);

CREATE TABLE IF NOT EXISTS kp_governance_job (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id text NOT NULL,
    scope text NOT NULL,
    status record_status NOT NULL DEFAULT 'recorded',
    version integer NOT NULL DEFAULT 1,
    job_type text NOT NULL,
    trigger_type text NOT NULL,
    trigger_ref text,
    target_object_type text,
    target_object_ids jsonb NOT NULL DEFAULT '[]'::jsonb,
    priority integer NOT NULL DEFAULT 50,
    run_status text NOT NULL DEFAULT 'pending',
    requested_by text,
    payload jsonb NOT NULL DEFAULT '{}'::jsonb,
    result_payload jsonb NOT NULL DEFAULT '{}'::jsonb,
    trace_id text NOT NULL,
    started_at timestamptz,
    finished_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_kp_governance_job_scope_status ON kp_governance_job (tenant_id, scope, run_status, priority, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_kp_governance_job_type ON kp_governance_job (job_type, trigger_type, created_at DESC);

COMMIT;

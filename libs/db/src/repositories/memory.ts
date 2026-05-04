import { getPool } from "../pool.js";

function toJson(value: unknown): string {
  return JSON.stringify(value ?? {});
}

type PersistTarget = "memory" | "rule" | "skill" | "resident_candidate" | "summary_only" | "drop" | "block";

function extractMemorySearchTerms(input?: string | null): string[] {
  const normalized = input?.trim().toLowerCase();
  if (!normalized) {
    return [];
  }
  const stopwords = new Set(["the", "and", "how", "should", "would", "could", "what", "why", "when", "where", "this", "that"]);
  const terms = new Set<string>();
  for (const token of normalized.split(/\s+/)) {
    const trimmed = token.replace(/[^\p{L}\p{N}_-]+/gu, "").trim();
    if (trimmed.length >= 2 && !stopwords.has(trimmed)) {
      terms.add(trimmed);
    }
  }
  return [...terms].slice(0, 10);
}

async function queryMemoryRows(input: {
  tenantId: string;
  scope: string;
  type: "factual";
  query?: string | null;
  limit?: number;
}): Promise<Record<string, unknown>[]> {
  const pool = getPool();
  const terms = extractMemorySearchTerms(input.query);
  const result = await pool.query(
    `
    SELECT *,
      CASE
        WHEN $4::text[] IS NULL THEN 0
        ELSE (
          SELECT COUNT(*)
          FROM unnest($4::text[]) AS term
          WHERE title ILIKE '%' || term || '%'
             OR content ILIKE '%' || term || '%'
             OR array_to_string(array_remove(tags, 'memory-v3'), ' ') ILIKE '%' || term || '%'
        )
      END AS memory_match_count
    FROM memory
    WHERE tenant_id = $1
      AND scope = $2
      AND status = 'active'
      AND memory_type = $3
      AND (
        $4::text[] IS NULL
        OR (
          SELECT COUNT(*)
          FROM unnest($4::text[]) AS term
          WHERE title ILIKE '%' || term || '%'
             OR content ILIKE '%' || term || '%'
             OR array_to_string(array_remove(tags, 'memory-v3'), ' ') ILIKE '%' || term || '%'
        ) > 0
      )
    ORDER BY memory_match_count DESC, importance DESC, confidence_score DESC, created_at DESC
    LIMIT $5
    `,
    [input.tenantId, input.scope, input.type, terms.length > 0 ? terms : null, input.limit ?? 10]
  );
  return result.rows;
}

export async function queryResidentSnapshot(input: {
  tenantId: string;
  scope: string;
  limit?: number;
}): Promise<Record<string, unknown>[]> {
  const pool = getPool();
  const result = await pool.query(
    `
    SELECT *
    FROM resident_snapshot
    WHERE tenant_id = $1
      AND scope = $2
      AND status = 'active'
    ORDER BY generated_at DESC, created_at DESC
    LIMIT $3
    `,
    [input.tenantId, input.scope, input.limit ?? 5]
  );
  return result.rows;
}

export async function queryConversationSummary(input: {
  tenantId: string;
  scope: string;
  taskRequestId?: string | null;
  limit?: number;
}): Promise<Record<string, unknown>[]> {
  const pool = getPool();
  const result = await pool.query(
    `
    SELECT *
    FROM conversation_summary
    WHERE tenant_id = $1
      AND scope = $2
      AND status = 'active'
      AND ($3::uuid IS NULL OR task_request_id = $3)
    ORDER BY created_at DESC
    LIMIT $4
    `,
    [input.tenantId, input.scope, input.taskRequestId ?? null, input.limit ?? 10]
  );
  return result.rows;
}

export async function queryMemoryCandidates(input: {
  tenantId: string;
  scope: string;
  taskRequestId?: string | null;
  limit?: number;
}): Promise<Record<string, unknown>[]> {
  const pool = getPool();
  const result = await pool.query(
    `
    SELECT *
    FROM memory_candidate
    WHERE tenant_id = $1
      AND scope = $2
      AND ($3::uuid IS NULL OR task_request_id = $3)
    ORDER BY created_at DESC
    LIMIT $4
    `,
    [input.tenantId, input.scope, input.taskRequestId ?? null, input.limit ?? 10]
  );
  return result.rows;
}

export async function queryFactualMemory(input: {
  tenantId: string;
  scope: string;
  query?: string | null;
  limit?: number;
}): Promise<Record<string, unknown>[]> {
  return queryMemoryRows({ tenantId: input.tenantId, scope: input.scope, type: "factual", query: input.query, limit: input.limit });
}

export async function queryProceduralMemory(input: {
  tenantId: string;
  scope: string;
  fingerprint?: string | null;
  limit?: number;
}): Promise<Record<string, unknown>[]> {
  const pool = getPool();
  const result = await pool.query(
    `
    SELECT *
    FROM skill
    WHERE tenant_id = $1
      AND scope = $2
      AND status = 'active'
      AND (
        fingerprint_requirement IS NULL
        OR fingerprint_requirement = $3
      )
    ORDER BY success_rate DESC NULLS LAST, created_at DESC
    LIMIT $4
    `,
    [input.tenantId, input.scope, input.fingerprint ?? null, input.limit ?? 10]
  );
  return result.rows;
}

export async function queryActiveRules(input: {
  tenantId: string;
  scope: string;
  query?: string | null;
  taskType?: string | null;
  limit?: number;
}): Promise<Record<string, unknown>[]> {
  const pool = getPool();
  const terms = extractMemorySearchTerms(input.query);
  const taskTypeAliases: Record<string, string[]> = {
    design: ["design", "planner"],
    execution: ["execution", "executor"],
    debugging: ["debugging", "executor"],
    governance: ["governance"],
    review: ["review", "verification"],
    ingestion: ["ingestion"],
    integration: ["integration"],
    answer: ["answer", "router"]
  };
  const taskTypes =
    input.taskType && input.taskType.length > 0
      ? Array.from(new Set([input.taskType, ...(taskTypeAliases[input.taskType] ?? [])]))
      : null;
  const result = await pool.query(
    `
    SELECT *,
      CASE
        WHEN $3::text[] IS NULL THEN 0
        ELSE (
          SELECT COUNT(*)
          FROM unnest($3::text[]) AS term
          WHERE title ILIKE '%' || term || '%'
             OR statement ILIKE '%' || term || '%'
             OR normalized_statement ILIKE '%' || term || '%'
             OR rule_type ILIKE '%' || term || '%'
        )
      END AS rule_match_count
    FROM rule
    WHERE tenant_id = $1
      AND scope = $2
      AND status = 'active'
      AND (
        $5::text[] IS NULL
        OR applies_to = '[]'::jsonb
        OR applies_to ?| $5::text[]
        OR trigger_conditions -> 'task_types' ?| $5::text[]
      )
    ORDER BY rule_match_count DESC, priority DESC, created_at DESC
    LIMIT $4
    `,
    [input.tenantId, input.scope, terms.length > 0 ? terms : null, input.limit ?? 10, taskTypes]
  );
  return result.rows;
}

export async function queryActiveTaskBindings(input: {
  tenantId: string;
  scope: string;
  taskType?: string | null;
  host?: string | null;
  projectRef?: string | null;
  limit?: number;
}): Promise<Record<string, unknown>[]> {
  const pool = getPool();
  const result = await pool.query(
    `
    SELECT tb.*,
      ep.pack_key,
      ep.title AS pack_title
    FROM task_binding tb
    LEFT JOIN extension_pack ep ON ep.id = tb.extension_pack_id
    WHERE tb.tenant_id = $1
      AND tb.scope = $2
      AND tb.status = 'active'
      AND (
        cardinality(tb.task_types) = 0
        OR $3::text IS NULL
        OR tb.task_types @> ARRAY[$3]::text[]
      )
      AND (
        cardinality(tb.hosts) = 0
        OR $4::text IS NULL
        OR tb.hosts @> ARRAY[$4]::text[]
      )
      AND (
        cardinality(tb.projects) = 0
        OR $5::text IS NULL
        OR tb.projects @> ARRAY[$5]::text[]
      )
    ORDER BY tb.priority DESC, tb.created_at DESC
    LIMIT $6
    `,
    [input.tenantId, input.scope, input.taskType ?? null, input.host ?? null, input.projectRef ?? null, input.limit ?? 10]
  );
  return result.rows;
}

export async function queryRuleCheckpoints(input: {
  tenantId: string;
  scope: string;
  ruleIds: string[];
  operation?: string | null;
}): Promise<Record<string, unknown>[]> {
  if (input.ruleIds.length === 0) {
    return [];
  }
  const pool = getPool();
  const result = await pool.query(
    `
    SELECT *
    FROM rule_checkpoint
    WHERE tenant_id = $1
      AND scope = $2
      AND status = 'active'
      AND rule_id = ANY($3::uuid[])
      AND (
        $4::text IS NULL
        OR operation IS NULL
        OR operation = $4
      )
    ORDER BY priority DESC, checkpoint_phase ASC, created_at DESC
    `,
    [input.tenantId, input.scope, input.ruleIds, input.operation ?? null]
  );
  return result.rows;
}

export async function queryRuleGateCheckpoints(input: {
  tenantId: string;
  scope: string;
  taskType?: string | null;
  host?: string | null;
  projectRef?: string | null;
  operation: string;
  checkpointKeys?: string[] | null;
  limit?: number;
}): Promise<Record<string, unknown>[]> {
  const pool = getPool();
  const result = await pool.query(
    `
    WITH matching_bindings AS (
      SELECT DISTINCT unnest(rule_keys) AS rule_key
      FROM task_binding
      WHERE tenant_id = $1
        AND scope = $2
        AND status = 'active'
        AND (
          cardinality(task_types) = 0
          OR $3::text IS NULL
          OR task_types @> ARRAY[$3]::text[]
        )
        AND (
          cardinality(hosts) = 0
          OR $4::text IS NULL
          OR hosts @> ARRAY[$4]::text[]
        )
        AND (
          cardinality(projects) = 0
          OR $5::text IS NULL
          OR projects @> ARRAY[$5]::text[]
        )
    )
    SELECT
      rc.*,
      r.rule_key,
      r.title AS rule_title,
      r.statement AS rule_statement,
      r.enforcement_level,
      r.risk_level,
      r.priority AS rule_priority
    FROM rule_checkpoint rc
    JOIN rule r ON r.id = rc.rule_id
    WHERE rc.tenant_id = $1
      AND rc.scope = $2
      AND rc.status = 'active'
      AND r.status = 'active'
      AND (rc.operation IS NULL OR rc.operation = $6)
      AND ($7::text[] IS NULL OR rc.checkpoint_key = ANY($7::text[]))
      AND (
        EXISTS (SELECT 1 FROM matching_bindings WHERE rule_key = r.rule_key)
        OR (
          $3::text IS NULL
          AND $4::text IS NULL
          AND $5::text IS NULL
          AND NOT EXISTS (
          SELECT 1
          FROM task_binding
          WHERE tenant_id = $1
            AND scope = $2
            AND status = 'active'
          )
        )
      )
    ORDER BY rc.priority DESC, r.priority DESC, rc.created_at DESC
    LIMIT $8
    `,
    [
      input.tenantId,
      input.scope,
      input.taskType ?? null,
      input.host ?? null,
      input.projectRef ?? null,
      input.operation,
      input.checkpointKeys && input.checkpointKeys.length > 0 ? input.checkpointKeys : null,
      input.limit ?? 50
    ]
  );
  return result.rows;
}

export async function createRuleGateAudit(input: {
  tenantId: string;
  scope: string;
  taskRequestId: string;
  taskStepId?: string | null;
  ruleId?: string | null;
  checkpointId?: string | null;
  gateKey: string;
  operation: string;
  decision: string;
  evidence: Record<string, unknown>;
  reason?: string | null;
  actorRef?: string | null;
  traceId: string;
}): Promise<string> {
  const pool = getPool();
  const result = await pool.query<{ id: string }>(
    `
    INSERT INTO rule_gate_audit (
      tenant_id, scope, task_request_id, task_step_id, rule_id, checkpoint_id,
      gate_key, operation, decision, evidence, reason, actor_ref, trace_id
    )
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb, $11, $12, $13)
    RETURNING id
    `,
    [
      input.tenantId,
      input.scope,
      input.taskRequestId,
      input.taskStepId ?? null,
      input.ruleId ?? null,
      input.checkpointId ?? null,
      input.gateKey,
      input.operation,
      input.decision,
      toJson(input.evidence),
      input.reason ?? null,
      input.actorRef ?? null,
      input.traceId
    ]
  );
  return result.rows[0].id;
}

export async function ensureTaskRequestForExternalGate(input: {
  tenantId: string;
  scope: string;
  taskRequestId: string;
  taskType?: string | null;
  host?: string | null;
  projectRef?: string | null;
  operation: string;
  actorRef?: string | null;
  traceId: string;
}): Promise<void> {
  const pool = getPool();
  await pool.query(
    `
    INSERT INTO task_request (
      id, tenant_id, scope, status, request_channel, requester_id,
      task_type, goal, input_payload, normalized_envelope, idempotency_key, trace_id
    )
    VALUES (
      $1, $2, $3, 'running', 'mcp', $4,
      $5, $6, $7::jsonb, $8::jsonb, $9, $10
    )
    ON CONFLICT (id) DO NOTHING
    `,
    [
      input.taskRequestId,
      input.tenantId,
      input.scope,
      input.actorRef ?? input.host ?? "external-mcp-client",
      input.taskType ?? "integration",
      `External MCP rule gate check: ${input.operation}`,
      toJson({
        host: input.host ?? null,
        project_ref: input.projectRef ?? null,
        operation: input.operation
      }),
      toJson({
        source: "memory-mcp",
        operation: input.operation
      }),
      `external-rule-gate:${input.taskRequestId}`,
      input.traceId
    ]
  );
}

export async function queryMemoryLayerVersions(input: {
  tenantId: string;
  scope: string;
}): Promise<Record<string, unknown>> {
  const pool = getPool();
  const result = await pool.query(
    `
    SELECT
      (
        SELECT jsonb_build_object(
          'count', COUNT(*)::int,
          'max_version', COALESCE(MAX(version), 0),
          'updated_at', MAX(updated_at)
        )
        FROM memory
        WHERE tenant_id = $1 AND scope = $2 AND status = 'active'
      ) AS memory,
      (
        SELECT jsonb_build_object(
          'count', COUNT(*)::int,
          'max_version', COALESCE(MAX(version), 0),
          'updated_at', MAX(updated_at)
        )
        FROM rule
        WHERE tenant_id = $1 AND scope = $2 AND status = 'active'
      ) AS rule,
      (
        SELECT jsonb_build_object(
          'count', COUNT(*)::int,
          'max_version', COALESCE(MAX(version), 0),
          'updated_at', MAX(updated_at)
        )
        FROM skill
        WHERE tenant_id = $1 AND scope = $2 AND status = 'active'
      ) AS skill,
      (
        SELECT jsonb_build_object(
          'count', COUNT(*)::int,
          'max_version', COALESCE(MAX(version), 0),
          'updated_at', MAX(updated_at)
        )
        FROM resident_snapshot
        WHERE tenant_id = $1 AND scope = $2 AND status = 'active'
      ) AS resident,
      (
        SELECT jsonb_build_object(
          'count', COUNT(*)::int,
          'max_version', COALESCE(MAX(version), 0),
          'updated_at', MAX(updated_at)
        )
        FROM task_binding
        WHERE tenant_id = $1 AND scope = $2 AND status = 'active'
      ) AS task_binding,
      (
        SELECT jsonb_build_object(
          'count', COUNT(*)::int,
          'max_version', COALESCE(MAX(version), 0),
          'updated_at', MAX(updated_at)
        )
        FROM rule_checkpoint
        WHERE tenant_id = $1 AND scope = $2 AND status = 'active'
      ) AS rule_checkpoint,
      (
        SELECT jsonb_build_object(
          'count', COUNT(*)::int,
          'max_version', COALESCE(MAX(version), 0),
          'updated_at', MAX(updated_at)
        )
        FROM extension_pack
        WHERE tenant_id = $1 AND scope = $2 AND status = 'active'
      ) AS extension_pack
    `,
    [input.tenantId, input.scope]
  );
  return result.rows[0] ?? {};
}

export async function createConversationSummary(input: {
  tenantId: string;
  scope: string;
  taskRequestId: string;
  summaryKey: string;
  summaryType: string;
  sourceRangeStart?: number | null;
  sourceRangeEnd?: number | null;
  summaryPayload: Record<string, unknown>;
  supersedesId?: string | null;
  rebuildStatus?: string | null;
  traceId: string;
}): Promise<string> {
  const pool = getPool();
  const existing = await pool.query<{ id: string; version: number }>(
    `
    SELECT id, version
    FROM conversation_summary
    WHERE tenant_id = $1
      AND scope = $2
      AND summary_key = $3
      AND status = 'active'
    ORDER BY version DESC
    LIMIT 1
    `,
    [input.tenantId, input.scope, input.summaryKey]
  );

  if (existing.rowCount && existing.rows[0]) {
    await pool.query("UPDATE conversation_summary SET status = 'superseded', updated_at = now() WHERE id = $1", [existing.rows[0].id]);
  }

  const nextVersion = existing.rows[0] ? existing.rows[0].version + 1 : 1;
  const result = await pool.query<{ id: string }>(
    `
    INSERT INTO conversation_summary (
      tenant_id, scope, status, version, task_request_id, summary_key, summary_type,
      source_range_start, source_range_end, summary_payload, supersedes_id, rebuild_status, trace_id
    )
    VALUES (
      $1, $2, 'active', $3, $4, $5, $6,
      $7, $8, $9::jsonb, $10, $11, $12
    )
    RETURNING id
    `,
    [
      input.tenantId,
      input.scope,
      nextVersion,
      input.taskRequestId,
      input.summaryKey,
      input.summaryType,
      input.sourceRangeStart ?? null,
      input.sourceRangeEnd ?? null,
      toJson(input.summaryPayload),
      input.supersedesId ?? existing.rows[0]?.id ?? null,
      input.rebuildStatus ?? "built",
      input.traceId
    ]
  );
  return result.rows[0].id;
}

export async function createMemoryCandidate(input: {
  tenantId: string;
  scope: string;
  taskRequestId: string;
  taskStepId: string;
  sourceType: string;
  sourceRef: string;
  artifactTag: string;
  errorCode?: string | null;
  verificationStatus: string;
  sideEffectClass: string;
  fingerprint?: string | null;
  fingerprintStatus: string;
  routingDecision?: string | null;
  rankScore?: number | null;
  candidatePayload: Record<string, unknown>;
  llmRefinedPayload?: Record<string, unknown> | null;
  traceId: string;
}): Promise<{ id: string; existed: boolean }> {
  const pool = getPool();
  const candidateHash = String((input.candidatePayload as Record<string, unknown>).candidate_hash ?? "");
  if (candidateHash) {
    const existing = await pool.query<{ id: string }>(
      `
      SELECT id
      FROM memory_candidate
      WHERE task_request_id = $1
        AND task_step_id = $2
        AND source_ref = $3
        AND candidate_payload ->> 'candidate_hash' = $4
      LIMIT 1
      `,
      [input.taskRequestId, input.taskStepId, input.sourceRef, candidateHash]
    );
    if (existing.rowCount && existing.rows[0]) {
      return { id: existing.rows[0].id, existed: true };
    }
  }

  const result = await pool.query<{ id: string }>(
    `
    INSERT INTO memory_candidate (
      tenant_id, scope, status, version, task_request_id, task_step_id, source_type, source_ref,
      artifact_tag, error_code, verification_status, side_effect_class, fingerprint,
      fingerprint_status, routing_decision, rank_score, candidate_payload, llm_refined_payload, trace_id
    )
    VALUES (
      $1, $2, 'extracted', 1, $3, $4, $5, $6,
      $7, $8, $9, $10::side_effect_class, $11,
      $12::fingerprint_status, $13, $14, $15::jsonb, $16::jsonb, $17
    )
    RETURNING id
    `,
    [
      input.tenantId,
      input.scope,
      input.taskRequestId,
      input.taskStepId,
      input.sourceType,
      input.sourceRef,
      input.artifactTag,
      input.errorCode ?? null,
      input.verificationStatus,
      input.sideEffectClass,
      input.fingerprint ?? null,
      input.fingerprintStatus,
      input.routingDecision ?? null,
      input.rankScore ?? null,
      toJson(input.candidatePayload),
      toJson(input.llmRefinedPayload),
      input.traceId
    ]
  );
  return { id: result.rows[0].id, existed: false };
}

export async function updateMemoryCandidate(input: {
  candidateId: string;
  status: string;
  routingDecision: string;
  rankScore: number;
}): Promise<void> {
  const pool = getPool();
  await pool.query(
    `
    UPDATE memory_candidate
    SET status = $2::memory_candidate_status,
        routing_decision = $3,
        rank_score = $4,
        updated_at = now()
    WHERE id = $1
    `,
    [input.candidateId, input.status, input.routingDecision, input.rankScore]
  );
}

export async function createOrReplaceFactualMemory(input: {
  tenantId: string;
  scope: string;
  title: string;
  content: string;
  normalizedContent?: string | null;
  sourceRef: string;
  verificationStatus: string;
  fingerprintRequirement?: string | null;
  tags?: string[];
  metadata?: Record<string, unknown>;
  importance?: number;
  confidenceScore?: number;
  traceId: string;
}): Promise<string> {
  const pool = getPool();
  const normalizedContent = input.normalizedContent ?? input.content.toLowerCase();
  const existing = await pool.query<{
    id: string;
    version: number;
    title: string;
    normalized_content: string | null;
  }>(
    `
    SELECT id, version, title, normalized_content
    FROM memory
    WHERE tenant_id = $1
      AND scope = $2
      AND status = 'active'
      AND memory_type = 'factual'
      AND (
        lower(title) = lower($3)
        OR normalized_content = $4
      )
    ORDER BY
      CASE WHEN normalized_content = $4 THEN 0 ELSE 1 END,
      version DESC,
      created_at DESC
    LIMIT 1
    `,
    [input.tenantId, input.scope, input.title, normalizedContent]
  );

  if (existing.rowCount && existing.rows[0]) {
    const existingRow = existing.rows[0];
    const proposedAction = existingRow.normalized_content === normalizedContent ? "drop_duplicate_memory" : "replace_memory";
    const reason =
      proposedAction === "drop_duplicate_memory"
        ? "duplicate_factual_memory_requires_human_review"
        : "same_memory_title_update_requires_human_approval";
    const proposal = await pool.query<{ id: string }>(
      `
      INSERT INTO governance_change_proposal (
        tenant_id, scope, status, version, target_object_type, target_object_id,
        proposed_action, proposed_payload, reason, risk_level, source_ref, trace_id
      )
      VALUES (
        $1, $2, 'recorded', 1, 'memory', $3,
        $4, $5::jsonb, $6, 'low', $7, $8
      )
      RETURNING id
      `,
      [
        input.tenantId,
        input.scope,
        existingRow.id,
        proposedAction,
        JSON.stringify({
          title: input.title,
          content: input.content,
          normalized_content: normalizedContent,
          source_kind: "memory_candidate",
          source_ref: input.sourceRef,
          verification_status: input.verificationStatus,
          fingerprint_requirement: input.fingerprintRequirement ?? null,
          tags: input.tags ?? [],
          metadata: input.metadata ?? {},
          importance: input.importance ?? 75,
          confidence_score: input.confidenceScore ?? 0.9,
          next_version: existingRow.version + 1,
          supersedes_memory_id: existingRow.id
        }),
        reason,
        input.sourceRef,
        input.traceId
      ]
    );
    return proposal.rows[0].id;
  }

  const result = await pool.query<{ id: string }>(
    `
    INSERT INTO memory (
      tenant_id, scope, status, version, memory_type, title, content, normalized_content,
      source_kind, source_ref, verification_status, fingerprint_requirement, tags, metadata,
      importance, confidence_score, trace_id
    )
    VALUES (
      $1, $2, 'active', 1, 'factual', $3, $4, $5,
      'memory_candidate', $6, $7, $8, $9::text[], $10::jsonb,
      $11, $12, $13
    )
    RETURNING id
    `,
    [
      input.tenantId,
      input.scope,
      input.title,
      input.content,
      normalizedContent,
      input.sourceRef,
      input.verificationStatus,
      input.fingerprintRequirement ?? null,
      input.tags ?? [],
      toJson(input.metadata),
      input.importance ?? 75,
      input.confidenceScore ?? 0.9,
      input.traceId
    ]
  );
  return result.rows[0].id;
}

export async function createOrReplaceRule(input: {
  tenantId: string;
  scope: string;
  ruleKey: string;
  ruleType: string;
  title: string;
  statement: string;
  normalizedStatement?: string | null;
  appliesTo?: unknown[];
  triggerConditions?: Record<string, unknown>;
  enforcementLevel?: string;
  priority?: number;
  riskLevel?: string;
  verificationStatus: string;
  sourceRefs?: unknown[];
  evidenceRefs?: unknown[];
  metadata?: Record<string, unknown>;
  traceId: string;
}): Promise<string> {
  const pool = getPool();
  const proposedPayload = {
    rule_key: input.ruleKey,
    rule_type: input.ruleType,
    title: input.title,
    statement: input.statement,
    normalized_statement: input.normalizedStatement ?? input.statement.toLowerCase(),
    applies_to: input.appliesTo ?? [],
    trigger_conditions: input.triggerConditions ?? {},
    enforcement_level: input.enforcementLevel ?? "should_follow",
    priority: input.priority ?? 75,
    risk_level: input.riskLevel ?? "medium",
    verification_status: input.verificationStatus,
    source_refs: input.sourceRefs ?? [],
    evidence_refs: input.evidenceRefs ?? [],
    metadata: input.metadata ?? {}
  };
  if (typeof input.metadata?.conflicts_with_rule_key === "string") {
    const proposal = await pool.query<{ id: string }>(
      `
      INSERT INTO governance_change_proposal (
        tenant_id, scope, status, version, target_object_type, target_object_id,
        proposed_action, proposed_payload, reason, risk_level, source_ref, trace_id
      )
      VALUES (
        $1, $2, 'recorded', 1, 'rule', NULL,
        'create_conflicting_rule', $3::jsonb, 'rule_candidate_declares_conflict', $4::risk_level, $5, $6
      )
      RETURNING id
      `,
      [
        input.tenantId,
        input.scope,
        JSON.stringify(proposedPayload),
        input.riskLevel ?? "medium",
        input.sourceRefs?.[0] ? String(input.sourceRefs[0]) : null,
        input.traceId
      ]
    );
    return proposal.rows[0].id;
  }
  const existing = await pool.query<{ id: string; version: number }>(
    `
    SELECT id, version
    FROM rule
    WHERE tenant_id = $1
      AND scope = $2
      AND rule_key = $3
      AND status = 'active'
    ORDER BY version DESC
    LIMIT 1
    `,
    [input.tenantId, input.scope, input.ruleKey]
  );
  const nextVersion = existing.rows[0] ? existing.rows[0].version + 1 : 1;

  if (existing.rowCount && existing.rows[0]) {
    const proposal = await pool.query<{ id: string }>(
      `
      INSERT INTO governance_change_proposal (
        tenant_id, scope, status, version, target_object_type, target_object_id,
        proposed_action, proposed_payload, reason, risk_level, source_ref, trace_id
      )
      VALUES (
        $1, $2, 'recorded', 1, 'rule', $3,
        'replace_rule', $4::jsonb, 'same_rule_key_update_requires_human_approval', $5::risk_level, $6, $7
      )
      RETURNING id
      `,
      [
        input.tenantId,
        input.scope,
        existing.rows[0].id,
        JSON.stringify({
          ...proposedPayload,
          next_version: nextVersion,
          supersedes_rule_id: existing.rows[0].id
        }),
        input.riskLevel ?? "medium",
        input.sourceRefs?.[0] ? String(input.sourceRefs[0]) : null,
        input.traceId
      ]
    );
    return proposal.rows[0].id;
  }

  const result = await pool.query<{ id: string }>(
    `
    INSERT INTO rule (
      tenant_id, scope, status, version, rule_key, rule_type, title, statement,
      normalized_statement, applies_to, trigger_conditions, enforcement_level,
      priority, risk_level, verification_status, source_refs, evidence_refs,
      supersedes_rule_id, metadata, trace_id
    )
    VALUES (
      $1, $2, 'active', $3, $4, $5, $6, $7,
      $8, $9::jsonb, $10::jsonb, $11,
      $12, $13::risk_level, $14, $15::jsonb, $16::jsonb,
      $17, $18::jsonb, $19
    )
    RETURNING id
    `,
    [
      input.tenantId,
      input.scope,
      nextVersion,
      input.ruleKey,
      input.ruleType,
      input.title,
      input.statement,
      input.normalizedStatement ?? input.statement.toLowerCase(),
      JSON.stringify(input.appliesTo ?? []),
      toJson(input.triggerConditions),
      input.enforcementLevel ?? "should_follow",
      input.priority ?? 75,
      input.riskLevel ?? "medium",
      input.verificationStatus,
      JSON.stringify(input.sourceRefs ?? []),
      JSON.stringify(input.evidenceRefs ?? []),
      existing.rows[0]?.id ?? null,
      toJson(input.metadata),
      input.traceId
    ]
  );
  return result.rows[0].id;
}

export async function createOrReplaceSkill(input: {
  tenantId: string;
  scope: string;
  skillKey: string;
  title: string;
  description: string;
  triggerConditions?: Record<string, unknown>;
  procedurePayload: Record<string, unknown>;
  verificationStatus: string;
  fingerprintRequirement?: string | null;
  riskLevel?: string;
  successRate?: number | null;
  tags?: string[];
  traceId: string;
}): Promise<string> {
  const pool = getPool();
  const existing = await pool.query<{ id: string; version: number }>(
    `
    SELECT id, version
    FROM skill
    WHERE tenant_id = $1
      AND scope = $2
      AND skill_key = $3
    ORDER BY version DESC
    LIMIT 1
    `,
    [input.tenantId, input.scope, input.skillKey]
  );
  const nextVersion = existing.rows[0] ? existing.rows[0].version + 1 : 1;

  if (existing.rowCount && existing.rows[0]) {
    const proposal = await pool.query<{ id: string }>(
      `
      INSERT INTO governance_change_proposal (
        tenant_id, scope, status, version, target_object_type, target_object_id,
        proposed_action, proposed_payload, reason, risk_level, source_ref, trace_id
      )
      VALUES (
        $1, $2, 'recorded', 1, 'skill', $3,
        'replace_skill', $4::jsonb, 'same_skill_key_update_requires_human_approval', $5::risk_level, NULL, $6
      )
      RETURNING id
      `,
      [
        input.tenantId,
        input.scope,
        existing.rows[0].id,
        JSON.stringify({
          skill_key: input.skillKey,
          title: input.title,
          description: input.description,
          skill_type: "procedure",
          trigger_conditions: input.triggerConditions ?? {},
          procedure_payload: input.procedurePayload,
          verification_status: input.verificationStatus,
          fingerprint_requirement: input.fingerprintRequirement ?? null,
          risk_level: input.riskLevel ?? "low",
          success_rate: input.successRate ?? null,
          tags: input.tags ?? [],
          next_version: nextVersion,
          supersedes_skill_id: existing.rows[0].id
        }),
        input.riskLevel ?? "low",
        input.traceId
      ]
    );
    return proposal.rows[0].id;
  }

  const result = await pool.query<{ id: string }>(
    `
    INSERT INTO skill (
      tenant_id, scope, status, version, skill_key, title, description, skill_type,
      trigger_conditions, procedure_payload, verification_status, fingerprint_requirement,
      risk_level, success_rate, tags, trace_id
    )
    VALUES (
      $1, $2, 'active', $3, $4, $5, $6, 'procedure',
      $7::jsonb, $8::jsonb, $9, $10,
      $11::risk_level, $12, $13::text[], $14
    )
    RETURNING id
    `,
    [
      input.tenantId,
      input.scope,
      nextVersion,
      input.skillKey,
      input.title,
      input.description,
      toJson(input.triggerConditions),
      toJson(input.procedurePayload),
      input.verificationStatus,
      input.fingerprintRequirement ?? null,
      input.riskLevel ?? "low",
      input.successRate ?? null,
      input.tags ?? [],
      input.traceId
    ]
  );
  return result.rows[0].id;
}

export async function replaceResidentSnapshot(input: {
  tenantId: string;
  scope: string;
  snapshotKey: string;
  snapshotPayload: Record<string, unknown>;
  sourceMemoryIds: string[];
  sourceSkillIds: string[];
  dirtyReason?: string | null;
  traceId: string;
}): Promise<string> {
  const pool = getPool();
  const existing = await pool.query<{ id: string; version: number }>(
    `
    SELECT id, version
    FROM resident_snapshot
    WHERE tenant_id = $1
      AND scope = $2
      AND snapshot_key = $3
      AND status = 'active'
    ORDER BY version DESC
    LIMIT 1
    `,
    [input.tenantId, input.scope, input.snapshotKey]
  );
  if (existing.rowCount && existing.rows[0]) {
    await pool.query("UPDATE resident_snapshot SET status = 'superseded', updated_at = now() WHERE id = $1", [existing.rows[0].id]);
  }
  const nextVersion = existing.rows[0] ? existing.rows[0].version + 1 : 1;
  const result = await pool.query<{ id: string }>(
    `
    INSERT INTO resident_snapshot (
      tenant_id, scope, status, version, snapshot_key, snapshot_payload,
      source_memory_ids, source_skill_ids, dirty_reason, generated_at, trace_id
    )
    VALUES (
      $1, $2, 'active', $3, $4, $5::jsonb,
      $6::uuid[], $7::uuid[], $8, now(), $9
    )
    RETURNING id
    `,
    [
      input.tenantId,
      input.scope,
      nextVersion,
      input.snapshotKey,
      toJson(input.snapshotPayload),
      input.sourceMemoryIds,
      input.sourceSkillIds,
      input.dirtyReason ?? null,
      input.traceId
    ]
  );
  return result.rows[0].id;
}

export async function upsertEnvironmentFingerprint(input: {
  tenantId: string;
  scope: string;
  fingerprintKey: string;
  capabilityVersion?: string | null;
  configHash?: string | null;
  schemaVersion?: string | null;
  dependencySignature?: string | null;
  deploymentBaselineId?: string | null;
  status?: string;
  traceId: string;
}): Promise<string> {
  const pool = getPool();
  const existing = await pool.query<{ id: string }>(
    `
    SELECT id
    FROM environment_fingerprint
    WHERE tenant_id = $1
      AND scope = $2
      AND fingerprint_key = $3
    LIMIT 1
    `,
    [input.tenantId, input.scope, input.fingerprintKey]
  );
  if (existing.rowCount && existing.rows[0]) {
    await pool.query(
      `
      UPDATE environment_fingerprint
      SET status = $2::record_status,
          capability_version = $3,
          config_hash = $4,
          schema_version = $5,
          dependency_signature = $6,
          deployment_baseline_id = $7,
          trace_id = $8,
          updated_at = now()
      WHERE id = $1
      `,
      [
        existing.rows[0].id,
        input.status ?? "active",
        input.capabilityVersion ?? null,
        input.configHash ?? null,
        input.schemaVersion ?? null,
        input.dependencySignature ?? null,
        input.deploymentBaselineId ?? null,
        input.traceId
      ]
    );
    return existing.rows[0].id;
  }

  const result = await pool.query<{ id: string }>(
    `
      INSERT INTO environment_fingerprint (
        tenant_id, scope, status, version, fingerprint_key, capability_version, config_hash,
        schema_version, dependency_signature, deployment_baseline_id, trace_id
      )
      VALUES (
        $1, $2, $3::record_status, 1, $4, $5, $6,
        $7, $8, $9, $10
      )
    RETURNING id
    `,
    [
      input.tenantId,
      input.scope,
      input.status ?? "active",
      input.fingerprintKey,
      input.capabilityVersion ?? null,
      input.configHash ?? null,
      input.schemaVersion ?? null,
      input.dependencySignature ?? null,
      input.deploymentBaselineId ?? null,
      input.traceId
    ]
  );
  return result.rows[0].id;
}

export async function getEnvironmentFingerprint(input: {
  tenantId: string;
  scope: string;
  fingerprintKey: string;
}): Promise<Record<string, unknown> | null> {
  const pool = getPool();
  const result = await pool.query(
    `
    SELECT *
    FROM environment_fingerprint
    WHERE tenant_id = $1
      AND scope = $2
      AND fingerprint_key = $3
    LIMIT 1
    `,
    [input.tenantId, input.scope, input.fingerprintKey]
  );
  return result.rows[0] ?? null;
}

export async function listActiveFactualMemory(input: { tenantId: string; scope: string }): Promise<Record<string, unknown>[]> {
  const pool = getPool();
  const result = await pool.query(
    `
    SELECT *
    FROM memory
    WHERE tenant_id = $1
      AND scope = $2
      AND status = 'active'
      AND memory_type = 'factual'
    ORDER BY importance DESC, confidence_score DESC, created_at DESC
    `,
    [input.tenantId, input.scope]
  );
  return result.rows;
}

export async function listActiveSkills(input: {
  tenantId: string;
  scope: string;
  fingerprint?: string | null;
}): Promise<Record<string, unknown>[]> {
  const pool = getPool();
  const result = await pool.query(
    `
    SELECT *
    FROM skill
    WHERE tenant_id = $1
      AND scope = $2
      AND status = 'active'
      AND ($3::text IS NULL OR fingerprint_requirement IS NULL OR fingerprint_requirement = $3)
    ORDER BY success_rate DESC NULLS LAST, created_at DESC
    `,
    [input.tenantId, input.scope, input.fingerprint ?? null]
  );
  return result.rows;
}

export async function listActiveRules(input: { tenantId: string; scope: string }): Promise<Record<string, unknown>[]> {
  const pool = getPool();
  const result = await pool.query(
    `
    SELECT *
    FROM rule
    WHERE tenant_id = $1
      AND scope = $2
      AND status = 'active'
    ORDER BY priority DESC, created_at DESC
    `,
    [input.tenantId, input.scope]
  );
  return result.rows;
}

export async function downgradeSkillsOnFingerprintDrift(input: {
  tenantId: string;
  scope: string;
  fingerprint?: string | null;
  traceId?: string | null;
}): Promise<string[]> {
  if (!input.fingerprint) {
    return [];
  }
  const pool = getPool();
  const candidates = await pool.query<{
    id: string;
    skill_key: string;
    title: string;
    fingerprint_requirement: string;
  }>(
    `
    SELECT id, skill_key, title, fingerprint_requirement
    FROM skill
    WHERE tenant_id = $1
      AND scope = $2
      AND status = 'active'
      AND fingerprint_requirement IS NOT NULL
      AND fingerprint_requirement <> $3
    `,
    [input.tenantId, input.scope, input.fingerprint]
  );
  const proposalIds: string[] = [];
  for (const row of candidates.rows) {
    const existingProposal = await pool.query<{ id: string }>(
      `
      SELECT id
      FROM governance_change_proposal
      WHERE tenant_id = $1
        AND scope = $2
        AND status = 'recorded'
        AND target_object_type = 'skill'
        AND target_object_id = $3
        AND proposed_action = 'mark_skill_dirty_for_fingerprint_drift'
      LIMIT 1
      `,
      [input.tenantId, input.scope, row.id]
    );
    if (existingProposal.rows[0]) {
      proposalIds.push(existingProposal.rows[0].id);
      continue;
    }
    const inserted = await pool.query<{ id: string }>(
      `
      INSERT INTO governance_change_proposal (
        tenant_id, scope, status, version, target_object_type, target_object_id,
        proposed_action, proposed_payload, reason, risk_level, source_ref, trace_id
      )
      VALUES (
        $1, $2, 'recorded', 1, 'skill', $3,
        'mark_skill_dirty_for_fingerprint_drift', $4::jsonb,
        'skill_fingerprint_drift_requires_human_approval', 'medium', NULL, $5
      )
      RETURNING id
      `,
      [
        input.tenantId,
        input.scope,
        row.id,
        JSON.stringify({
          skill_id: row.id,
          skill_key: row.skill_key,
          title: row.title,
          fingerprint_requirement: row.fingerprint_requirement,
          requested_fingerprint: input.fingerprint,
          proposed_status: "dirty"
        }),
        input.traceId ?? `trace-skill-fingerprint-drift-${Date.now()}`
      ]
    );
    proposalIds.push(inserted.rows[0].id);
  }
  return proposalIds;
}

export async function getPersistableRecordsForIndex(input: {
  tenantId: string;
  scope: string;
  fingerprint?: string | null;
}): Promise<{ memory: Record<string, unknown>[]; skill: Record<string, unknown>[] }> {
  const [memory, skill] = await Promise.all([
    listActiveFactualMemory({ tenantId: input.tenantId, scope: input.scope }),
    listActiveSkills({ tenantId: input.tenantId, scope: input.scope, fingerprint: input.fingerprint })
  ]);
  return { memory, skill };
}

export type MemoryPersistResult = {
  persistTarget: PersistTarget;
  objectId: string | null;
};

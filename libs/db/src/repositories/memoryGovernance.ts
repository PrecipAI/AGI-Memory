import { getPool } from "../pool.js";

async function retireByStatus(tableName: "memory" | "rule" | "skill" | "conversation_summary" | "resident_snapshot"): Promise<string[]> {
  const pool = getPool();
  const result = await pool.query<{ id: string }>(
    `
    UPDATE ${tableName}
    SET status = 'retired',
        updated_at = now()
    WHERE status = 'superseded'
    RETURNING id
    `
  );
  return result.rows.map((row) => row.id);
}

export async function retireSupersededMemory(): Promise<string[]> {
  return retireByStatus("memory");
}

export async function retireSupersededSkills(): Promise<string[]> {
  return retireByStatus("skill");
}

export async function retireSupersededRules(): Promise<string[]> {
  return retireByStatus("rule");
}

export async function retireSupersededConversationSummaries(): Promise<string[]> {
  return retireByStatus("conversation_summary");
}

export async function governRuleConflicts(input: {
  tenantId: string;
  scope: string;
  traceId: string;
}): Promise<string[]> {
  const pool = getPool();
  const conflicts = await pool.query<{
    left_rule_id: string;
    left_rule_key: string;
    left_priority: number;
    right_rule_id: string;
    right_rule_key: string;
    right_priority: number;
    conflict_type: string;
  }>(
    `
    WITH explicit_conflicts AS (
      SELECT
        left_rule.id AS left_rule_id,
        left_rule.rule_key AS left_rule_key,
        left_rule.priority AS left_priority,
        right_rule.id AS right_rule_id,
        right_rule.rule_key AS right_rule_key,
        right_rule.priority AS right_priority,
        COALESCE(left_rule.metadata ->> 'conflict_type', 'explicit_rule_conflict') AS conflict_type
      FROM rule left_rule
      JOIN rule right_rule
        ON right_rule.tenant_id = left_rule.tenant_id
       AND right_rule.scope = left_rule.scope
       AND right_rule.status = 'active'
       AND right_rule.rule_key = left_rule.metadata ->> 'conflicts_with_rule_key'
      WHERE left_rule.tenant_id = $1
        AND left_rule.scope = $2
        AND left_rule.status = 'active'
        AND left_rule.metadata ? 'conflicts_with_rule_key'
    )
    SELECT *
    FROM explicit_conflicts
    WHERE left_rule_id <> right_rule_id
    ORDER BY left_priority DESC, right_priority DESC
    `,
    [input.tenantId, input.scope]
  );

  const conflictIds: string[] = [];
  for (const conflict of conflicts.rows) {
    const lowerPriorityRuleId =
      conflict.left_priority >= conflict.right_priority ? conflict.right_rule_id : conflict.left_rule_id;
    const higherPriorityRuleId =
      conflict.left_priority >= conflict.right_priority ? conflict.left_rule_id : conflict.right_rule_id;
    const inserted = await pool.query<{ id: string }>(
      `
      INSERT INTO rule_conflict (
        tenant_id, scope, status, version, left_rule_id, right_rule_id,
        conflict_type, severity, resolution_action, details, trace_id
      )
      VALUES (
        $1, $2, 'recorded', 1, $3, $4,
        $5, 'medium', 'lower_priority_rule_dirtied', $6::jsonb, $7
      )
      ON CONFLICT (tenant_id, scope, left_rule_id, right_rule_id, conflict_type)
      DO UPDATE SET
        status = 'recorded',
        details = EXCLUDED.details,
        trace_id = EXCLUDED.trace_id,
        updated_at = now()
      RETURNING id
      `,
      [
        input.tenantId,
        input.scope,
        conflict.left_rule_id,
        conflict.right_rule_id,
        conflict.conflict_type,
        JSON.stringify({
          left_rule_key: conflict.left_rule_key,
          right_rule_key: conflict.right_rule_key,
          left_priority: conflict.left_priority,
          right_priority: conflict.right_priority,
          dirtied_rule_id: lowerPriorityRuleId
        }),
        input.traceId
      ]
    );
    conflictIds.push(inserted.rows[0].id);

    await pool.query(
      `
      INSERT INTO governance_change_proposal (
        tenant_id, scope, status, version, target_object_type, target_object_id,
        proposed_action, proposed_payload, reason, risk_level, source_ref, trace_id
      )
      VALUES (
        $1, $2, 'recorded', 1, 'rule', $5,
        'mark_rule_dirty_for_conflict', $6::jsonb, 'rule_conflict_requires_human_decision', 'medium', $4::text, $3
      )
      `,
      [
        input.tenantId,
        input.scope,
        input.traceId,
        inserted.rows[0].id,
        lowerPriorityRuleId,
        JSON.stringify({
          conflict_id: inserted.rows[0].id,
          lower_priority_rule_id: lowerPriorityRuleId,
          higher_priority_rule_id: higherPriorityRuleId,
          proposed_status: "dirty"
        })
      ]
    );
  }

  return conflictIds;
}

export async function retireSupersededResidentSnapshots(): Promise<string[]> {
  return retireByStatus("resident_snapshot");
}

export async function rebuildDirtyResidentSnapshots(input: {
  tenantId: string;
  scope: string;
  traceId: string;
}): Promise<string[]> {
  const pool = getPool();
  const result = await pool.query<{ id: string }>(
    `
    UPDATE resident_snapshot
    SET status = 'rebuilding',
        dirty_reason = COALESCE(dirty_reason, 'governance-rebuild'),
        trace_id = $3,
        updated_at = now()
    WHERE tenant_id = $1
      AND scope = $2
      AND status = 'dirty'
    RETURNING id
    `,
    [input.tenantId, input.scope, input.traceId]
  );
  return result.rows.map((row) => row.id);
}

export async function recordDriftCheckResults(input: {
  tenantId: string;
  scope: string;
  taskRequestId: string;
  taskStepId?: string | null;
  fingerprint?: string | null;
  traceId: string;
}): Promise<
  Array<{
    id: string;
    skill_id: string;
    skill_key: string;
    fingerprint_requirement: string;
    match_result: string;
    drift_reason: string | null;
  }>
> {
  const pool = getPool();
  const candidates = await pool.query<{
    id: string;
    skill_key: string;
    fingerprint_requirement: string;
  }>(
    `
    SELECT id, skill_key, fingerprint_requirement
    FROM skill
    WHERE tenant_id = $1
      AND scope = $2
      AND status IN ('active', 'dirty', 'superseded')
      AND fingerprint_requirement IS NOT NULL
    ORDER BY created_at ASC
    `,
    [input.tenantId, input.scope]
  );

  const records: Array<{
    id: string;
    skill_id: string;
    skill_key: string;
    fingerprint_requirement: string;
    match_result: string;
    drift_reason: string | null;
  }> = [];

  for (const row of candidates.rows) {
    const matchResult =
      !input.fingerprint
        ? "unknown"
        : row.fingerprint_requirement === input.fingerprint
          ? "matched"
          : "mismatch";
    const driftReason =
      matchResult === "matched"
        ? null
        : matchResult === "unknown"
          ? "fingerprint_missing"
          : "fingerprint_mismatch";

    const inserted = await pool.query<{ id: string }>(
      `
      INSERT INTO drift_check_result (
        tenant_id, scope, status, version, task_request_id, task_step_id,
        resource_locator, probe_payload, match_result, drift_reason, trace_id
      )
      VALUES (
        $1, $2, 'recorded', 1, $3, $4,
        $5::jsonb, $6::jsonb, $7, $8, $9
      )
      RETURNING id
      `,
      [
        input.tenantId,
        input.scope,
        input.taskRequestId,
        input.taskStepId ?? null,
        JSON.stringify({
          object_type: "skill",
          skill_id: row.id,
          skill_key: row.skill_key
        }),
        JSON.stringify({
          fingerprint_requirement: row.fingerprint_requirement,
          requested_fingerprint: input.fingerprint ?? null
        }),
        matchResult,
        driftReason,
        input.traceId
      ]
    );

    records.push({
      id: inserted.rows[0].id,
      skill_id: row.id,
      skill_key: row.skill_key,
      fingerprint_requirement: row.fingerprint_requirement,
      match_result: matchResult,
      drift_reason: driftReason
    });
  }

  return records;
}

export async function createReconciliationItems(input: {
  tenantId: string;
  scope: string;
  taskRequestId: string;
  taskStepId?: string | null;
  driftRecords?: Array<{
    skill_id: string;
    skill_key: string;
    fingerprint_requirement: string;
    match_result: string;
    drift_reason: string | null;
  }>;
  staleIndexIds?: string[];
  traceId: string;
}): Promise<string[]> {
  const pool = getPool();
  const ids: string[] = [];

  for (const record of input.driftRecords ?? []) {
    if (record.match_result === "matched") {
      continue;
    }

    const inserted = await pool.query<{ id: string }>(
      `
      INSERT INTO reconciliation_item (
        tenant_id, scope, status, version, task_request_id, task_step_id,
        reconciliation_type, expected_state, observed_state, action_state, trace_id
      )
      VALUES (
        $1, $2, 'recorded', 1, $3, $4,
        $5, $6::jsonb, $7::jsonb, 'recorded', $8
      )
      RETURNING id
      `,
      [
        input.tenantId,
        input.scope,
        input.taskRequestId,
        input.taskStepId ?? null,
        record.match_result === "unknown" ? "fingerprint_probe_required" : "fingerprint_downgrade",
        JSON.stringify({
          skill_id: record.skill_id,
          skill_key: record.skill_key,
          fingerprint_requirement: record.fingerprint_requirement,
          expected_match_result: "matched"
        }),
        JSON.stringify({
          match_result: record.match_result,
          drift_reason: record.drift_reason
        }),
        input.traceId
      ]
    );
    ids.push(inserted.rows[0].id);
  }

  for (const staleIndexId of input.staleIndexIds ?? []) {
    const inserted = await pool.query<{ id: string }>(
      `
      INSERT INTO reconciliation_item (
        tenant_id, scope, status, version, task_request_id, task_step_id,
        reconciliation_type, expected_state, observed_state, action_state, trace_id
      )
      VALUES (
        $1, $2, 'recorded', 1, $3, $4,
        'stale_index_cleanup', $5::jsonb, $6::jsonb, 'recorded', $7
      )
      RETURNING id
      `,
      [
        input.tenantId,
        input.scope,
        input.taskRequestId,
        input.taskStepId ?? null,
        JSON.stringify({
          stale_index_id: staleIndexId,
          expected_presence: false
        }),
        JSON.stringify({
          stale_index_id: staleIndexId,
          observed_presence: true
        }),
        input.traceId
      ]
    );
    ids.push(inserted.rows[0].id);
  }

  return ids;
}

export async function createZombieStates(input: {
  tenantId: string;
  scope: string;
  taskRequestId: string;
  taskStepId?: string | null;
  staleIndexIds?: string[];
  traceId: string;
}): Promise<string[]> {
  const pool = getPool();
  const ids: string[] = [];

  for (const staleIndexId of input.staleIndexIds ?? []) {
    const inserted = await pool.query<{ id: string }>(
      `
      INSERT INTO zombie_state (
        tenant_id, scope, status, version, task_request_id, task_step_id,
        resource_locator, handoff_reason, operator_owner, remediation_payload, trace_id
      )
      VALUES (
        $1, $2, 'parked', 1, $3, $4,
        $5::jsonb, 'stale_index_entry', 'memory-governance', $6::jsonb, $7
      )
      RETURNING id
      `,
      [
        input.tenantId,
        input.scope,
        input.taskRequestId,
        input.taskStepId ?? null,
        JSON.stringify({
          object_type: "index_entry",
          index_object_id: staleIndexId
        }),
        JSON.stringify({
          cleanup_action: "evict_local_index",
          requires_manual_review: false
        }),
        input.traceId
      ]
    );
    ids.push(inserted.rows[0].id);
  }

  return ids;
}

export async function listGovernanceChangeProposals(input: {
  tenantId: string;
  scope: string;
  status?: string | null;
  limit?: number;
  proposedActionType?: string | null;
  evolutionSignal?: string | null;
}): Promise<Record<string, unknown>[]> {
  const pool = getPool();
  const result = await pool.query(
    `
    SELECT *
    FROM governance_change_proposal
    WHERE tenant_id = $1
      AND scope = $2
      AND ($3::record_status IS NULL OR status = $3::record_status)
      AND ($5::text IS NULL OR proposed_action_type = $5)
      AND ($6::text IS NULL OR evolution_signal = $6)
    ORDER BY created_at DESC
    LIMIT $4
    `,
    [
      input.tenantId,
      input.scope,
      input.status ?? "recorded",
      input.limit ?? 50,
      input.proposedActionType ?? null,
      input.evolutionSignal ?? null
    ]
  );
  return result.rows;
}

export async function createGovernanceChangeProposal(input: {
  tenantId: string;
  scope: string;
  targetObjectType: string;
  targetObjectId?: string | null;
  proposedAction: string;
  proposedPayload?: Record<string, unknown>;
  reason: string;
  riskLevel?: string;
  sourceRef?: string | null;
  traceId: string;
  originScope?: string;
  availabilityScope?: string;
  promotionStatus?: string;
  governanceLevel?: string;
  conflictMetadata?: Record<string, unknown>;
  evolutionSignal?: string | null;
  originalArtifactId?: string | null;
  proposedActionType?: string;
}): Promise<string> {
  const pool = getPool();
  const result = await pool.query<{ id: string }>(
    `
    INSERT INTO governance_change_proposal (
      tenant_id, scope, status, version,
      target_object_type, target_object_id,
      proposed_action, proposed_payload, reason, risk_level,
      source_ref, trace_id,
      origin_scope, availability_scope, promotion_status, governance_level,
      conflict_metadata, evolution_signal, original_artifact_id, proposed_action_type
    )
    VALUES (
      $1, $2, 'recorded', 1,
      $3, $4,
      $5, $6::jsonb, $7, $8,
      $9, $10,
      $11, $12, $13, $14,
      $15::jsonb, $16, $17, $18
    )
    RETURNING id
    `,
    [
      input.tenantId,
      input.scope,
      input.targetObjectType,
      input.targetObjectId ?? null,
      input.proposedAction,
      JSON.stringify(input.proposedPayload ?? {}),
      input.reason,
      input.riskLevel ?? "medium",
      input.sourceRef ?? null,
      input.traceId,
      input.originScope ?? "session",
      input.availabilityScope ?? "session_only",
      input.promotionStatus ?? "needs_review",
      input.governanceLevel ?? "session",
      JSON.stringify(input.conflictMetadata ?? {}),
      input.evolutionSignal ?? null,
      input.originalArtifactId ?? null,
      input.proposedActionType ?? "add"
    ]
  );
  return result.rows[0].id;
}

export async function applyGovernanceChangeProposal(input: {
  tenantId: string;
  scope: string;
  proposalId: string;
  action: "approve" | "reject";
  humanResponse?: Record<string, unknown>;
  traceId: string;
}): Promise<Record<string, unknown> | null> {
  const pool = getPool();
  const proposalResult = await pool.query(
    `
    SELECT *
    FROM governance_change_proposal
    WHERE tenant_id = $1
      AND scope = $2
      AND id = $3
      AND status = 'recorded'
    LIMIT 1
    `,
    [input.tenantId, input.scope, input.proposalId]
  );
  const proposal = proposalResult.rows[0];
  if (!proposal) {
    return null;
  }

  if (input.action === "reject") {
    const rejected = await pool.query(
      `
      UPDATE governance_change_proposal
      SET status = 'resolved',
          human_decision = 'rejected',
          human_response = $4::jsonb,
          decided_at = now(),
          trace_id = $5,
          updated_at = now()
      WHERE tenant_id = $1
        AND scope = $2
        AND id = $3
      RETURNING *
      `,
      [input.tenantId, input.scope, input.proposalId, JSON.stringify(input.humanResponse ?? {}), input.traceId]
    );
    return rejected.rows[0] ?? null;
  }

  await pool.query("BEGIN");
  try {
    const payload = proposal.proposed_payload as Record<string, unknown>;
    let appliedObjectId: string | null = null;

    if (proposal.proposed_action === "replace_rule" || proposal.proposed_action === "create_conflicting_rule") {
      const targetRuleId = proposal.target_object_id as string | null;
      let nextVersion = Number(payload.next_version ?? 1);
      if (targetRuleId) {
        await pool.query("UPDATE rule SET status = 'superseded', updated_at = now(), trace_id = $2 WHERE id = $1", [targetRuleId, input.traceId]);
      }
      if (!Number.isFinite(nextVersion) || nextVersion < 1) {
        nextVersion = 1;
      }
      const inserted = await pool.query<{ id: string }>(
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
          String(payload.rule_key),
          String(payload.rule_type),
          String(payload.title),
          String(payload.statement),
          String(payload.normalized_statement ?? payload.statement).toLowerCase(),
          JSON.stringify(payload.applies_to ?? []),
          JSON.stringify(payload.trigger_conditions ?? {}),
          String(payload.enforcement_level ?? "should_follow"),
          Number(payload.priority ?? 75),
          String(payload.risk_level ?? "medium"),
          String(payload.verification_status ?? "verified"),
          JSON.stringify(payload.source_refs ?? []),
          JSON.stringify(payload.evidence_refs ?? []),
          targetRuleId,
          JSON.stringify({
            ...(payload.metadata ?? {}),
            host_action: {
              skill: "gate-master",
              status: "pending",
              generated_at: null,
              trace_id: input.traceId
            }
          }),
          input.traceId
        ]
      );
      appliedObjectId = inserted.rows[0].id;
    } else if (proposal.proposed_action === "create_rule") {
      const nextVersion = Number(payload.next_version ?? 1);
      const inserted = await pool.query<{ id: string }>(
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
          NULL, $17::jsonb, $18
        )
        RETURNING id
        `,
        [
          input.tenantId,
          input.scope,
          nextVersion,
          String(payload.rule_key),
          String(payload.rule_type),
          String(payload.title),
          String(payload.statement),
          String(payload.normalized_statement ?? payload.statement).toLowerCase(),
          JSON.stringify(payload.applies_to ?? []),
          JSON.stringify(payload.trigger_conditions ?? {}),
          String(payload.enforcement_level ?? "should_follow"),
          Number(payload.priority ?? 75),
          String(payload.risk_level ?? "medium"),
          String(payload.verification_status ?? "verified"),
          JSON.stringify(payload.source_refs ?? []),
          JSON.stringify(payload.evidence_refs ?? []),
          JSON.stringify({
            ...(payload.metadata ?? {}),
            host_action: {
              skill: "gate-master",
              status: "pending",
              generated_at: null,
              trace_id: input.traceId
            }
          }),
          input.traceId
        ]
      );
      appliedObjectId = inserted.rows[0].id;
    } else if (proposal.proposed_action === "mark_rule_dirty_for_conflict") {
      const updated = await pool.query<{ id: string }>(
        `
        UPDATE rule
        SET status = 'dirty',
            metadata = metadata || jsonb_build_object(
              'dirty_reason', 'rule_conflict',
              'conflict_id', ($3::jsonb ->> 'conflict_id')::uuid,
              'dirtied_at', now()
            ),
            trace_id = $2,
            updated_at = now()
        WHERE id = $1
          AND tenant_id = $4
          AND scope = $5
        RETURNING id
        `,
        [proposal.target_object_id, input.traceId, JSON.stringify(payload), input.tenantId, input.scope]
      );
      appliedObjectId = updated.rows[0]?.id ?? null;
    } else if (proposal.proposed_action === "replace_memory") {
      const targetMemoryId = proposal.target_object_id as string | null;
      let nextVersion = Number(payload.next_version ?? 1);
      if (targetMemoryId) {
        await pool.query("UPDATE memory SET status = 'superseded', updated_at = now(), trace_id = $2 WHERE id = $1", [
          targetMemoryId,
          input.traceId
        ]);
      }
      if (!Number.isFinite(nextVersion) || nextVersion < 1) {
        nextVersion = 1;
      }
      const inserted = await pool.query<{ id: string }>(
        `
        INSERT INTO memory (
          tenant_id, scope, status, version, memory_type, title, content, normalized_content,
          source_kind, source_ref, verification_status, fingerprint_requirement, tags, metadata,
          importance, confidence_score, supersedes_id, trace_id
        )
        VALUES (
          $1, $2, 'active', $3, 'factual', $4, $5, $6,
          $7, $8, $9, $10, $11::text[], $12::jsonb,
          $13, $14, $15, $16
        )
        RETURNING id
        `,
        [
          input.tenantId,
          input.scope,
          nextVersion,
          String(payload.title),
          String(payload.content),
          String(payload.normalized_content ?? payload.content).toLowerCase(),
          String(payload.source_kind ?? "memory_candidate"),
          String(payload.source_ref ?? proposal.source_ref ?? "governance_change_proposal"),
          String(payload.verification_status ?? "verified"),
          payload.fingerprint_requirement ? String(payload.fingerprint_requirement) : null,
          Array.isArray(payload.tags) ? payload.tags.map(String) : [],
          JSON.stringify(payload.metadata ?? {}),
          Number(payload.importance ?? 75),
          Number(payload.confidence_score ?? 0.9),
          targetMemoryId,
          input.traceId
        ]
      );
      appliedObjectId = inserted.rows[0].id;
    } else if (proposal.proposed_action === "drop_duplicate_memory") {
      appliedObjectId = proposal.target_object_id as string | null;
    } else if (proposal.proposed_action === "replace_skill") {
      const targetSkillId = proposal.target_object_id as string | null;
      if (targetSkillId) {
        await pool.query("UPDATE skill SET status = 'superseded', updated_at = now(), trace_id = $2 WHERE id = $1", [targetSkillId, input.traceId]);
      }
      const inserted = await pool.query<{ id: string }>(
        `
        INSERT INTO skill (
          tenant_id, scope, status, version, skill_key, title, description, skill_type,
          trigger_conditions, procedure_payload, verification_status, fingerprint_requirement,
          risk_level, success_rate, tags, trace_id,
          origin_scope, availability_scope, governance_level, promotion_status
        )
        VALUES (
          $1, $2, 'active', $3, $4, $5, $6, $7,
          $8::jsonb, $9::jsonb, $10, $11,
          $12::risk_level, $13, $14::text[], $15,
          $16, $17, $18, $19
        )
        RETURNING id
        `,
        [
          input.tenantId,
          input.scope,
          Number(payload.next_version ?? 1),
          String(payload.skill_key),
          String(payload.title),
          String(payload.description),
          String(payload.skill_type ?? "procedure"),
          JSON.stringify(payload.trigger_conditions ?? {}),
          JSON.stringify(payload.procedure_payload ?? {}),
          String(payload.verification_status ?? "verified"),
          payload.fingerprint_requirement ? String(payload.fingerprint_requirement) : null,
          String(payload.risk_level ?? "low"),
          payload.success_rate === null || payload.success_rate === undefined ? null : Number(payload.success_rate),
          Array.isArray(payload.tags) ? payload.tags.map(String) : [],
          input.traceId,
          String(payload.origin_scope ?? "session"),
          String(payload.availability_scope ?? "session_only"),
          String(payload.governance_level ?? "session"),
          String(payload.promotion_status ?? "active")
        ]
      );
      appliedObjectId = inserted.rows[0].id;
    } else if (proposal.proposed_action === "skill_update_proposal") {
      const skillKey = String(payload.target_skill ?? payload.skill_key ?? "");
      if (!skillKey) {
        throw new Error("[governance] skill_update_proposal payload missing target_skill/skill_key");
      }
      const existingSkill = await pool.query<{ id: string; version: number }>(
        `
        SELECT id, version
        FROM skill
        WHERE tenant_id = $1
          AND scope = $2
          AND skill_key = $3
          AND status = 'active'
        ORDER BY version DESC
        LIMIT 1
        `,
        [input.tenantId, input.scope, skillKey]
      );
      const targetSkillId = existingSkill.rows[0]?.id ?? null;
      const nextVersion = existingSkill.rows[0] ? existingSkill.rows[0].version + 1 : 1;
      if (targetSkillId) {
        await pool.query("UPDATE skill SET status = 'superseded', updated_at = now(), trace_id = $2 WHERE id = $1", [targetSkillId, input.traceId]);
      }
      const inserted = await pool.query<{ id: string }>(
        `
        INSERT INTO skill (
          tenant_id, scope, status, version, skill_key, title, description, skill_type,
          trigger_conditions, procedure_payload, verification_status, fingerprint_requirement,
          risk_level, success_rate, tags, trace_id,
          origin_scope, availability_scope, governance_level, promotion_status
        )
        VALUES (
          $1, $2, 'active', $3, $4, $5, $6, $7,
          $8::jsonb, $9::jsonb, $10, $11,
          $12::risk_level, $13, $14::text[], $15,
          $16, $17, $18, $19
        )
        RETURNING id
        `,
        [
          input.tenantId,
          input.scope,
          nextVersion,
          skillKey,
          String(payload.proposal_title ?? payload.title ?? skillKey),
          String(payload.description ?? ""),
          String(payload.skill_type ?? "procedure"),
          JSON.stringify(payload.trigger_conditions ?? {}),
          JSON.stringify({
            change_type: payload.change_type ?? "add",
            current_section: payload.current_section ?? null,
            current_text: payload.current_text ?? null,
            current_gap: payload.current_gap ?? null,
            proposed_text: payload.proposed_text ?? null,
            proposed_patch: payload.proposed_patch ?? null,
            validation_method: payload.validation_method ?? null,
            applicable_scenarios: payload.applicable_scenarios ?? [],
            non_applicable_scenarios: payload.non_applicable_scenarios ?? [],
            execution_steps: payload.execution_steps ?? [],
            rationale: payload.rationale ?? null,
            source_refs: payload.source_refs ?? []
          }),
          String(payload.verification_status ?? "verified"),
          payload.fingerprint_requirement ? String(payload.fingerprint_requirement) : null,
          String(payload.risk_level ?? "low"),
          payload.success_rate === null || payload.success_rate === undefined ? null : Number(payload.success_rate),
          Array.isArray(payload.tags) ? payload.tags.map(String) : [],
          input.traceId,
          String(payload.origin_scope ?? "project"),
          String(payload.availability_scope ?? "project_reusable"),
          String(payload.governance_level ?? "shared"),
          String(payload.promotion_status ?? "active")
        ]
      );
      appliedObjectId = inserted.rows[0].id;
      // Update procedure_payload with host_action pending flag
      await pool.query(
        `UPDATE skill SET procedure_payload = procedure_payload || $1::jsonb WHERE id = $2`,
        [
          JSON.stringify({
            host_action: {
              skill: "skill-creator",
              status: "pending",
              generated_at: null,
              trace_id: input.traceId
            }
          }),
          appliedObjectId
        ]
      );
    } else if (proposal.proposed_action === "mark_skill_dirty_for_fingerprint_drift") {
      const updated = await pool.query<{ id: string }>(
        `
        UPDATE skill
        SET status = 'dirty',
            trace_id = $2,
            updated_at = now()
        WHERE id = $1
          AND tenant_id = $3
          AND scope = $4
        RETURNING id
        `,
        [proposal.target_object_id, input.traceId, input.tenantId, input.scope]
      );
      appliedObjectId = updated.rows[0]?.id ?? null;
    }

    const updatedProposal = await pool.query(
      `
      UPDATE governance_change_proposal
      SET status = 'resolved',
          human_decision = 'approved',
          human_response = $4::jsonb,
          decided_at = now(),
          trace_id = $5,
          updated_at = now()
      WHERE tenant_id = $1
        AND scope = $2
        AND id = $3
      RETURNING *
      `,
      [
        input.tenantId,
        input.scope,
        input.proposalId,
        JSON.stringify({
          ...(input.humanResponse ?? {}),
          applied_object_id: appliedObjectId
        }),
        input.traceId
      ]
    );
    await pool.query("COMMIT");
    return updatedProposal.rows[0] ?? null;
  } catch (error) {
    await pool.query("ROLLBACK").catch(() => {});
    throw error;
  }
}

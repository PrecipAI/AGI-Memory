import { getPool } from "../pool.js";

export async function appendJournal(input: {
  tenantId: string;
  scope: string;
  taskRequestId: string;
  taskPlanId: string;
  taskStepId: string;
  checkpoint: string;
  effectPhase: string;
  dependencyId?: string | null;
  resourceLocator?: Record<string, unknown> | null;
  payloadHash?: string | null;
  journalPayload?: Record<string, unknown>;
  idempotencyKey: string;
  traceId: string;
  occurredAt?: string;
}): Promise<void> {
  const pool = getPool();
  const seqResult = await pool.query<{ next_seq: string }>(
    "SELECT COALESCE(MAX(journal_seq), 0) + 1 AS next_seq FROM execution_journal WHERE task_step_id = $1",
    [input.taskStepId]
  );
  const nextSeq = Number(seqResult.rows[0].next_seq);

  await pool.query(
    `
    INSERT INTO execution_journal (
      tenant_id, scope, status, version, task_request_id, task_plan_id, task_step_id,
      journal_seq, checkpoint, effect_phase, dependency_id, resource_locator, payload_hash,
      journal_payload, idempotency_key, trace_id, occurred_at
    )
    VALUES (
      $1, $2, 'recorded', 1, $3, $4, $5,
      $6, $7, $8, $9, $10::jsonb, $11,
      $12::jsonb, $13, $14, COALESCE($15::timestamptz, now())
    )
    `,
    [
      input.tenantId,
      input.scope,
      input.taskRequestId,
      input.taskPlanId,
      input.taskStepId,
      nextSeq,
      input.checkpoint,
      input.effectPhase,
      input.dependencyId ?? null,
      JSON.stringify(input.resourceLocator ?? null),
      input.payloadHash ?? null,
      JSON.stringify(input.journalPayload ?? {}),
      input.idempotencyKey,
      input.traceId,
      input.occurredAt ?? null
    ]
  );
}

export async function createCompensationCapsule(input: {
  tenantId: string;
  scope: string;
  taskRequestId: string;
  taskPlanId: string;
  taskStepId: string;
  sideEffectClass: string;
  idempotencyKey: string;
  targetDependency: string;
  compensatorId: string;
  compensatorVersion: string;
  resourceLocator: Record<string, unknown>;
  requestPayloadHash: string;
  preconditionSnapshot: Record<string, unknown>;
  fingerprintAtExecution: string;
  committedResourceId?: string | null;
  responseHandle?: string | null;
  revision?: string | null;
  capsulePayload: Record<string, unknown>;
  traceId: string;
}): Promise<string> {
  const pool = getPool();
  const result = await pool.query<{ id: string }>(
    `
    INSERT INTO compensation_capsule (
      tenant_id, scope, status, version, task_request_id, task_plan_id, task_step_id,
      side_effect_class, idempotency_key, target_dependency, compensator_id, compensator_version,
      resource_locator, request_payload_hash, precondition_snapshot, fingerprint_at_execution,
      committed_resource_id, response_handle, revision, capsule_payload, trace_id
    )
    VALUES (
      $1, $2, 'active', 1, $3, $4, $5,
      $6::side_effect_class, $7, $8, $9, $10,
      $11::jsonb, $12, $13::jsonb, $14,
      $15, $16, $17, $18::jsonb, $19
    )
    RETURNING id
    `,
    [
      input.tenantId,
      input.scope,
      input.taskRequestId,
      input.taskPlanId,
      input.taskStepId,
      input.sideEffectClass,
      input.idempotencyKey,
      input.targetDependency,
      input.compensatorId,
      input.compensatorVersion,
      JSON.stringify(input.resourceLocator),
      input.requestPayloadHash,
      JSON.stringify(input.preconditionSnapshot),
      input.fingerprintAtExecution,
      input.committedResourceId ?? null,
      input.responseHandle ?? null,
      input.revision ?? null,
      JSON.stringify(input.capsulePayload),
      input.traceId
    ]
  );

  return result.rows[0].id;
}

export async function getCompensationCapsule(capsuleId: string): Promise<Record<string, unknown> | null> {
  const pool = getPool();
  const result = await pool.query("SELECT * FROM compensation_capsule WHERE id = $1", [capsuleId]);
  return result.rows[0] ?? null;
}

export async function getJournalEntries(taskStepId: string, maxCursor?: number): Promise<Record<string, unknown>[]> {
  const pool = getPool();
  const result = await pool.query(
    `
    SELECT *
    FROM execution_journal
    WHERE task_step_id = $1
      AND ($2::bigint IS NULL OR journal_seq <= $2)
    ORDER BY journal_seq
    `,
    [taskStepId, maxCursor ?? null]
  );
  return result.rows;
}


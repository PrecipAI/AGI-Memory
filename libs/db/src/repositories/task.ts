import { getPool } from "../pool.js";

export type TaskRequestRecord = {
  id: string;
  task_type: string;
  goal: string;
  normalized_envelope: Record<string, unknown>;
  trace_id: string;
  tenant_id: string;
  scope: string;
};

export async function ensureTaskRequest(record: TaskRequestRecord): Promise<void> {
  const pool = getPool();
  await pool.query(
    `
    INSERT INTO task_request (
      id, tenant_id, scope, status, version, request_channel, requester_id,
      task_type, goal, input_payload, normalized_envelope, priority, idempotency_key, trace_id
    )
    VALUES (
      $1, $2, $3, 'requested', 1, 'internal', NULL,
      $4, $5, '{}'::jsonb, $6::jsonb, 50, $8, $7
    )
    ON CONFLICT (id) DO UPDATE
    SET goal = EXCLUDED.goal,
        task_type = EXCLUDED.task_type,
        normalized_envelope = EXCLUDED.normalized_envelope,
        trace_id = EXCLUDED.trace_id,
        updated_at = now()
    `,
    [
      record.id,
      record.tenant_id,
      record.scope,
      record.task_type,
      record.goal,
      JSON.stringify(record.normalized_envelope),
      record.trace_id,
      record.id
    ]
  );
}

export async function ensureMemoryCandidateTaskEnvelope(input: {
  tenantId: string;
  scope: string;
  taskRequestId: string;
  taskStepId: string;
  sourceRef: string;
  artifactTag: string;
  sideEffectClass: string;
  traceId: string;
}): Promise<void> {
  const pool = getPool();
  const stepKey = `memory-envelope-${input.taskStepId.replace(/-/g, "").slice(0, 12)}`;
  await pool.query("BEGIN");
  try {
    await pool.query(
      `
      INSERT INTO task_request (
        id, tenant_id, scope, status, version, request_channel, requester_id,
        task_type, goal, input_payload, normalized_envelope, priority, idempotency_key, trace_id
      )
      VALUES (
        $1, $2, $3, 'requested', 1, 'mcp-memory', NULL,
        'memory_candidate_ingest', $4, $5::jsonb, $5::jsonb, 50, $6, $7
      )
      ON CONFLICT (id) DO UPDATE
      SET normalized_envelope = task_request.normalized_envelope || EXCLUDED.normalized_envelope,
          trace_id = EXCLUDED.trace_id,
          updated_at = now()
      `,
      [
        input.taskRequestId,
        input.tenantId,
        input.scope,
        `Memory candidate ingest: ${input.artifactTag}`,
        JSON.stringify({
          source_ref: input.sourceRef,
          artifact_tag: input.artifactTag,
          task_step_id: input.taskStepId
        }),
        input.taskRequestId,
        input.traceId
      ]
    );

    const planResult = await pool.query<{ id: string }>(
      `
      INSERT INTO task_plan (
        tenant_id, scope, status, version, task_request_id, planning_model, plan_hash, goal,
        acceptance_criteria, risk_level, plan_payload, trace_id
      )
      VALUES (
        $1, $2, 'resolved', 1, $3, 'memory-candidate-envelope', md5($7 || ':memory-candidate-envelope'), $4,
        '[]'::jsonb, 'low'::risk_level, $5::jsonb, $6
      )
      ON CONFLICT (task_request_id, version) DO UPDATE
      SET plan_payload = task_plan.plan_payload || EXCLUDED.plan_payload,
          trace_id = EXCLUDED.trace_id,
          updated_at = now()
      RETURNING id
      `,
      [
        input.tenantId,
        input.scope,
        input.taskRequestId,
        `Memory candidate envelope for ${input.artifactTag}`,
        JSON.stringify({
          source_ref: input.sourceRef,
          artifact_tag: input.artifactTag
        }),
        input.traceId,
        input.taskRequestId
      ]
    );
    const taskPlanId = planResult.rows[0].id;

    await pool.query(
      `
      INSERT INTO task_step (
        id, tenant_id, scope, status, version, task_plan_id, step_key, step_order, title,
        step_type, dependency_keys, input_payload, expected_output, acceptance_criteria,
        risk_level, side_effect_class, capability_hint, compensation_hint, idempotency_key,
        trace_id
      )
      VALUES (
        $1, $2, $3, 'succeeded', 1, $4, $10, 1, $5,
        'memory_candidate_ingest', ARRAY[]::text[], $6::jsonb, '{}'::jsonb, '[]'::jsonb,
        'low'::risk_level, $7::side_effect_class, 'memory-mcp', '{}'::jsonb, $8,
        $9
      )
      ON CONFLICT (id) DO UPDATE
      SET input_payload = task_step.input_payload || EXCLUDED.input_payload,
          side_effect_class = EXCLUDED.side_effect_class,
          trace_id = EXCLUDED.trace_id,
          updated_at = now()
      `,
      [
        input.taskStepId,
        input.tenantId,
        input.scope,
        taskPlanId,
        `Memory candidate ingest: ${input.artifactTag}`,
        JSON.stringify({
          source_ref: input.sourceRef,
          artifact_tag: input.artifactTag
        }),
        input.sideEffectClass,
        `${taskPlanId}:memory-candidate-ingest:${input.taskStepId}`,
        input.traceId,
        stepKey
      ]
    );

    await pool.query("COMMIT");
  } catch (error) {
    await pool.query("ROLLBACK");
    throw error;
  }
}

export async function createTaskPlan(input: {
  taskRequestId: string;
  tenantId: string;
  scope: string;
  goal: string;
  riskLevel: string;
  acceptanceCriteria: unknown[];
  planPayload: Record<string, unknown>;
  traceId: string;
}): Promise<{ planId: string; version: number }> {
  const pool = getPool();
  const result = await pool.query<{ id: string; version: number }>(
    `
    INSERT INTO task_plan (
      tenant_id, scope, status, version, task_request_id, planning_model, plan_hash, goal,
      acceptance_criteria, risk_level, plan_payload, trace_id
    )
    VALUES (
      $1, $2, 'draft', 1, $3, 'fake-planner', md5($10 || ':' || $4 || ':' || $5), $4,
      $6::jsonb, $7::risk_level, $8::jsonb, $9
    )
    RETURNING id, version
    `,
    [
      input.tenantId,
      input.scope,
      input.taskRequestId,
      input.goal,
      JSON.stringify(input.planPayload),
      JSON.stringify(input.acceptanceCriteria),
      input.riskLevel,
      JSON.stringify(input.planPayload),
      input.traceId,
      input.taskRequestId
    ]
  );

  return { planId: result.rows[0].id, version: result.rows[0].version };
}

export async function createTaskStep(input: {
  taskPlanId: string;
  tenantId: string;
  scope: string;
  stepKey: string;
  stepOrder: number;
  title: string;
  stepType: string;
  dependencyKeys: string[];
  inputPayload: Record<string, unknown>;
  expectedOutput: Record<string, unknown>;
  acceptanceCriteria: unknown[];
  riskLevel: string;
  sideEffectClass: string;
  capabilityHint?: string;
  compensationHint?: Record<string, unknown>;
  traceId: string;
}): Promise<string> {
  const pool = getPool();
  const result = await pool.query<{ id: string }>(
    `
    INSERT INTO task_step (
      tenant_id, scope, status, version, task_plan_id, step_key, step_order, title,
      step_type, dependency_keys, input_payload, expected_output, acceptance_criteria,
      risk_level, side_effect_class, capability_hint, compensation_hint, idempotency_key,
      trace_id
    )
    VALUES (
      $1, $2, 'pending', 1, $3, $4, $5, $6,
      $7, $8::text[], $9::jsonb, $10::jsonb, $11::jsonb,
      $12::risk_level, $13::side_effect_class, $14, $15::jsonb, $16, $17
    )
    RETURNING id
    `,
    [
      input.tenantId,
      input.scope,
      input.taskPlanId,
      input.stepKey,
      input.stepOrder,
      input.title,
      input.stepType,
      input.dependencyKeys,
      JSON.stringify(input.inputPayload),
      JSON.stringify(input.expectedOutput),
      JSON.stringify(input.acceptanceCriteria),
      input.riskLevel,
      input.sideEffectClass,
      input.capabilityHint ?? null,
      JSON.stringify(input.compensationHint ?? null),
      `${input.taskPlanId}:${input.stepKey}`,
      input.traceId
    ]
  );

  return result.rows[0].id;
}

export async function createTaskResult(input: {
  tenantId: string;
  scope: string;
  taskRequestId: string;
  taskPlanId: string;
  userSummary: string;
  systemResult: Record<string, unknown>;
  traceId: string;
}): Promise<void> {
  const pool = getPool();
  await pool.query(
    `
    INSERT INTO task_result (
      tenant_id, scope, status, version, task_request_id, task_plan_id, output_state,
      user_summary, system_result, trace_id
    )
    VALUES (
      $1, $2, 'open', 1, $3, $4, 'provisional',
      $5, $6::jsonb, $7
    )
    `,
    [input.tenantId, input.scope, input.taskRequestId, input.taskPlanId, input.userSummary, JSON.stringify(input.systemResult), input.traceId]
  );
}

export async function getTaskStepById(stepId: string): Promise<Record<string, unknown> | null> {
  const pool = getPool();
  const result = await pool.query("SELECT * FROM task_step WHERE id = $1", [stepId]);
  return result.rows[0] ?? null;
}

export async function updateTaskStepStatus(input: {
  taskStepId: string;
  status: string;
  assignedCapabilityId?: string | null;
}): Promise<void> {
  const pool = getPool();
  await pool.query(
    `
    UPDATE task_step
    SET status = $2::task_step_status,
        assigned_capability_id = COALESCE($3, assigned_capability_id),
        updated_at = now()
    WHERE id = $1
    `,
    [input.taskStepId, input.status, input.assignedCapabilityId ?? null]
  );
}

export async function updateTaskResultState(input: {
  taskPlanId: string;
  outputState: string;
  status?: string;
  finalStepId?: string | null;
  systemResult?: Record<string, unknown>;
}): Promise<void> {
  const pool = getPool();
  await pool.query(
    `
    UPDATE task_result
    SET output_state = $2::stream_state,
        status = COALESCE($3::task_result_status, status),
        final_step_id = COALESCE($4, final_step_id),
        system_result = CASE
          WHEN $5::jsonb IS NULL THEN system_result
          ELSE $5::jsonb
        END,
        updated_at = now()
    WHERE task_plan_id = $1
    `,
    [
      input.taskPlanId,
      input.outputState,
      input.status ?? null,
      input.finalStepId ?? null,
      input.systemResult ? JSON.stringify(input.systemResult) : null
    ]
  );
}

export async function beginTaskAttempt(input: {
  tenantId: string;
  scope: string;
  taskRequestId: string;
  taskPlanId: string;
  taskStepId: string;
  dispatchPayload: Record<string, unknown>;
  traceId: string;
}): Promise<{ attemptId: string; attemptNo: number }> {
  const pool = getPool();
  const result = await pool.query<{ id: string; attempt_no: number }>(
    `
    WITH bumped AS (
      UPDATE task_step
      SET current_attempt = current_attempt + 1,
          updated_at = now()
      WHERE id = $1
      RETURNING current_attempt
    )
    INSERT INTO task_attempt (
      tenant_id, scope, status, version, task_request_id, task_plan_id, task_step_id,
      attempt_no, dispatch_payload, dispatch_started_at, trace_id
    )
    SELECT
      $2, $3, 'recorded', 1, $4, $5, $1,
      bumped.current_attempt, $6::jsonb, now(), $7
    FROM bumped
    RETURNING id, attempt_no
    `,
    [
      input.taskStepId,
      input.tenantId,
      input.scope,
      input.taskRequestId,
      input.taskPlanId,
      JSON.stringify(input.dispatchPayload),
      input.traceId
    ]
  );

  return {
    attemptId: result.rows[0].id,
    attemptNo: Number(result.rows[0].attempt_no)
  };
}

export async function completeTaskAttempt(input: {
  attemptId: string;
  outcomeCode: string;
  outcomePayload?: Record<string, unknown>;
  traceId: string;
}): Promise<void> {
  const pool = getPool();
  await pool.query(
    `
    UPDATE task_attempt
    SET dispatch_finished_at = now(),
        outcome_code = $2,
        outcome_payload = $3::jsonb,
        trace_id = $4,
        updated_at = now()
    WHERE id = $1
    `,
    [
      input.attemptId,
      input.outcomeCode,
      JSON.stringify(input.outcomePayload ?? {}),
      input.traceId
    ]
  );
}

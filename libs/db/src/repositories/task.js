import { getPool } from "../pool.js";
export async function ensureTaskRequest(record) {
    const pool = getPool();
    await pool.query(`
    INSERT INTO task_request (
      id, tenant_id, scope, status, version, request_channel, requester_id,
      task_type, goal, input_payload, normalized_envelope, priority, idempotency_key, trace_id
    )
    VALUES (
      $1, $2, $3, 'requested', 1, 'internal', NULL,
      $4, $5, '{}'::jsonb, $6::jsonb, 50, $1, $7
    )
    ON CONFLICT (id) DO UPDATE
    SET goal = EXCLUDED.goal,
        task_type = EXCLUDED.task_type,
        normalized_envelope = EXCLUDED.normalized_envelope,
        trace_id = EXCLUDED.trace_id,
        updated_at = now()
    `, [
        record.id,
        record.tenant_id,
        record.scope,
        record.task_type,
        record.goal,
        JSON.stringify(record.normalized_envelope),
        record.trace_id
    ]);
}
export async function createTaskPlan(input) {
    const pool = getPool();
    const result = await pool.query(`
    INSERT INTO task_plan (
      tenant_id, scope, status, version, task_request_id, planning_model, plan_hash, goal,
      acceptance_criteria, risk_level, plan_payload, trace_id
    )
    VALUES (
      $1, $2, 'draft', 1, $3, 'fake-planner', md5($4 || $5), $4,
      $6::jsonb, $7::risk_level, $8::jsonb, $9
    )
    RETURNING id, version
    `, [
        input.tenantId,
        input.scope,
        input.taskRequestId,
        input.goal,
        JSON.stringify(input.planPayload),
        JSON.stringify(input.acceptanceCriteria),
        input.riskLevel,
        JSON.stringify(input.planPayload),
        input.traceId
    ]);
    return { planId: result.rows[0].id, version: result.rows[0].version };
}
export async function createTaskStep(input) {
    const pool = getPool();
    const result = await pool.query(`
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
    `, [
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
    ]);
    return result.rows[0].id;
}
export async function createTaskResult(input) {
    const pool = getPool();
    await pool.query(`
    INSERT INTO task_result (
      tenant_id, scope, status, version, task_request_id, task_plan_id, output_state,
      user_summary, system_result, trace_id
    )
    VALUES (
      $1, $2, 'open', 1, $3, $4, 'provisional',
      $5, $6::jsonb, $7
    )
    `, [input.tenantId, input.scope, input.taskRequestId, input.taskPlanId, input.userSummary, JSON.stringify(input.systemResult), input.traceId]);
}
export async function getTaskStepById(stepId) {
    const pool = getPool();
    const result = await pool.query("SELECT * FROM task_step WHERE id = $1", [stepId]);
    return result.rows[0] ?? null;
}
export async function updateTaskStepStatus(input) {
    const pool = getPool();
    await pool.query(`
    UPDATE task_step
    SET status = $2::task_step_status,
        assigned_capability_id = COALESCE($3, assigned_capability_id),
        updated_at = now()
    WHERE id = $1
    `, [input.taskStepId, input.status, input.assignedCapabilityId ?? null]);
}
export async function updateTaskResultState(input) {
    const pool = getPool();
    await pool.query(`
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
    `, [
        input.taskPlanId,
        input.outputState,
        input.status ?? null,
        input.finalStepId ?? null,
        input.systemResult ? JSON.stringify(input.systemResult) : null
    ]);
}
//# sourceMappingURL=task.js.map
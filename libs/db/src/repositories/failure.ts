import { getPool } from "../pool.js";

export async function createFailureEvent(input: {
  tenantId: string;
  scope: string;
  taskRequestId: string;
  taskPlanId: string;
  taskStepId?: string | null;
  failureCode: string;
  failureClass: string;
  errorSignature: string;
  dependencyId?: string | null;
  retryable: boolean;
  severity: number;
  verifierPhase?: string | null;
  detailPayload: Record<string, unknown>;
  traceId: string;
}): Promise<string> {
  const pool = getPool();
  const result = await pool.query<{ id: string }>(
    `
    INSERT INTO failure_event (
      tenant_id, scope, status, version, task_request_id, task_plan_id, task_step_id,
      failure_code, failure_class, error_signature, dependency_id, retryable, severity,
      verifier_phase, detail_payload, trace_id
    )
    VALUES (
      $1, $2, 'active', 1, $3, $4, $5,
      $6, $7, $8, $9, $10, $11,
      $12::verification_phase, $13::jsonb, $14
    )
    RETURNING id
    `,
    [
      input.tenantId,
      input.scope,
      input.taskRequestId,
      input.taskPlanId,
      input.taskStepId ?? null,
      input.failureCode,
      input.failureClass,
      input.errorSignature,
      input.dependencyId ?? null,
      input.retryable,
      input.severity,
      input.verifierPhase ?? null,
      JSON.stringify(input.detailPayload),
      input.traceId
    ]
  );

  return result.rows[0].id;
}


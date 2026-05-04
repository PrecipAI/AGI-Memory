import { getPool } from "../pool.js";

function toJson(value: unknown): string {
  return JSON.stringify(value ?? {});
}

export async function createMessage(input: {
  tenantId: string;
  scope: string;
  taskRequestId: string;
  role: string;
  content: string;
  normalizedContent?: string | null;
  messageType?: string;
  metadata?: Record<string, unknown>;
  traceId: string;
}): Promise<string> {
  const pool = getPool();
  const result = await pool.query<{ id: string }>(
    `
    INSERT INTO message (
      tenant_id, scope, status, version, task_request_id, role, content, normalized_content,
      message_type, metadata, trace_id
    )
    VALUES (
      $1, $2, 'active', 1, $3, $4, $5, $6,
      $7, $8::jsonb, $9
    )
    RETURNING id
    `,
    [
      input.tenantId,
      input.scope,
      input.taskRequestId,
      input.role,
      input.content,
      input.normalizedContent ?? input.content.toLowerCase(),
      input.messageType ?? "user_input",
      toJson(input.metadata),
      input.traceId
    ]
  );
  return result.rows[0].id;
}

export async function ensureTaskRun(input: {
  tenantId: string;
  scope: string;
  taskRequestId: string;
  goal: string;
  runStatus?: string;
  recoveryState?: Record<string, unknown>;
  traceId: string;
}): Promise<string> {
  const pool = getPool();
  const existing = await pool.query<{ id: string }>("SELECT id FROM task_run WHERE task_request_id = $1", [input.taskRequestId]);
  if (existing.rowCount && existing.rows[0]) {
    await pool.query(
      `
      UPDATE task_run
      SET goal = $2,
          run_status = $3::task_run_status,
          recovery_state = $4::jsonb,
          updated_at = now()
      WHERE id = $1
      `,
      [existing.rows[0].id, input.goal, input.runStatus ?? "running", toJson(input.recoveryState)]
    );
    return existing.rows[0].id;
  }

  const result = await pool.query<{ id: string }>(
    `
    INSERT INTO task_run (
      tenant_id, scope, status, version, task_request_id, run_status, goal,
      started_at, recovery_state, trace_id
    )
    VALUES (
      $1, $2, 'active', 1, $3, $4::task_run_status, $5,
      now(), $6::jsonb, $7
    )
    RETURNING id
    `,
    [input.tenantId, input.scope, input.taskRequestId, input.runStatus ?? "running", input.goal, toJson(input.recoveryState), input.traceId]
  );
  return result.rows[0].id;
}

export async function createArtifact(input: {
  tenantId: string;
  scope: string;
  taskRequestId: string;
  taskStepId?: string | null;
  artifactType: string;
  artifactTag?: string | null;
  content?: string | null;
  structuredPayload?: Record<string, unknown>;
  verificationStatus?: string | null;
  sideEffectClass?: string | null;
  sourceRef?: string | null;
  traceId: string;
}): Promise<string> {
  const pool = getPool();
  const result = await pool.query<{ id: string }>(
    `
    INSERT INTO artifact (
      tenant_id, scope, status, version, task_request_id, task_step_id, artifact_type, artifact_tag,
      content, structured_payload, verification_status, side_effect_class, source_ref, trace_id
    )
    VALUES (
      $1, $2, 'active', 1, $3, $4, $5, $6,
      $7, $8::jsonb, $9, $10::side_effect_class, $11, $12
    )
    RETURNING id
    `,
    [
      input.tenantId,
      input.scope,
      input.taskRequestId,
      input.taskStepId ?? null,
      input.artifactType,
      input.artifactTag ?? null,
      input.content ?? null,
      toJson(input.structuredPayload),
      input.verificationStatus ?? null,
      input.sideEffectClass ?? "none",
      input.sourceRef ?? null,
      input.traceId
    ]
  );
  return result.rows[0].id;
}

export async function listMessagesByTaskRequest(taskRequestId: string): Promise<Record<string, unknown>[]> {
  const pool = getPool();
  const result = await pool.query(
    `
    SELECT *
    FROM message
    WHERE task_request_id = $1
      AND status = 'active'
    ORDER BY created_at
    `,
    [taskRequestId]
  );
  return result.rows;
}

export async function getTaskRunByTaskRequest(taskRequestId: string): Promise<Record<string, unknown> | null> {
  const pool = getPool();
  const result = await pool.query("SELECT * FROM task_run WHERE task_request_id = $1", [taskRequestId]);
  return result.rows[0] ?? null;
}

export async function listArtifactsByTaskRequest(taskRequestId: string): Promise<Record<string, unknown>[]> {
  const pool = getPool();
  const result = await pool.query(
    `
    SELECT *
    FROM artifact
    WHERE task_request_id = $1
      AND status = 'active'
    ORDER BY created_at
    `,
    [taskRequestId]
  );
  return result.rows;
}

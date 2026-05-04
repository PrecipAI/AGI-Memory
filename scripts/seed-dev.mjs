import pg from "pg";

const { Pool } = pg;
const tenantId = process.env.DEFAULT_TENANT_ID || "tenant-local";
const scope = process.env.DEFAULT_SCOPE || "memory.validation";
const fingerprint = process.env.DEFAULT_MEMORY_FINGERPRINT || "local-dev-v1";
const capabilityScopes = [...new Set([scope, "support.ticketing"])];

const pool = new Pool({
  connectionString: process.env.DB_URL || "postgresql://postgres:postgres@127.0.0.1:55432/super_agent_system"
});

try {
  await pool.query("BEGIN");

  for (const capabilityScope of capabilityScopes) {
    await pool.query(
      `
      INSERT INTO capability_registry (
        tenant_id, scope, status, version, capability_key, capability_type, display_name,
        endpoint_ref, task_types, risk_level, fingerprint_requirement, approval_mode,
        input_schema_ref, output_schema_ref, metadata, trace_id
      )
      VALUES (
        $1, $2, 'active', 1, 'mock.ticket.create', 'mock', 'Mock Ticket Create',
        'mock://ticket/create', ARRAY['effectful_demo'], 'low', NULL, 'none',
        '#/components/schemas/DispatchRequest', '#/components/schemas/DispatchResponse',
        '{"owner":"seed-dev","mock":true}', 'seed-dev-trace'
      )
      ON CONFLICT (tenant_id, scope, capability_key, version) DO UPDATE
      SET endpoint_ref = EXCLUDED.endpoint_ref,
          metadata = EXCLUDED.metadata,
          updated_at = now()
      `,
      [tenantId, capabilityScope]
    );
  }

  await pool.query(
    `
    INSERT INTO environment_fingerprint (
      tenant_id, scope, status, version, fingerprint_key, capability_version, config_hash,
      schema_version, dependency_signature, deployment_baseline_id, trace_id
    )
    VALUES (
      $1, $2, 'active', 1, $3, 'seed-v1', 'local-dev-config',
      'memory-v3', 'mock-ticket-api', 'local-baseline', 'seed-dev-trace'
    )
    ON CONFLICT (tenant_id, scope, fingerprint_key) DO UPDATE
    SET status = EXCLUDED.status,
        capability_version = EXCLUDED.capability_version,
        config_hash = EXCLUDED.config_hash,
        schema_version = EXCLUDED.schema_version,
        dependency_signature = EXCLUDED.dependency_signature,
        deployment_baseline_id = EXCLUDED.deployment_baseline_id,
        updated_at = now()
    `,
    [tenantId, scope, fingerprint]
  );

  await pool.query("DELETE FROM memory_access_log WHERE tenant_id = $1 AND scope = $2", [tenantId, scope]);
  await pool.query("DELETE FROM resident_snapshot WHERE tenant_id = $1 AND scope = $2", [tenantId, scope]);
  await pool.query("DELETE FROM governance_change_proposal WHERE tenant_id = $1 AND scope = $2", [tenantId, scope]);
  await pool.query("DELETE FROM rule_conflict WHERE tenant_id = $1 AND scope = $2", [tenantId, scope]);
  await pool.query("DELETE FROM rule WHERE tenant_id = $1 AND scope = $2", [tenantId, scope]);
  await pool.query("DELETE FROM skill WHERE tenant_id = $1 AND scope = $2", [tenantId, scope]);
  await pool.query("DELETE FROM memory WHERE tenant_id = $1 AND scope = $2", [tenantId, scope]);
  await pool.query("DELETE FROM conversation_summary WHERE tenant_id = $1 AND scope = $2", [tenantId, scope]);
  await pool.query("DELETE FROM memory_candidate WHERE tenant_id = $1 AND scope = $2", [tenantId, scope]);

  const factualSla = await pool.query(
    `
    INSERT INTO memory (
      tenant_id, scope, status, version, memory_type, title, content, normalized_content,
      source_kind, source_ref, verification_status, fingerprint_requirement, tags, metadata,
      importance, confidence_score, trace_id
    )
    VALUES (
      $1, $2, 'active', 1, 'factual', 'Support SLA',
      'P1 incidents require acknowledgement within 15 minutes and status update every 30 minutes.',
      'p1 incidents require acknowledgement within 15 minutes and status update every 30 minutes.',
      'seed', 'seed://memory/factual/product-sla', 'verified', NULL, ARRAY['sla','support'],
      '{"domain":"support","seed":true}'::jsonb, 95, 0.990, 'seed-dev-trace'
    )
    RETURNING id
    `,
    [tenantId, scope]
  );

  const factualEscalation = await pool.query(
    `
    INSERT INTO memory (
      tenant_id, scope, status, version, memory_type, title, content, normalized_content,
      source_kind, source_ref, verification_status, fingerprint_requirement, tags, metadata,
      importance, confidence_score, trace_id
    )
    VALUES (
      $1, $2, 'active', 1, 'factual', 'Escalation policy',
      'If a blocker lasts more than 20 minutes, notify the incident channel and assign an owner immediately.',
      'if a blocker lasts more than 20 minutes notify the incident channel and assign an owner immediately.',
      'seed', 'seed://memory/factual/escalation-policy', 'verified', NULL, ARRAY['policy','incident'],
      '{"domain":"support","seed":true}'::jsonb, 88, 0.970, 'seed-dev-trace'
    )
    RETURNING id
    `,
    [tenantId, scope]
  );

  const skillResult = await pool.query(
    `
    INSERT INTO skill (
      tenant_id, scope, status, version, skill_key, title, description, skill_type,
      trigger_conditions, procedure_payload, verification_status, fingerprint_requirement,
      risk_level, success_rate, tags, trace_id
    )
    VALUES (
      $1, $2, 'active', 1, 'triage-ticket-v1', 'Ticket triage', 'Single-tenant validation flow for support triage',
      'procedure', '{"task_type":"effectful_demo"}'::jsonb,
      '{"steps":["collect_facts","classify","resolve_capability"],"workflow":"standard_path"}'::jsonb, 'verified', $3,
      'low', 98.50, ARRAY['support','triage'], 'seed-dev-trace'
    )
    RETURNING id
    `,
    [tenantId, scope, fingerprint]
  );

  await pool.query(
    `
    INSERT INTO resident_snapshot (
      tenant_id, scope, status, version, snapshot_key, snapshot_payload,
      source_memory_ids, source_skill_ids, dirty_reason, trace_id
    )
    VALUES (
      $1, $2, 'active', 1, 'memory-validation-resident',
      jsonb_build_object(
        'tenant_mode', 'single-tenant-validation',
        'default_scope', $2::text,
        'preferred_fingerprint', $3::text,
        'notes', jsonb_build_array(
          'use factual memory for stable policy facts',
          'only return procedural memory when fingerprint matches'
        )
      ),
      ARRAY[$4::uuid, $5::uuid],
      ARRAY[$6::uuid],
      NULL,
      'seed-dev-trace'
    )
    `,
    [tenantId, scope, fingerprint, factualSla.rows[0].id, factualEscalation.rows[0].id, skillResult.rows[0].id]
  );

  await pool.query("COMMIT");
  console.log(`seeded capability_registry, environment_fingerprint and memory demo data for ${tenantId}/${scope}`);
} catch (error) {
  await pool.query("ROLLBACK");
  throw error;
} finally {
  await pool.end();
}

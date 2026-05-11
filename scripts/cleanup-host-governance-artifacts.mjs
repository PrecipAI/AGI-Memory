import { getPool } from "../libs/db/dist/pool.js";

const tenantId = process.env.TENANT_ID || "tenant-local";
const scope = process.env.MEMORY_SCOPE || "memory.validation";
const host = process.env.HOST_CAPTURE_HOST || null;
const pool = getPool();

const params = host ? [tenantId, scope, host] : [tenantId, scope];
const hostFilter = host ? "AND host = $3" : "";
const jsonHostFilter = host ? "AND assembly_trace->>'host' = $3" : "AND assembly_trace ? 'host'";
const proposalHostFilter = host ? "AND proposed_payload->>'host' = $3" : "AND proposed_payload ? 'host'";
const ruleHostFilter = host ? "AND metadata->>'host' = $3" : "AND (metadata ? 'host' OR trigger_conditions->>'source' = 'host_capture')";
const memoryHostFilter = host
  ? "AND (metadata->>'host' = $3 OR tags @> ARRAY[$3]::text[])"
  : "AND (tags @> ARRAY['host-capture']::text[] OR metadata ? 'source_session_file' OR source_ref LIKE '%#%_message@%')";

async function deleteCount(name, sql, values) {
  const result = await pool.query(sql, values);
  return { name, count: result.rowCount ?? 0 };
}

try {
  await pool.query("BEGIN");
  const counts = [];

  counts.push(await deleteCount(
    "governance_change_proposal",
    `
    DELETE FROM governance_change_proposal
    WHERE tenant_id = $1
      AND scope = $2
      AND (
        ${proposalHostFilter.replace(/^AND /, "")}
        OR source_ref LIKE '%sessions%'
        OR proposed_action = 'skill_update_proposal'
      )
    `,
    params
  ));

  counts.push(await deleteCount(
    "kp_synthesized_knowledge_evidence",
    `
    DELETE FROM kp_synthesized_knowledge_evidence ske
    USING kp_synthesized_knowledge sk
    WHERE ske.tenant_id = $1
      AND ske.scope = $2
      AND sk.id = ske.synthesized_knowledge_id
      AND sk.tenant_id = ske.tenant_id
      AND sk.scope = ske.scope
      AND (
        sk.knowledge_type = 'execution_derived_knowledge'
        OR sk.metadata ? 'source_session_file'
        OR sk.metadata->>'host' IS NOT NULL
      )
    `,
    params.slice(0, 2)
  ));

  counts.push(await deleteCount(
    "kp_synthesized_knowledge",
    `
    DELETE FROM kp_synthesized_knowledge
    WHERE tenant_id = $1
      AND scope = $2
      AND (
        knowledge_type = 'execution_derived_knowledge'
        OR metadata ? 'source_session_file'
        OR metadata->>'host' IS NOT NULL
      )
    `,
    params.slice(0, 2)
  ));

  counts.push(await deleteCount(
    "kp_context_bundle",
    `
    DELETE FROM kp_context_bundle
    WHERE tenant_id = $1
      AND scope = $2
      AND (
        bundle_type LIKE '%host_capture%'
        OR bundle_type = 'governance_evidence_bundle'
        OR ${jsonHostFilter.replace(/^AND /, "")}
      )
    `,
    params
  ));

  counts.push(await deleteCount(
    "rule",
    `
    DELETE FROM rule
    WHERE tenant_id = $1
      AND scope = $2
      ${ruleHostFilter}
    `,
    params
  ));

  counts.push(await deleteCount(
    "memory",
    `
    DELETE FROM memory
    WHERE tenant_id = $1
      AND scope = $2
      ${memoryHostFilter}
    `,
    params
  ));

  counts.push(await deleteCount(
    "memory_candidate",
    `
    DELETE FROM memory_candidate
    WHERE tenant_id = $1
      AND scope = $2
      AND (
        source_type LIKE '%host_capture'
        OR source_type LIKE '%host-capture%'
        OR candidate_payload ? 'host'
        OR candidate_payload ? 'session_file'
      )
    `,
    params.slice(0, 2)
  ));

  counts.push(await deleteCount(
    "host_governance_event",
    `
    DELETE FROM host_governance_event
    WHERE tenant_id = $1
      AND scope = $2
      ${hostFilter}
    `,
    params
  ));

  await pool.query("COMMIT");
  process.stdout.write(`${JSON.stringify({ tenant_id: tenantId, scope, host, deleted: counts }, null, 2)}\n`);
} catch (error) {
  await pool.query("ROLLBACK").catch(() => undefined);
  throw error;
} finally {
  await pool.end();
}

import { getPool } from "../libs/db/dist/pool.js";

const pool = getPool();

try {
  const tables = [
    { name: "memory", sql: `SELECT tenant_id, scope, id, title, memory_type, availability_scope, origin_scope, status, metadata FROM memory ORDER BY tenant_id, scope, created_at DESC` },
    { name: "memory_candidate", sql: `SELECT tenant_id, scope, id, source_type, status, source_ref, candidate_payload, created_at FROM memory_candidate ORDER BY tenant_id, scope, created_at DESC` },
    { name: "resident_snapshot", sql: `SELECT tenant_id, scope, id, status, generated_at, source_memory_ids, created_at FROM resident_snapshot ORDER BY tenant_id, scope, created_at DESC` },
    { name: "skill", sql: `SELECT tenant_id, scope, id, title, skill_key, availability_scope, origin_scope, status, procedure_payload FROM skill ORDER BY tenant_id, scope, created_at DESC` },
    { name: "rule", sql: `SELECT tenant_id, scope, id, title, rule_key, availability_scope, origin_scope, status, metadata FROM rule ORDER BY tenant_id, scope, created_at DESC` }
  ];
  for (const { name, sql } of tables) {
    console.log(`\n=== ${name} ===`);
    const res = await pool.query(sql);
    console.log(JSON.stringify(res.rows, null, 2));
  }
} finally {
  await pool.end();
}

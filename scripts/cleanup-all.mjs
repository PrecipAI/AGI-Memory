import { getPool } from "../libs/db/dist/pool.js";

const pool = getPool();

const targetTables = [
  "memory_access_log",
  "kp_synthesized_knowledge_evidence",
  "kp_synthesized_knowledge",
  "kp_context_bundle",
  "kp_evidence",
  "kp_fact",
  "kp_relation",
  "kp_entity",
  "kp_section",
  "kp_document",
  "kp_governance_job",
  "kp_governance_decision",
  "memory_candidate_link",
  "memory_candidate",
  "resident_snapshot",
  "conversation_summary",
  "governance_change_proposal",
  "host_governance_event",
  "rule",
  "skill",
  "memory"
];

try {
  const existingResult = await pool.query(
    `SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename = ANY($1)`,
    [targetTables]
  );
  const existingTables = existingResult.rows.map((r) => r.tablename);

  await pool.query("BEGIN");
  const counts = [];
  for (const table of existingTables) {
    const result = await pool.query(`DELETE FROM ${table}`);
    counts.push({ table, count: result.rowCount ?? 0 });
  }
  await pool.query("COMMIT");
  process.stdout.write(`${JSON.stringify({ deleted: counts }, null, 2)}\n`);
} catch (error) {
  await pool.query("ROLLBACK").catch(() => undefined);
  console.error(error);
  process.exit(1);
} finally {
  await pool.end();
}

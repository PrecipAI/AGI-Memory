import pg from "pg";
const { Pool } = pg;

const pool = new Pool({
  connectionString: "postgresql://postgres:postgres@127.0.0.1:15432/super_agent_system"
});

const result = await pool.query(
  `SELECT id, skill_key, title, scope, origin_scope, availability_scope,
          procedure_payload -> 'host_action' AS host_action
   FROM skill
   WHERE tenant_id = 'tenant-local' AND status = 'active'
   ORDER BY created_at DESC`
);
console.table(result.rows);
await pool.end();

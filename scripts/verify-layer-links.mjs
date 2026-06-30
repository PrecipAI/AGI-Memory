import pg from "pg";

const pool = new pg.Pool({
  connectionString: "postgresql://postgres:postgres@127.0.0.1:15432/super_agent_system",
});

const r = await pool.query(
  "SELECT column_name, data_type FROM information_schema.columns WHERE table_name='layer_links' ORDER BY ordinal_position"
);
console.log("=== layer_links 表结构 ===");
console.table(r.rows);

const idx = await pool.query(
  "SELECT indexname, indexdef FROM pg_indexes WHERE tablename='layer_links'"
);
console.log("=== layer_links 索引 ===");
console.table(idx.rows);

await pool.end();

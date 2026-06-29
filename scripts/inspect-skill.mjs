import pg from "pg";
const { Pool } = pg;

const pool = new Pool({
  connectionString: "postgresql://postgres:postgres@127.0.0.1:15432/super_agent_system"
});

const result = await pool.query(
  `SELECT * FROM skill WHERE id = '2c846217-8f2f-428c-af39-9db281e84cc3'`
);
console.log(JSON.stringify(result.rows[0], null, 2));
await pool.end();

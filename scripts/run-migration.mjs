import fs from "node:fs/promises";
import path from "node:path";
import pg from "pg";

const { Pool } = pg;

const migrationDir = path.join(process.cwd(), "db", "migrations");
const database = process.env.PGDATABASE || "super_agent_system";
const host = process.env.PGHOST || "127.0.0.1";
const port = Number(process.env.PGPORT || "55432");
const user = process.env.PGUSER || "postgres";
const password = process.env.PGPASSWORD || "postgres";
const connectionString = process.env.DB_URL || `postgresql://${user}:${password}@${host}:${port}/${database}`;

const pool = new Pool({ connectionString });

async function runSql(sql, params) {
  await pool.query(sql, params);
}

async function runSqlFile(filePath) {
  const sql = await fs.readFile(filePath, "utf8");
  await runSql(sql);
}

async function main() {
  await runSql(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      filename text PRIMARY KEY,
      applied_at timestamptz NOT NULL DEFAULT now()
    );
  `);

  const baselineResult = await pool.query(`
    SELECT json_build_object(
      'has_task_request', EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'task_request'),
      'has_message', EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'message')
    )::text AS baseline
  `);
  const baseline = JSON.parse(baselineResult.rows[0]?.baseline || "{}");

  if (baseline.has_task_request) {
    await runSql("INSERT INTO schema_migrations (filename) VALUES ('0001_launch_spec_v1_p1.sql') ON CONFLICT DO NOTHING;");
  }
  if (baseline.has_message) {
    await runSql("INSERT INTO schema_migrations (filename) VALUES ('0002_memory_system_v3_extension.sql') ON CONFLICT DO NOTHING;");
  }

  const appliedResult = await pool.query("SELECT filename FROM schema_migrations ORDER BY filename");
  const applied = new Set(appliedResult.rows.map((row) => row.filename));

  const migrationFiles = (await fs.readdir(migrationDir))
    .filter((file) => file.endsWith(".sql"))
    .sort((left, right) => left.localeCompare(right, "en"));

  for (const migrationFile of migrationFiles) {
    if (applied.has(migrationFile)) {
      continue;
    }

    const migrationPath = path.join(migrationDir, migrationFile);
    await runSqlFile(migrationPath);
    await runSql(`INSERT INTO schema_migrations (filename) VALUES ($1) ON CONFLICT DO NOTHING`, [migrationFile]);
    applied.add(migrationFile);
  }
}

try {
  await main();
} catch (error) {
  console.error(error);
  process.exit(1);
} finally {
  await pool.end();
}

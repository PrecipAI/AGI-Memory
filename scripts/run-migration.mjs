import fs from "node:fs/promises";
import path from "node:path";
import { spawnSync } from "node:child_process";

const defaultPsqlPath = "C:\\Program Files\\PostgreSQL\\16\\bin\\psql.exe";
const psqlPath = process.env.PSQL_PATH || defaultPsqlPath;
const migrationDir = path.join(process.cwd(), "db", "migrations");
const database = process.env.PGDATABASE || "super_agent_system";
const host = process.env.PGHOST || "127.0.0.1";
const port = process.env.PGPORT || "55432";
const user = process.env.PGUSER || "postgres";

function runPsql(args) {
  const result = spawnSync(psqlPath, ["-U", user, "-h", host, "-p", port, "-d", database, "-v", "ON_ERROR_STOP=1", ...args], {
    encoding: "utf8",
    env: {
      ...process.env,
      PGPASSWORD: process.env.PGPASSWORD || "postgres"
    }
  });
  if (result.status !== 0) {
    process.stderr.write(result.stderr ?? "");
    process.stdout.write(result.stdout ?? "");
    process.exit(result.status ?? 1);
  }
  return result.stdout ?? "";
}

runPsql([
  "-c",
  `
  CREATE TABLE IF NOT EXISTS schema_migrations (
    filename text PRIMARY KEY,
    applied_at timestamptz NOT NULL DEFAULT now()
  );
  `
]);

const knownBaseline = runPsql([
  "-t",
  "-A",
  "-c",
  `
  SELECT json_build_object(
    'has_task_request', EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'task_request'),
    'has_message', EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'message')
  )::text
  `
]).trim();

const baseline = JSON.parse(knownBaseline || "{}");
if (baseline.has_task_request) {
  runPsql(["-c", "INSERT INTO schema_migrations (filename) VALUES ('0001_launch_spec_v1_p1.sql') ON CONFLICT DO NOTHING;"]);
}
if (baseline.has_message) {
  runPsql(["-c", "INSERT INTO schema_migrations (filename) VALUES ('0002_memory_system_v3_extension.sql') ON CONFLICT DO NOTHING;"]);
}

const appliedRows = runPsql(["-t", "-A", "-c", "SELECT filename FROM schema_migrations ORDER BY filename"]);
const applied = new Set(
  appliedRows
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
);

const migrationFiles = (await fs.readdir(migrationDir))
  .filter((file) => file.endsWith(".sql"))
  .sort((left, right) => left.localeCompare(right, "en"));

for (const migrationFile of migrationFiles) {
  if (applied.has(migrationFile)) {
    continue;
  }

  const migrationPath = path.join(migrationDir, migrationFile);
  runPsql(["-f", migrationPath]);
  runPsql(["-c", `INSERT INTO schema_migrations (filename) VALUES ('${migrationFile.replace(/'/g, "''")}') ON CONFLICT DO NOTHING`]);
  applied.add(migrationFile);
}

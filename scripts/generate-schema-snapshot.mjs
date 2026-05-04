import fs from "node:fs/promises";
import path from "node:path";
import pg from "pg";

const { Pool } = pg;

const pool = new Pool({
  connectionString: process.env.DB_URL || "postgresql://postgres:postgres@127.0.0.1:55432/super_agent_system"
});

const [tables, columns, indexes, constraints, enums] = await Promise.all([
  pool.query("SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename"),
  pool.query(`
    SELECT table_name, column_name, data_type, is_nullable
    FROM information_schema.columns
    WHERE table_schema = 'public'
    ORDER BY table_name, ordinal_position
  `),
  pool.query(`
    SELECT tablename, indexname
    FROM pg_indexes
    WHERE schemaname = 'public'
    ORDER BY tablename, indexname
  `),
  pool.query(`
    SELECT conrelid::regclass::text AS table_name, conname, contype
    FROM pg_constraint
    WHERE connamespace = 'public'::regnamespace
    ORDER BY conrelid::regclass::text, conname
  `),
  pool.query(`
    SELECT t.typname AS enum_name, string_agg(e.enumlabel, ', ' ORDER BY e.enumsortorder) AS values
    FROM pg_type t
    JOIN pg_enum e ON t.oid = e.enumtypid
    JOIN pg_namespace n ON n.oid = t.typnamespace
    WHERE n.nspname = 'public'
    GROUP BY t.typname
    ORDER BY t.typname
  `)
]);

await pool.end();

const groupedColumns = Object.groupBy(columns.rows, (row) => row.table_name);
const groupedIndexes = Object.groupBy(indexes.rows, (row) => row.tablename);
const groupedConstraints = Object.groupBy(constraints.rows, (row) => row.table_name);

let md = "# Schema Snapshot\n\n";
md += `- generated_at: ${new Date().toISOString()}\n`;
md += `- database: ${process.env.PGDATABASE || "super_agent_system"}\n`;
md += `- host: ${process.env.PGHOST || "127.0.0.1"}:${process.env.PGPORT || "55432"}\n\n`;

md += "## Tables\n\n";
for (const row of tables.rows) {
  md += `- \`${row.tablename}\`\n`;
}

md += "\n## Enum Types\n\n";
for (const row of enums.rows) {
  md += `- \`${row.enum_name}\`: ${row.values}\n`;
}

md += "\n## Columns\n\n";
for (const row of tables.rows) {
  md += `### \`${row.tablename}\`\n\n`;
  md += "| column | data_type | nullable |\n";
  md += "|---|---|---|\n";
  for (const column of groupedColumns[row.tablename] || []) {
    md += `| \`${column.column_name}\` | \`${column.data_type}\` | \`${column.is_nullable}\` |\n`;
  }
  md += "\n";
}

md += "## Indexes\n\n";
for (const row of tables.rows) {
  md += `### \`${row.tablename}\`\n\n`;
  for (const index of groupedIndexes[row.tablename] || []) {
    md += `- \`${index.indexname}\`\n`;
  }
  md += "\n";
}

md += "## Constraints\n\n";
for (const row of tables.rows) {
  md += `### \`${row.tablename}\`\n\n`;
  for (const constraint of groupedConstraints[row.tablename] || []) {
    md += `- \`${constraint.conname}\` (\`${constraint.contype}\`)\n`;
  }
  md += "\n";
}

const outPath = path.join(process.cwd(), "db", "schema.snapshot.md");
await fs.writeFile(outPath, md, "utf8");
console.log(`wrote ${outPath}`);

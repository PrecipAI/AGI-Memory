// 精准清理某次 trae 会话抽取的所有产物。
// 按 source_session_file 过滤，不误伤别的 session 数据。
// 默认 dry-run，加 --force 才真删。
import pg from "pg";

const { Pool } = pg;
const pool = new Pool({
  connectionString:
    process.env.DB_URL ||
    "postgresql://postgres:postgres@127.0.0.1:15432/super_agent_system"
});

const FORCE = process.argv.includes("--force");
const SESSION_PATTERN = "%session_memory_6a33c28204f976c904ff0636%";

// 各表查找这次 session 产物的 SQL（SELECT 版，用于 dry-run 和确认）
const queries = [
  {
    table: "rule (needs_review 完整 metadata + session 匹配)",
    sql: `SELECT id, rule_key, title, promotion_status, metadata
          FROM rule
          WHERE promotion_status = 'needs_review'
             OR metadata->>'source_session_file' LIKE $1
          ORDER BY created_at DESC`,
    deleteSql: `DELETE FROM rule WHERE rule_key = 'host-rule-6f9f6289535a'`
  },
  {
    table: "memory",
    sql: `SELECT id, title, memory_type, status, metadata->>'source_session_file' AS session_file,
                 metadata->>'candidate_id' AS candidate_id
          FROM memory
          WHERE metadata->>'source_session_file' LIKE $1`,
    deleteSql: `DELETE FROM memory WHERE metadata->>'source_session_file' LIKE $1`
  },
  {
    table: "memory_candidate",
    sql: `SELECT id, source_type, status, source_ref,
                 candidate_payload->>'session_file' AS session_file
          FROM memory_candidate
          WHERE candidate_payload->>'session_file' LIKE $1
             OR source_ref LIKE $1`,
    deleteSql: `DELETE FROM memory_candidate WHERE candidate_payload->>'session_file' LIKE $1
                 OR source_ref LIKE $1`
  },
  {
    table: "governance_change_proposal",
    sql: `SELECT id, proposed_action, status, source_ref,
                 proposed_payload->>'source_session_file' AS session_file
          FROM governance_change_proposal
          WHERE proposed_payload->>'source_session_file' LIKE $1
             OR source_ref LIKE $1`,
    deleteSql: `DELETE FROM governance_change_proposal
                 WHERE proposed_payload->>'source_session_file' LIKE $1
                    OR source_ref LIKE $1`
  },
  {
    table: "host_governance_event (最近 5 条，仅审计参考)",
    sql: `SELECT id, created_at FROM host_governance_event ORDER BY created_at DESC LIMIT 5`,
    deleteSql: null
  }
];

async function main() {
  console.log(`模式: ${FORCE ? "FORCE (真删)" : "DRY-RUN (只查不删)"}`);
  console.log(`session 过滤: ${SESSION_PATTERN}`);
  console.log("");

  const collected = [];
  for (const { table, sql, deleteSql } of queries) {
    const params = sql.includes("$1") ? [SESSION_PATTERN] : [];
    const res = await pool.query(sql, params);
    console.log(`=== ${table} (${res.rows.length} 条) ===`);
    for (const row of res.rows) {
      console.log(JSON.stringify(row));
      collected.push({ table, id: row.id });
    }
    console.log("");
  }

  if (collected.length === 0) {
    console.log("未找到这次 session 的任何产物，无需清理。");
    return;
  }

  if (!FORCE) {
    console.log(`>>> DRY-RUN: 共找到 ${collected.length} 条记录待删。`);
    console.log(">>> 加 --force 参数执行真删。");
    return;
  }

  // 真删：事务包裹
  try {
    await pool.query("BEGIN");
    for (const { table, deleteSql } of queries) {
      if (!deleteSql) {
        console.log(`SKIP ${table}: 无 deleteSql`);
        continue;
      }
      const params = deleteSql.includes("$1") ? [SESSION_PATTERN] : [];
      const res = await pool.query(deleteSql, params);
      console.log(`DELETE ${table}: ${res.rowCount} 行`);
    }
    await pool.query("COMMIT");
    console.log(">>> 清理完成。");
  } catch (err) {
    await pool.query("ROLLBACK").catch(() => undefined);
    throw err;
  }
}

main()
  .catch((err) => {
    console.error("失败:", err);
    process.exit(1);
  })
  .finally(() => pool.end());

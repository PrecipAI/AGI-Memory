// 删除指定 rule_key 的 rule + 相关 host_action
import pg from "pg";
const { Pool } = pg;
const pool = new Pool({
  connectionString: process.env.DB_URL || "postgresql://postgres:postgres@127.0.0.1:15432/super_agent_system"
});

const ruleKey = process.argv[2];
if (!ruleKey) {
  console.error("用法: node scripts/drop-rule.mjs <rule_key>");
  process.exit(2);
}

async function main() {
  // 查 rule
  const found = await pool.query(
    "SELECT id, rule_key, title, promotion_status, enforcement_level FROM rule WHERE rule_key = $1",
    [ruleKey]
  );
  if (found.rows.length === 0) {
    console.log(`未找到 rule_key=${ruleKey}`);
    return;
  }
  console.log("将删除:", JSON.stringify(found.rows[0], null, 2));

  // 删 host_action（外键可能引用，表名可能是 host_actions 或 host_action_queue）
  for (const tbl of ["host_actions", "host_action_queue", "host_action"]) {
    try {
      const r = await pool.query(`DELETE FROM ${tbl} WHERE payload->>'rule_key' = $1 RETURNING id`, [ruleKey]);
      if (r.rowCount > 0) console.log(`删除 ${tbl}: ${r.rowCount} 条`);
    } catch (e) {
      // 表不存在或列不存在，跳过
      if (!e.message.includes("does not exist") && !e.message.includes("does not exist")) throw e;
    }
  }

  // 删 rule
  const del = await pool.query(
    "DELETE FROM rule WHERE rule_key = $1 RETURNING id, rule_key",
    [ruleKey]
  );
  console.log(`删除 rule: ${del.rowCount} 条`);
}

main().catch(e => { console.error("FATAL:", e); process.exit(1); }).finally(() => pool.end());

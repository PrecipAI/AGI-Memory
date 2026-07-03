// 从 DB 读所有已审批 rule，用新 buildHookFile 重新生成 hook 文件
import { writeFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import pg from "pg";
import { buildHookFile } from "../services/memory-service/src/hostActionExecutor.ts";

const { Pool } = pg;

const pool = new Pool({
  connectionString: process.env.DB_URL
    || "postgresql://postgres:postgres@127.0.0.1:15432/super_agent_system"
});

const REPO_ROOT = path.resolve(import.meta.dirname, "..");
const GATES_DIR = path.join(REPO_ROOT, ".trae", "gates");

async function main() {
  // 查所有已审批通过的 rule（status=active 或 parked）
  const result = await pool.query(`
    SELECT id, rule_key, title, statement, enforcement_level,
           origin_scope, availability_scope, governance_level, promotion_status,
           rule_domain, rule_scope, applies_to, trigger_conditions, metadata
    FROM rule
    WHERE rule_key LIKE 'host-rule-%'
    ORDER BY created_at DESC
  `);

  console.log(`找到 ${result.rows.length} 条 rule，重新生成 hook...`);
  console.log();

  await mkdir(GATES_DIR, { recursive: true });

  let succeeded = 0;
  let failed = 0;

  for (const row of result.rows) {
    try {
      const payload = {
        rule_key: row.rule_key,
        rule_id: row.id,
        title: row.title,
        statement: row.statement,
        content: row.statement,
        enforcement_level: row.enforcement_level,
        origin_scope: row.origin_scope,
        availability_scope: row.availability_scope,
        governance_level: row.governance_level,
        promotion_status: row.promotion_status,
        rule_domain: row.rule_domain,
        rule_scope: row.rule_scope,
        applies_to: row.applies_to || ["coding", "review"],
        trigger_conditions: row.trigger_conditions || {}
      };

      const hookContent = buildHookFile(payload);
      const filePath = path.join(GATES_DIR, `${row.rule_key}.hook.ts`);
      await writeFile(filePath, hookContent, "utf8");

      // 从 hook 内容中提取生成的 category
      const categoryMatch = hookContent.match(/\/\/ Category: (\w+)/);
      const category = categoryMatch ? categoryMatch[1] : "unknown";
      const hasRealLogic = !hookContent.includes("return { action: \"PASS\" }");

      console.log(`✅ ${row.rule_key}`);
      console.log(`   title: ${row.title}`);
      console.log(`   category: ${category}`);
      console.log(`   有真实检查逻辑: ${hasRealLogic ? "是" : "否（generic）"}`);
      console.log(`   -> ${path.relative(REPO_ROOT, filePath)}`);
      console.log();

      succeeded++;
    } catch (e) {
      console.log(`❌ ${row.rule_key}: ${e.message}`);
      failed++;
    }
  }

  console.log(`===== 重生完成 =====`);
  console.log(`成功: ${succeeded}, 失败: ${failed}`);
  console.log(`目录: ${GATES_DIR}`);
}

main().catch(e => { console.error("FATAL:", e); process.exit(1); }).finally(() => pool.end());

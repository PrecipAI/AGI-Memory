/**
 * 一次性清理脚本：删除所有测试数据
 *
 * 用法：node services/memory-service/scripts/purge-test-data.js
 */
import fs from "node:fs";
import path from "node:path";

// 手动加载根目录 .env（避免依赖 dotenv 包）
const envPath = path.resolve(import.meta.dirname, "..", "..", "..", ".env");
if (fs.existsSync(envPath)) {
  const content = fs.readFileSync(envPath, "utf-8");
  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const idx = trimmed.indexOf("=");
    if (idx <= 0) continue;
    const key = trimmed.slice(0, idx).trim();
    const val = trimmed.slice(idx + 1).trim().replace(/^["']|["']$/g, "");
    if (!process.env[key]) process.env[key] = val;
  }
  console.log(`已加载 .env: DB_URL=${process.env.DB_URL?.replace(/:[^:@]+@/, ":***@")}`);
} else {
  console.warn(`未找到 .env: ${envPath}，将使用 @super-agent/db 默认配置`);
}

const { getPool } = await import("@super-agent/db");
const pool = getPool();

const tablesToCheck = [
  "memory_access_log",
  "memory",
  "memory_candidate",
  "governance_change_proposal",
  "rule_gate_audit",
  "rule_checkpoint",
  "rule_conflict",
  "rule",
  "skill",
  "kp_synthesized_knowledge_evidence",
  "kp_synthesized_knowledge",
  "kp_governance_cleaning_log",
  "kp_governance_decision",
  "kp_governance_job",
  "kp_relation",
  "kp_fact",
  "kp_entity",
  "kp_evidence",
  "kp_section",
  "kp_document"
];

console.log("\n=== 清理前数据规模 ===");
for (const t of tablesToCheck) {
  try {
    const r = await pool.query(`SELECT COUNT(*)::int AS cnt FROM ${t}`);
    if (r.rows[0].cnt > 0) console.log(`  ${t}: ${r.rows[0].cnt}`);
  } catch (e) {
    console.log(`  ${t}: 跳过 (${e.message.split("\n")[0]})`);
  }
}

console.log("\n=== 开始清理 ===");
const truncateGroups = [
  ["memory_access_log", "memory_candidate", "rule_gate_audit", "rule_checkpoint", "rule_conflict"],
  ["governance_change_proposal", "kp_governance_decision", "kp_governance_cleaning_log", "kp_governance_job"],
  ["kp_synthesized_knowledge_evidence", "kp_synthesized_knowledge"],
  ["kp_relation", "kp_fact", "kp_entity", "kp_evidence", "kp_section", "kp_document"],
  ["memory", "rule", "skill"]
];

for (const group of truncateGroups) {
  const sql = `TRUNCATE TABLE ${group.join(", ")} RESTART IDENTITY CASCADE;`;
  try {
    await pool.query(sql);
    console.log(`  ✓ TRUNCATE: ${group.join(", ")}`);
  } catch (e) {
    console.error(`  ✗ FAIL: ${group.join(", ")}`, e.message.split("\n")[0]);
  }
}

console.log("\n=== 清理后数据规模 ===");
let totalRemaining = 0;
for (const t of tablesToCheck) {
  try {
    const r = await pool.query(`SELECT COUNT(*)::int AS cnt FROM ${t}`);
    const cnt = r.rows[0].cnt;
    totalRemaining += cnt;
    if (cnt > 0) console.log(`  ${t}: ${cnt} (未清空!)`);
  } catch (e) {
    // 忽略
  }
}
if (totalRemaining === 0) {
  console.log("  全部清空 ✓");
} else {
  console.log(`  剩余总条数: ${totalRemaining}`);
}

await pool.end();
console.log("\n完成。");
process.exit(0);

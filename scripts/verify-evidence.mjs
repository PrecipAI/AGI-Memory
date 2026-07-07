// 验证新 memory 有没有证据链
import { readFileSync } from "node:fs";
import { getPool } from "../libs/db/src/pool.js";

const envContent = readFileSync(new URL("../.env", import.meta.url), "utf-8");
for (const line of envContent.split("\n")) {
  const m = line.match(/^([A-Z_]+)=(.*)$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
}

async function main() {
  const pool = getPool();

  // 查最近 5 条 memory 的证据链
  const memWithEvidence = await pool.query(
    `SELECT m.id, m.title,
            (SELECT COUNT(*) FROM evidence_links el WHERE el.target_id = m.id AND el.target_layer = 'memory' AND el.status = 'active') AS evidence_count
     FROM memory m
     WHERE m.tenant_id = $1 AND m.scope = $2 AND m.status = 'active'
     ORDER BY m.created_at DESC LIMIT 5`,
    ["tenant-local", "memory.validation"]
  );
  console.log("=== 最近 5 条 memory 证据链情况 ===");
  for (const r of memWithEvidence.rows) {
    console.log(`  [evidence=${r.evidence_count}] ${String(r.title).slice(0, 60)}`);
  }

  // 查最近 5 条 rule 的证据链
  const ruleWithEvidence = await pool.query(
    `SELECT r.id, r.title,
            (SELECT COUNT(*) FROM evidence_links el WHERE el.target_id = r.id AND el.target_layer = 'rule' AND el.status = 'active') AS evidence_count
     FROM rule r
     WHERE r.tenant_id = $1 AND r.scope = $2 AND r.status = 'active'
     ORDER BY r.created_at DESC LIMIT 5`,
    ["tenant-local", "memory.validation"]
  );
  console.log("\n=== 最近 5 条 rule 证据链情况 ===");
  for (const r of ruleWithEvidence.rows) {
    console.log(`  [evidence=${r.evidence_count}] ${String(r.title).slice(0, 60)}`);
  }

  // 查 evidence_links 表分布
  const elDist = await pool.query(
    `SELECT target_layer, link_type, COUNT(*)::int AS cnt
     FROM evidence_links WHERE tenant_id = $1 AND scope = $2 AND status = 'active'
     GROUP BY target_layer, link_type ORDER BY cnt DESC`,
    ["tenant-local", "memory.validation"]
  );
  console.log("\n=== evidence_links 表分布 ===");
  for (const r of elDist.rows) {
    console.log(`  target_layer=${r.target_layer} link_type=${r.link_type}: ${r.cnt} 条`);
  }

  // 查最近 5 条 memory 的 id,然后查 evidence_links 是否指向它们
  const recentMems = await pool.query(
    `SELECT id, title FROM memory WHERE tenant_id = $1 AND scope = $2 AND status = 'active'
     ORDER BY created_at DESC LIMIT 3`,
    ["tenant-local", "memory.validation"]
  );
  console.log("\n=== 最近 3 条 memory 的 evidence_links ===");
  for (const m of recentMems.rows) {
    const links = await pool.query(
      `SELECT el.id, el.target_layer, el.link_type, el.status, e.content_excerpt
       FROM evidence_links el
       LEFT JOIN kp_evidence e ON e.id = el.evidence_id
       WHERE el.target_id = $1 AND el.tenant_id = $2 AND el.scope = $3`,
      [m.id, "tenant-local", "memory.validation"]
    );
    console.log(`  memory: ${String(m.title).slice(0, 50)}`);
    if (links.rows.length === 0) {
      console.log(`    -> 0 evidence_links (无论 status)`);
    } else {
      for (const l of links.rows) {
        console.log(`    -> [${l.status}] ${l.link_type} | ${String(l.content_excerpt || "").slice(0, 60)}`);
      }
    }
  }

  // 查最近 5 条 evidence_links 的 target_id 和 status
  const recentLinks = await pool.query(
    `SELECT el.id, el.target_id, el.target_layer, el.link_type, el.status, el.created_at,
            m.title AS memory_title
       FROM evidence_links el
       LEFT JOIN memory m ON m.id = el.target_id
       WHERE el.tenant_id = $1 AND el.scope = $2
       ORDER BY el.created_at DESC LIMIT 5`,
    ["tenant-local", "memory.validation"]
  );
  console.log("\n=== 最近 5 条 evidence_links ===");
  for (const l of recentLinks.rows) {
    console.log(`  [${l.status}] ${l.link_type} -> ${l.target_layer} | target=${l.target_id} | memory=${l.memory_title ? String(l.memory_title).slice(0, 40) : "(not memory)"}`);
  }

  await pool.end();
}

main().catch(e => { console.error("FATAL:", e); process.exit(1); });

/**
 * 导入脚本：Graphify graph.json → PostgreSQL
 *
 * 把 Graphify 代码图谱导入 AGI-Memory 数据库：
 * - 节点 → kp_synthesized_knowledge 表（knowledge_type='project_structure'）
 * - 边 → layer_links 表（link_type='calls'/'imports' 等）
 *
 * 用法：node scripts/import-graphify-to-db.mjs [--graph <path>] [--project-id <id>]
 *   --graph      graph.json 路径（默认 graphify-out/graph.json）
 *   --project-id 项目 ID（默认自动从 git remote 提取）
 */

import fs from "node:fs/promises";
import path from "node:path";
import { execSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import pg from "pg";

const { Pool } = pg;

const args = process.argv.slice(2);
function getArg(name, defaultValue) {
  const idx = args.indexOf(`--${name}`);
  if (idx === -1 || idx + 1 >= args.length) return defaultValue;
  return args[idx + 1];
}

const GRAPH_PATH = getArg("graph", "graphify-out/graph.json");
const TENANT_ID = process.env.MEMORY_TENANT_ID || "tenant-local";
const SCOPE = process.env.MEMORY_SCOPE || "memory.validation";

function resolveProjectId() {
  // D2 决策：多级 fallback
  try {
    const remote = execSync("git remote get-url origin", { encoding: "utf8", stdio: "pipe" }).trim();
    // 从 git remote URL 提取项目标识
    // git@github.com:PrecipAI/AGI-Memory.git → agi-memory
    const match = remote.match(/[:/]([^/]+?)(\.git)?$/);
    if (match) return match[1].toLowerCase();
  } catch {}
  try {
    const pkg = JSON.parse(execSync("node -e \"console.log(JSON.stringify(require('./package.json').name))\"", { encoding: "utf8" }));
    if (pkg) return pkg;
  } catch {}
  return path.basename(process.cwd()).toLowerCase();
}

function getGitCommit() {
  try {
    return execSync("git rev-parse HEAD", { encoding: "utf8", stdio: "pipe" }).trim();
  } catch {
    return "unknown";
  }
}

function mapNodeType(graphifyNode) {
  // 从 Graphify 节点推断类型
  const label = graphifyNode.label || "";
  const fileType = graphifyNode.file_type || "code";

  // TypeScript/JavaScript 命名约定
  if (/^[A-Z]/.test(label) && !label.includes("(")) return "project_class";
  if (label.includes("()") || label.includes("(")) return "project_function";
  if (fileType === "module") return "project_module";
  if (fileType === "file") return "project_file";
  return "project_structure";
}

function mapLinkType(graphifyLink) {
  // 从 Graphify 边的 relation 推断 link_type
  const relation = graphifyLink.relation || "";
  const context = graphifyLink.context || "";

  if (relation === "calls" || relation === "invokes") return "calls";
  if (relation === "imports" || relation === "references") return "imports";
  if (relation === "belongs_to" || relation === "contains") return "belongs_to";
  if (relation === "depends_on" || relation === "requires") return "depends_on";
  // 默认：references 归类为 imports
  if (relation === "references") return "imports";
  return "imports";
}

async function main() {
  const projectId = resolveProjectId();
  const gitCommit = getGitCommit();
  const pool = new Pool({
    connectionString: "postgresql://postgres:postgres@127.0.0.1:15432/super_agent_system",
  });

  console.log(`[import] graph: ${GRAPH_PATH}`);
  console.log(`[import] project_id: ${projectId}`);
  console.log(`[import] git_commit: ${gitCommit}`);
  console.log(`[import] tenant_id: ${TENANT_ID}, scope: ${SCOPE}`);

  // 读 graph.json
  const raw = await fs.readFile(GRAPH_PATH, "utf8");
  const graph = JSON.parse(raw);
  const nodes = graph.nodes || [];
  const links = graph.links || [];
  console.log(`[import] graphify nodes: ${nodes.length}, links: ${links.length}`);

  // 清理旧数据（同 project_id 的 project_structure knowledge）
  await pool.query(
    `DELETE FROM kp_synthesized_knowledge
     WHERE tenant_id = $1 AND scope = $2
       AND knowledge_type = 'project_structure'`,
    [TENANT_ID, SCOPE],
  );
  // 清理旧边
  await pool.query(
    `DELETE FROM layer_links
     WHERE tenant_id = $1 AND scope = $2
       AND link_type IN ('calls','imports','belongs_to','depends_on')`,
    [TENANT_ID, SCOPE],
  );
  console.log(`[import] cleaned old project_structure data`);

  // 导入节点
  let nodeCount = 0;
  let nodeErrorCount = 0;
  let linkSkipCount = 0;
  const nodeIdMap = new Map(); // graphify node id → db uuid

  for (const node of nodes) {
    const dbId = randomUUID();
    nodeIdMap.set(node.id, dbId);

    const nodeType = mapNodeType(node);
    const title = node.label || node.id;
    const content = JSON.stringify({
      node_id: node.id,
      node_type: nodeType,
      label: node.label,
      source_file: node.source_file || "",
      source_location: node.source_location || "",
      file_type: node.file_type || "code",
      origin: node._origin || "ast",
      community: node.community ?? null,
      project_id: projectId,
      git_commit: gitCommit,
      graphify_built_at: graph.built_at_commit || "",
      last_updated: new Date().toISOString(),
    });
    const normalizedContent = `${node.id} ${node.label || ""} ${node.source_file || ""}`.toLowerCase().trim();

    try {
      await pool.query(
        `INSERT INTO kp_synthesized_knowledge (
          id, tenant_id, scope, status, version, memory_domain, lifecycle_state,
          review_state, recall_state, knowledge_type, title, content, normalized_content,
          source_object_ids, evidence_ids, reasoning_summary, confidence_score, risk_level,
          metadata, trace_id
        ) VALUES (
          $1, $2, $3, 'active', 1, 'knowledge', 'curated',
          'model_accepted', 'active', 'project_structure', $4, $5, $6,
          '[]'::jsonb, '[]'::jsonb, $7, 1.0, 'low',
          $8::jsonb, $9
        )`,
        [
          dbId,
          TENANT_ID,
          SCOPE,
          title,
          content,
          normalizedContent,
          `Graphify AST extracted node from ${node.source_file || "unknown"}`,
          JSON.stringify({ project_id: projectId, git_commit: gitCommit, node_type: nodeType }),
          `trace-graphify-import-${Date.now()}`,
        ],
      );
      nodeCount++;
    } catch (e) {
      // 单条节点失败不阻塞，但打印前 3 条错误便于诊断
      nodeErrorCount++;
      if (nodeErrorCount <= 3) {
        console.error(`[import] node insert failed #${nodeErrorCount}: ${e.message}`);
        console.error(`[import]   node.id=${node.id} label=${node.label}`);
      }
    }
  }
  console.log(`[import] imported ${nodeCount}/${nodes.length} nodes`);
  console.log(`[import] nodeIdMap size: ${nodeIdMap.size}`);

  // 导入边
  let linkCount = 0;
  for (const link of links) {
    const sourceDbId = nodeIdMap.get(link.source);
    const targetDbId = nodeIdMap.get(link.target);
    if (!sourceDbId || !targetDbId) continue;

    const linkType = mapLinkType(link);
    const traceId = `trace-graphify-link-${Date.now()}-${randomUUID().slice(0, 8)}`;

    try {
      await pool.query(
        `INSERT INTO layer_links (
          tenant_id, scope, status,
          source_id, source_layer,
          target_id, target_layer,
          link_type, confidence, trace_id
        ) VALUES (
          $1, $2, 'active',
          $3, 'knowledge',
          $4, 'knowledge',
          $5, 1.0, $6
        ) ON CONFLICT (source_id, target_id, link_type) DO NOTHING`,
        [TENANT_ID, SCOPE, sourceDbId, targetDbId, linkType, traceId],
      );
      linkCount++;
    } catch (e) {
      linkSkipCount++;
      // 打印前 3 条错误，避免刷屏
      if (linkSkipCount <= 3) {
        console.error(`[import] link insert failed #${linkSkipCount}: ${e.message}`);
        console.error(`[import]   source=${link.source} target=${link.target} type=${linkType} relation=${link.relation}`);
      }
    }
  }
  console.log(`[import] imported ${linkCount}/${links.length} links`);

  // 验证
  const countResult = await pool.query(
    `SELECT COUNT(*) as cnt FROM kp_synthesized_knowledge
     WHERE tenant_id = $1 AND scope = $2 AND knowledge_type = 'project_structure' AND status = 'active'`,
    [TENANT_ID, SCOPE],
  );
  const linkCountResult = await pool.query(
    `SELECT COUNT(*) as cnt FROM layer_links
     WHERE tenant_id = $1 AND scope = $2 AND status = 'active'
       AND link_type IN ('calls','imports','belongs_to','depends_on')`,
    [TENANT_ID, SCOPE],
  );
  console.log(`[import] verification:`);
  console.log(`  project_structure knowledge: ${countResult.rows[0].cnt} rows`);
  console.log(`  code graph links: ${linkCountResult.rows[0].cnt} rows`);

  await pool.end();
  console.log(`[import] done`);
}

main().catch(e => {
  console.error("[import] error:", e.message);
  process.exit(1);
});

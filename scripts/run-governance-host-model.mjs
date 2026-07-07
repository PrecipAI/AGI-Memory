// 手动构造 host_model_result 跑治理,生成 derived_from 跨层关系
// 用法: node scripts/run-governance-host-model.mjs
import { randomUUID } from "node:crypto";

const BASE = "http://127.0.0.1:3101";
const THREAD_ID = "6a4b05c81a36cf5b3af3238c"; // 本项目(agi-memory-src)的 trae 会话

async function main() {
  // Step 1: batch-preview 拿 preview_token
  console.log("[1/3] 调 batch-preview 拿 token...");
  const previewRes = await fetch(`${BASE}/internal/host-capture/trae/governance-batch-preview`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ thread_id: THREAD_ID, max_items: 50 })
  });
  if (!previewRes.ok) throw new Error(`preview failed: ${previewRes.status} ${await previewRes.text()}`);
  const preview = await previewRes.json();
  const tokenId = preview.preview_token.token_id;
  console.log(`  token=${tokenId} expires_at=${preview.preview_token.expires_at}`);

  // Step 2: 从 summary 内容抽取候选,构造 host_model_result
  // 必填字段:candidate_type, title, origin_scope, availability_scope, governance_level,
  //          promotion_status, source_kind, source_timestamp, source_excerpt, reason, confidence
  const now = new Date().toISOString();
  const common = {
    origin_scope: "global",
    availability_scope: "global_reusable",
    governance_level: "shared",
    promotion_status: "candidate",
    source_kind: "commentary",
    source_timestamp: now,
    confidence: "high"
  };

  const hostModelResult = {
    model_ref: "manual-extraction-v1",
    generated_at: now,
    extraction_preview: {
      memory_candidates: [
        {
          ...common,
          candidate_type: "memory_candidate",
          title: "trae host 对话原文存于加密 SQLCipher DB,只能通过 summary 访问",
          content: "trae 宿主的原始对话历史存储在加密 SQLCipher 数据库(C:\\Users\\[user]\\AppData\\Roaming\\TRAE SOLO CN\\ModularData\\ai-agent\\database.db),无法直接读取。host_capture 适配器只能使用宿主提供的 session summary(JSONL 格式),不能访问原始对话。summary 数据必须放入 commentary_messages 字段,不能放入 user_messages,否则 LLM 会把摘要当原话虚构候选。",
          source_excerpt: "[摘要·学到知识] trae host 的对话原文存于加密 SQLCipher DB,只能用 summary",
          memory_type: "project_memory",
          stability: "long_lived",
          reason: "这是 host_capture 适配器的核心约束,影响所有 trae 宿主治理运行的证据强度"
        },
        {
          ...common,
          candidate_type: "memory_candidate",
          title: "洋葱图 3D 效果依赖 ES module,file:// 协议下浏览器拒绝加载",
          content: "knowledgeGraphOnion.js 使用 <script type=\"module\"> 加载,在 file:// 协议下浏览器因 CORS 限制拒绝加载 ES module,导致 KnowledgeGraphOnion 类 undefined,代码自动 fallback 到 2D。必须通过 http://localhost:3101 访问才能正常渲染 3D 洋葱图。",
          source_excerpt: "[摘要·学到知识] 洋葱图无法显示3D效果是因file://协议下浏览器拒绝加载ES module导致KnowledgeGraphOnion类undefined",
          memory_type: "project_memory",
          stability: "stable",
          reason: "影响洋葱图可视化的可访问性,是常见环境问题"
        },
        {
          ...common,
          candidate_type: "memory_candidate",
          title: "版 C Anthropic Warm Editorial 设计语言:奶油纸底 + 赤陶橙 + Fraunces 衬线",
          content: "版 C 设计语言:奶油纸背景 #F5F0E8 + 赤陶橙主色 #CC785C + Fraunces 衬线字体 + Inter 正文 + 纵向叙事结构 + 罗马数字章节。洋葱图 Canvas 内部配色需融入版 C:星空背景改暖夜墨 #1A1814,节点/环线/关系色全部换成版 C 暖色系,但保留 4 层 glow / 呼吸动画 / evidence 流动粒子等核心特效。",
          source_excerpt: "[摘要·学到知识] C设计语言包含奶油纸背景、赤陶橙主色、特定字体组合等元素",
          memory_type: "design_decision",
          stability: "long_lived",
          reason: "项目前端设计的核心决策,影响所有页面改版"
        }
      ],
      rule_candidates: [
        {
          ...common,
          candidate_type: "rule_candidate",
          title: "ES module 脚本必须通过 http://localhost 提供,禁止用 file:// 协议访问",
          content: "使用 <script type=\"module\"> 加载的本地工具页面(如洋葱图)禁止用 file:// 协议直接打开,必须通过本地 HTTP 服务(http://localhost:port)提供,否则浏览器因 CORS 限制拒绝加载 ES module,导致运行时类 undefined 和静默 fallback。",
          source_excerpt: "[摘要·学到知识] 洋葱图无法显示3D效果是因file://协议下浏览器拒绝加载ES module",
          rule_domain: "tooling",
          violation_behavior: "warn",
          applies_to_phase: ["coding", "testing", "integration"],
          metadata: { human_readable_statement: "使用 ES module 加载的本地工具页面(如洋葱图)必须通过 http://localhost 提供,禁止用 file:// 协议直接打开,否则浏览器会因 CORS 限制拒绝加载,导致运行时类 undefined 和静默 fallback 到 2D。", classification_rationale: "这是约束性规则,因为它规定了 IF 使用 ES module 加载 THEN 必须通过 http://localhost 提供、禁止 file:// 协议,是必须/禁止的行为约束,而不是可复用的操作步骤。" },
          source_refs: [
            { source_kind: "user_message", source_timestamp: "2026-07-06T11:57:16Z", source_excerpt: "[摘要·用户意图] 用户询问洋葱图为何变成2D视图,并强调洋葱图是精髓,要求保留其3D效果" },
            { source_kind: "commentary", source_timestamp: "2026-07-06T11:57:16Z", source_excerpt: "[摘要·学到知识] 洋葱图无法显示3D效果是因file://协议下浏览器拒绝加载ES module导致KnowledgeGraphOnion类undefined" }
          ],
          reason: "防止 ES module 加载失败导致的静默 fallback 问题重复发生"
        },
        {
          ...common,
          candidate_type: "rule_candidate",
          title: "trae host_capture 必须把 summary 放 commentary_messages,禁止放 user_messages",
          content: "trae 宿主的 host_capture 适配器必须把 session summary 数据放入 commentary_messages 字段,禁止放入 user_messages。user_messages 只能是原始用户输入。违反此约束会导致 LLM 把摘要当原话,虚构 rule/memory 候选和证据链。",
          source_excerpt: "[摘要·学到知识] trae host_capture必须把summary放commentary_messages,不能放user_messages",
          rule_domain: "governance",
          violation_behavior: "block",
          applies_to_phase: ["governance"],
          metadata: { human_readable_statement: "trae 宿主的 host_capture 适配器必须把 session summary 数据放入 commentary_messages 字段,禁止放入 user_messages,否则 LLM 会把摘要当原话,虚构 rule/memory 候选和证据链。", classification_rationale: "这是约束性规则,因为它规定了 IF 处理 trae summary THEN 必须放入 commentary_messages、禁止放入 user_messages,是必须/禁止的行为约束,而不是可复用的操作步骤。" },
          source_refs: [
            { source_kind: "user_message", source_timestamp: "2026-07-06T10:54:44Z", source_excerpt: "[摘要·用户意图] 遇到切换 qoder host 仍默认 codex 目录的问题,要求排查" },
            { source_kind: "commentary", source_timestamp: "2026-07-06T10:54:44Z", source_excerpt: "[摘要·学到知识] trae host_capture必须把summary放commentary_messages,不能放user_messages,否则LLM会把摘要当原话虚构候选" }
          ],
          reason: "防止 LLM 从摘要描述性词汇虚构候选,污染治理证据链"
        }
      ],
      skill_proposal_candidates: [],
      knowledge_candidates: [],
      governance_evidence_candidates: [],
      // layer_links: 用候选数组 index 引用,持久化时替换为真实 id
      // rule[0] derived_from memory[1] — "ES module 禁止 file://" 规则的根因是 "洋葱图依赖 ES module" 这个事实
      // rule[1] derived_from memory[0] — "summary 放 commentary" 规则的根因是 "trae 加密 DB" 这个事实
      layer_links: [
        {
          source_layer: "rule",
          source_candidate_index: 0,
          target_layer: "memory",
          target_candidate_index: 1,
          link_type: "derived_from",
          confidence: 0.95,
          reason: "ES module 禁用 file:// 的规则,根因是洋葱图依赖 ES module 的事实"
        },
        {
          source_layer: "rule",
          source_candidate_index: 1,
          target_layer: "memory",
          target_candidate_index: 0,
          link_type: "derived_from",
          confidence: 0.95,
          reason: "summary 放 commentary 的规则,根因是 trae 加密 DB 只能读 summary 的事实"
        }
      ]
    }
  };

  // Step 3: governance-run 带 preview_token + host_model_result
  console.log("[2/3] 调 governance-run (host_model 模式)...");
  const runBody = {
    thread_id: THREAD_ID,
    governance_mode: "host_model",
    preview_token: tokenId,
    host_model_result: hostModelResult,
    max_items: 50
  };
  const runRes = await fetch(`${BASE}/internal/host-capture/trae/governance-run`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(runBody)
  });
  const runText = await runRes.text();
  if (!runRes.ok) {
    console.error(`  FAILED: ${runRes.status}`);
    console.error(runText.slice(0, 2000));
    process.exit(1);
  }
  const run = JSON.parse(runText);

  console.log("[3/3] 结果:");
  console.log(`  governance_job_id = ${run.governance_job_id || "(空)"}`);
  console.log(`  task_request_id = ${run.task_request_id}`);
  console.log(`  persisted.rule_ids = [${run.persisted?.rule_ids?.length || 0} 条]`);
  console.log(`  persisted.memory_ids = [${run.persisted?.memory_ids?.length || 0} 条]`);
  console.log(`  persisted.memory_candidate_ids = [${run.persisted?.memory_candidate_ids?.length || 0} 条]`);
  console.log(`  persisted.evidence_ids = [${run.persisted?.evidence_ids?.length || 0} 条]`);
  console.log(`  warnings = [${run.warnings?.length || 0} 条]`);
  if (run.warnings?.length) {
    run.warnings.forEach((w, i) => console.log(`    [${i}] ${String(w).slice(0, 150)}`));
  }
  console.log("\n  acceptance_report.governance_candidates:");
  const c = run.acceptance_report?.governance_candidates || {};
  console.log(`    rule=${c.rule_count} memory=${c.memory_count} skill=${c.skill_proposal_count} knowledge=${c.knowledge_count}`);
  console.log("  acceptance_report.promoted_outputs:");
  const p = run.acceptance_report?.promoted_outputs || {};
  console.log(`    rule=${p.rule_count} memory=${p.long_term_memory_count} skill=${p.skill_proposal_count} knowledge=${p.synthesized_knowledge_count}`);
}

main().catch(e => { console.error("FATAL:", e); process.exit(1); });

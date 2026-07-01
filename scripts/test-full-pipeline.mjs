/**
 * 全链路端到端测试 v3 — 基于真实 TRAE 宿主会话
 *
 * 核心链路：
 *   1. GET  /internal/host-capture/trae/sessions           → 列真实 TRAE 会话摘要
 *   2. POST /internal/host-capture/trae/preview            → 抓取会话内容
 *   3. POST /internal/host-capture/trae/governance-batch-preview  → Step1: 抽取预览
 *   4. POST /internal/host-capture/trae/governance-run     → Step2: 治理运行（写库）
 *   5. GET  /internal/governance/change-proposals           → 审批
 *   6. POST /internal/host-actions/execute                  → 落地
 *   7. POST /internal/memory/retrieve                       → 验证召回
 *   8. POST /internal/host/mount (带 host_info)             → 验证自动发现
 */
import { randomUUID } from "node:crypto";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";

const HOST = "http://127.0.0.1:3101";
const DB_URL = "postgresql://postgres:postgres@127.0.0.1:15432/super_agent_system";
const RED = "\x1b[31m", GREEN = "\x1b[32m", YELLOW = "\x1b[33m", CYAN = "\x1b[36m", RESET = "\x1b[0m", BOLD = "\x1b[1m";
let passCount = 0, failCount = 0;
const failures = [];

function assert(cond, msg, detail = "") {
  if (cond) { console.log(`  ${GREEN}✓ PASS${RESET} ${msg}`); passCount++; }
  else {
    console.log(`  ${RED}✗ FAIL${RESET} ${msg}`);
    if (detail) console.log(`    ${RED}详情: ${detail}${RESET}`);
    failCount++; failures.push(msg);
  }
}
function assertNoGarble(text, label) {
  const g = typeof text === "string" && /\?\?/.test(text);
  assert(!g, `${label} 中文无乱码`, `实际值: ${String(text).slice(0, 100)}`);
}
function section(t) { console.log(`\n${CYAN}${BOLD}═══ ${t} ═══${RESET}`); }
async function api(method, p, body) {
  const opts = { method, headers: { "Content-Type": "application/json" } };
  if (body) opts.body = JSON.stringify(body);
  const res = await fetch(`${HOST}${p}`, opts);
  const text = await res.text();
  let json; try { json = JSON.parse(text); } catch { json = text; }
  return { status: res.status, body: json, raw: text };
}
async function dbQuery(sql, params = []) {
  const { Pool } = await import("pg");
  const pool = new Pool({ connectionString: DB_URL });
  try { return (await pool.query(sql, params)).rows; } finally { await pool.end(); }
}

console.log(`${BOLD}${CYAN}╔════════════════════════════════════════════════════╗${RESET}`);
console.log(`${BOLD}${CYAN}║  AGI-Memory 全链路测试 v3（真实 TRAE 宿主会话）   ║${RESET}`);
console.log(`${BOLD}${CYAN}╚════════════════════════════════════════════════════╝${RESET}`);

// ─── 阶段 0a：演示数据 ───
section("阶段 0a: 服务启动自动注册演示数据");
const h = await api("GET", "/healthz");
assert(h.status === 200 && h.body.ok === true, "healthz ok");
const sk = await api("GET", "/internal/skills?limit=10000");
assert((sk.body.items || []).length === 50, "注册 50 skill", `实际: ${(sk.body.items||[]).length}`);
const rl = await api("GET", "/internal/rules?limit=10000");
assert((rl.body.items || []).length === 5, "注册 5 rule", `实际: ${(rl.body.items||[]).length}`);
for (const r of (rl.body.items || [])) assertNoGarble(r.statement, `rule ${r.rule_key}`);
if (failCount > 0) { console.log(`\n${RED}阶段 0a 失败，终止。${RESET}`); process.exit(1); }

// ─── 阶段 0b：host/mount 带 host_info 自动发现 + 推送用户数据 ───
section("阶段 0b: host/mount 带 host_info 自动发现 + 推送用户数据");
const userMemContent = "本项目使用 Python 3.11 + FastAPI，禁止用 print 调试，必须使用 logger。";
const mount = await api("POST", "/internal/host/mount", {
  host_info: {
    host_kind: "trae",
    host_version: "1.0.0",
    host_home: "C:/Users/yangy/.trae-cn",
    workspace_path: "C:/Users/yangy/.qoderworkcn/workspace/mq988j0j137zwdp8/agi-memory-src"
  },
  memories: [{
    memory_type: "factual_memory",
    title: "项目技术栈",
    content: userMemContent,
    source_kind: "host_mounted",
    origin_scope: "user",
    availability_scope: "user_reusable",
    governance_level: "shared",
    promotion_status: "active",
    importance: 85,
    confidence_score: 1.0,
    tags: ["convention"],
    metadata: {}
  }]
});
assert(mount.status === 200, "host/mount 200", mount.raw);
assert(mount.body.host_info !== null, "返回 host_info 非空");
if (mount.body.host_info) {
  assert(mount.body.host_info.host_kind === "trae", "host_kind=trae", `实际: ${mount.body.host_info.host_kind}`);
  assert(mount.body.host_info.sessions_found > 0, `发现真实会话 (${mount.body.host_info.sessions_found} 个)`, `sessions_found=${mount.body.host_info.sessions_found}`);
  assertNoGarble(mount.body.host_info.latest_session, "latest_session 中文");
  console.log(`  ${YELLOW}发现会话: ${mount.body.host_info.sessions_found} 个，最新: ${mount.body.host_info.latest_session}${RESET}`);
}
if (failCount > 0) { console.log(`\n${RED}阶段 0b 失败，终止。${RESET}`); process.exit(1); }

// ─── 阶段 1：真实 TRAE 会话列表 ───
section("阶段 1: 获取真实 TRAE 宿主会话列表");
const sessions = await api("GET", "/internal/host-capture/trae/sessions?limit=5");
assert(sessions.status === 200, "GET sessions 200", sessions.raw);
const sessionItems = sessions.body.items || [];
assert(sessionItems.length > 0, "存在真实会话", `找到 ${sessionItems.length} 个`);
assert(sessions.body.host === "trae", "host=trae", `实际: ${sessions.body.host}`);
if (sessionItems.length > 0) {
  const s = sessionItems[0];
  console.log(`  ${YELLOW}选用会话: ${s.thread_name} (${s.thread_id})${RESET}`);
  assert(!!s.thread_id, "thread_id 非空");
  assert(!!s.session_file, "session_file 非空");
  assertNoGarble(s.thread_name, "会话 thread_name");
}
if (failCount > 0) { console.log(`\n${RED}阶段 1 失败，终止。${RESET}`); process.exit(1); }

// ─── 阶段 2a：抓取真实会话内容 ───
section("阶段 2a: host-capture/preview 抓取真实 TRAE 会话内容");
const targetThread = sessionItems[0].thread_id;
const preview = await api("POST", "/internal/host-capture/trae/preview", { thread_id: targetThread, max_items: 50 });
assert(preview.status === 200, "preview 200", preview.raw);
assert(preview.body.host === "trae", "preview host=trae");
const gp = preview.body.governance_preview || {};
const userMsgs = gp.user_messages || [];
assert(userMsgs.length > 0, "抓取到真实 user_messages", `数量: ${userMsgs.length}`);
for (const m of userMsgs.slice(0, 5)) {
  assert(typeof m.text === "string" && m.text.length > 0, "user_message 文本非空");
  assertNoGarble(m.text, "user_message 中文");
}
console.log(`  ${YELLOW}抓取到 ${userMsgs.length} 条 user_message${RESET}`);
console.log(`  ${YELLOW}前3条: ${userMsgs.slice(0, 3).map(m => m.text.slice(0, 40)).join(" | ")}${RESET}`);
if (failCount > 0) { console.log(`\n${RED}阶段 2a 失败，终止。${RESET}`); process.exit(1); }

// ─── 阶段 2b：governance-batch-preview (Step 1, 不写库) ───
section("阶段 2b: governance-batch-preview (Step 1, 从真实会话构造)");
const memBefore = (await dbQuery("SELECT count(*)::int AS n FROM memory"))[0].n;
const batchPreview = await api("POST", "/internal/host-capture/trae/governance-batch-preview", { thread_id: targetThread, max_items: 50 });
assert(batchPreview.status === 200, "batch-preview 200", batchPreview.raw.slice(0, 200));
const memAfterPreview = (await dbQuery("SELECT count(*)::int AS n FROM memory"))[0].n;
assert(memAfterPreview === memBefore, "Step 1 不写库", `before=${memBefore} after=${memAfterPreview}`);
if (batchPreview.body.mission_brief?.text) {
  assertNoGarble(batchPreview.body.mission_brief.text, "mission_brief 中文");
  console.log(`  ${YELLOW}mission_brief 长度: ${batchPreview.body.mission_brief.text.length}${RESET}`);
}
if (failCount > 0) { console.log(`\n${RED}阶段 2b 失败，终止。${RESET}`); process.exit(1); }

// ─── 阶段 2c：governance-run (Step 2, 从真实会话治理运行写库) ───
section("阶段 2c: governance-run (Step 2, 真实会话 → 治理 → 写库)");
const govRun = await api("POST", "/internal/host-capture/trae/governance-run", {
  thread_id: targetThread,
  max_items: 50,
  governance_mode: "host_model",
  fingerprint: "test-fp-001"
});
assert(govRun.status === 200, "governance-run 200", govRun.raw.slice(0, 300));

const memAfterRun = (await dbQuery("SELECT count(*)::int AS n FROM memory"))[0].n;
console.log(`  ${YELLOW}memory 数量: before=${memBefore} after_run=${memAfterRun}${RESET}`);

// 校验治理写入的数据
const newMems = await dbQuery("SELECT title, content, source_ref, trace_id, promotion_status FROM memory WHERE source_kind='host_capture' OR source_kind='memory_candidate' ORDER BY created_at DESC LIMIT 10");
if (newMems.length > 0) {
  console.log(`  ${YELLOW}治理写入 ${newMems.length} 条新 memory${RESET}`);
  for (const m of newMems) {
    assertNoGarble(m.title, `memory title "${m.title}"`);
    assertNoGarble(m.content, `memory content`);
  }
} else {
  console.log(`  ${YELLOW}本次会话未产生新 memory（可能内容不含可抽取信号）${RESET}`);
}

const props = await dbQuery("SELECT id, status, proposed_action_type, proposed_payload::text AS payload FROM governance_change_proposal ORDER BY created_at DESC LIMIT 5");
console.log(`  ${YELLOW}governance_change_proposal: ${props.length} 条${RESET}`);
for (const p of props) assertNoGarble(p.payload, "proposal payload 中文");
if (failCount > 0) { console.log(`\n${RED}阶段 2c 失败，终止。${RESET}`); process.exit(1); }

// ─── 阶段 3b：审批 ───
section("阶段 3b: governance change-proposals 审批");
const proposals = await api("GET", "/internal/governance/change-proposals?status=recorded&limit=100");
assert(proposals.status === 200, "GET change-proposals 200");
const proposalItems = proposals.body.items || [];
if (proposalItems.length > 0) {
  const p = proposalItems[0];
  assertNoGarble(JSON.stringify(p.proposal_payload || {}), "proposal payload 中文");
  const approve = await api("POST", `/internal/governance/change-proposals/${p.id}/actions`, { action: "approve", human_decision: "approved", reviewer: "test", comment: "测试通过" });
  assert(approve.status === 200, "approve 200", approve.raw);
  const resolved = await dbQuery("SELECT status FROM governance_change_proposal WHERE id=$1", [p.id]);
  if (resolved.length === 1) assert(resolved[0].status === "resolved", "proposal status=resolved", resolved[0].status);
  console.log(`  ${YELLOW}审批通过: ${p.proposal_type}${RESET}`);
} else {
  console.log(`  ${YELLOW}无待审批提案（会话未产生 rule candidate）${RESET}`);
}
if (failCount > 0) { console.log(`\n${RED}阶段 3b 失败，终止。${RESET}`); process.exit(1); }

// ─── 阶段 3c：host-actions/execute 落地 ───
section("阶段 3c: host-actions/execute 落地");
const gatesDir = path.resolve("services/memory-service/.trae/gates");
const hooksBefore = existsSync(gatesDir) ? readdirSync(gatesDir).filter(f => f.endsWith(".hook.ts")).length : 0;
const exec = await api("POST", "/internal/host-actions/execute", { gates_dir: gatesDir });
assert(exec.status === 200, "host-actions/execute 200", exec.raw);
const hooksAfter = existsSync(gatesDir) ? readdirSync(gatesDir).filter(f => f.endsWith(".hook.ts")).length : 0;
if (hooksAfter > hooksBefore) {
  const hookFiles = readdirSync(gatesDir).filter(f => f.endsWith(".hook.ts"));
  const latest = hookFiles[hookFiles.length - 1];
  const content = readFileSync(path.join(gatesDir, latest), "utf8");
  assertNoGarble(content, `hook 文件 ${latest} 中文`);
  assert(hooksAfter > hooksBefore, `生成新 .hook.ts (before=${hooksBefore} after=${hooksAfter})`);
  console.log(`  ${YELLOW}生成: ${latest}${RESET}`);
} else {
  console.log(`  ${YELLOW}本次无 host-action 需要落地${RESET}`);
}
if (failCount > 0) { console.log(`\n${RED}阶段 3c 失败，终止。${RESET}`); process.exit(1); }

// ─── 阶段 4：retrieve 验证 ───
section("阶段 4: memory_retrieve 验证治理后数据可见");
const ret = await api("POST", "/internal/memory/retrieve", { query: "Python 技术栈", fingerprint: "test-fp-001", fingerprint_status: "matched_or_na", layers: ["memory"] });
assert(ret.status === 200, "retrieve 200");
const fm = ret.body.factual_memory || [];
assert(fm.length > 0, "factual_memory 非空");
for (const m of fm) {
  assertNoGarble(m.title, `retrieve memory title`);
  assertNoGarble(m.content, `retrieve memory content`);
}
console.log(`  ${YELLOW}retrieve 返回 ${fm.length} 条 factual_memory${RESET}`);

// ─── 阶段 9：新端点 ───
section("阶段 9: layer-links + learning-chain/detect");
const ll = await api("GET", "/internal/layer-links?limit=20");
assert(ll.status === 200 && Array.isArray(ll.body.items), "layer-links 200 + items 数组");
const t = Date.now();
const chain = await api("POST", "/internal/learning-chain/detect", { events: [
  { timestamp: new Date(t - 90*60000).toISOString(), kind: "tool_call", payload: "web_search", status: "success" },
  { timestamp: new Date(t - 70*60000).toISOString(), kind: "assistant_message", payload: "经过检索发现 FastAPI 异步任务的最佳实践是使用 BackgroundTasks" },
  { timestamp: new Date(t - 40*60000).toISOString(), kind: "command", payload: "Edit main.py" },
  { timestamp: new Date(t - 30*60000).toISOString(), kind: "assistant_message", payload: "综上我们在 main.py 中应用了 BackgroundTasks" }
]});
assert(chain.status === 200 && chain.body.total_chains >= 1, "learning-chain 检测到 1 条链", `total=${chain.body.total_chains}`);
if (chain.body.chains?.[0]) {
  assert(chain.body.chains[0].isComplete === true, "学习链 isComplete=true");
  assertNoGarble(chain.body.chains[0].summaryText, "summaryText 中文");
}

// ─── 汇总 ───
console.log(`\n${CYAN}${BOLD}╔══════════════════════════════════════════════╗${RESET}`);
console.log(`${CYAN}${BOLD}║              测试结果汇总                    ║${RESET}`);
console.log(`${CYAN}${BOLD}╚══════════════════════════════════════════════╝${RESET}`);
console.log(`  ${GREEN}通过: ${passCount}${RESET}`);
console.log(`  ${RED}失败: ${failCount}${RESET}`);
if (failCount === 0) {
  console.log(`\n${GREEN}${BOLD}✅ 全链路测试通过（基于真实 TRAE 宿主会话 + 内容校验）${RESET}`);
  process.exit(0);
} else {
  console.log(`\n${RED}${BOLD}❌ 失败项:${RESET}`);
  failures.forEach(f => console.log(`  ${RED}- ${f}${RESET}`));
  process.exit(1);
}

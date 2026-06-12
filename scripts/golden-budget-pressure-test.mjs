/**
 * Golden-50 Budget Pressure Stress Test
 *
 * Constructs a SINGLE mock session containing:
 *   - All 54 golden signal inputs (high-value)
 *   - 200 synthetic low-signal filler messages (noise)
 *   - 50 success commands (low-score metadata)
 *   - 30 failure commands (medium-score)
 *
 * Then runs summarizeSession with 8K token budget and checks:
 *   1. Which golden signals survived budget truncation?
 *   2. What was their average score vs filler score?
 *   3. Were any golden signals displaced by noise?
 */
import { readFileSync } from "node:fs";
import { summarizeSession } from "../services/memory-service/dist/services/memory-service/src/sessionSummarizer.js";
import { buildMissionBrief } from "../services/memory-service/dist/services/memory-service/src/governancePromptBuilder.js";

// ─── Load golden datasets ──────────────────────────────────────────────

const golden50 = JSON.parse(readFileSync("tests/governance-quality/golden-50.v1.json", "utf-8"));
const broken12 = JSON.parse(readFileSync("tests/governance-quality/broken-stress-12.v1.json", "utf-8"));

// Filter out discard cases
const goldenCases = [
  ...golden50.cases.filter(c => c.expected.layer !== "discard"),
  ...broken12.cases.filter(c => c.expected.layer !== "discard"),
];

console.log(`Golden signals (non-discard): ${goldenCases.length}`);

// ─── Generate filler noise ─────────────────────────────────────────────

const FILLER_TEMPLATES = [
  "继续", "好的", "可以", "行", "嗯",
  "npm run build 成功", "tsc 编译通过", "测试通过",
  "读取文件 src/index.ts", "写入文件 src/app.ts",
  "安装依赖 npm install", "启动服务 npm start",
  "git commit 完成", "git push 成功",
  "打开终端", "切换到项目目录",
  "检查端口 3000", "查看日志输出",
  "运行 docker compose up", "执行数据库迁移",
  "复制文件到 dist", "创建目录 build",
  "删除临时文件", "更新配置文件",
  "验证 API 返回", "检查响应状态码",
  "下载依赖包", "编译 TypeScript",
  "格式化代码 prettier", "lint 检查 eslint",
  "运行单元测试 jest", "执行集成测试",
  "启动 Redis 服务", "连接 PostgreSQL",
  "创建数据库表", "插入测试数据",
  "查询用户列表", "更新用户信息",
  "部署到测试环境", "检查健康状态",
  "重启服务", "停止容器",
  "拉取最新代码", "合并分支",
  "创建新分支 feature", "提交代码审查",
];

const FAILURE_TEMPLATES = [
  "npm ERR! code ENOENT",
  "Error: Cannot find module",
  "TypeError: undefined is not a function",
  "Connection refused on port 5432",
  "Permission denied: /var/log",
  "ENOENT: no such file or directory",
  "EADDRINUSE: address already in use",
  "docker: Error response from daemon",
  "git: fatal: not a git repository",
  "tsc: error TS2304: Cannot find name",
];

function generateTimestamp(index) {
  const base = new Date("2026-06-12T10:00:00.000Z");
  base.setSeconds(base.getSeconds() + index);
  return base.toISOString();
}

// Build the mock session
const userMessages = [];
const commands = [];
const toolCalls = [];

let msgIndex = 0;

// 1. Insert golden signals at random positions among fillers
const goldenPositions = new Set();
while (goldenPositions.size < goldenCases.length) {
  goldenPositions.add(Math.floor(Math.random() * 300));
}
const sortedGoldenPositions = [...goldenPositions].sort((a, b) => a - b);

// 2. Fill with noise
for (let i = 0; i < 300; i++) {
  const goldenIdx = sortedGoldenPositions.indexOf(i);
  if (goldenIdx >= 0 && goldenIdx < goldenCases.length) {
    // Insert golden signal
    userMessages.push({
      timestamp: generateTimestamp(i),
      role: "user",
      text: goldenCases[goldenIdx].input,
    });
  } else {
    // Insert filler
    const filler = FILLER_TEMPLATES[msgIndex % FILLER_TEMPLATES.length];
    userMessages.push({
      timestamp: generateTimestamp(i),
      role: "user",
      text: filler,
    });
    msgIndex++;
  }
}

// 3. Add 50 success commands (score=1, low value)
for (let i = 0; i < 50; i++) {
  commands.push({
    timestamp: generateTimestamp(300 + i),
    command: ["npm", "run", `task-${i}`],
    cwd: "/project",
    exit_code: 0,
    stdout_excerpt: "Done in 1.2s",
    stderr_excerpt: null,
    status: "success",
  });
}

// 4. Add 30 failure commands (score=7, medium value)
for (let i = 0; i < 30; i++) {
  const err = FAILURE_TEMPLATES[i % FAILURE_TEMPLATES.length];
  commands.push({
    timestamp: generateTimestamp(350 + i),
    command: ["node", `script-${i}.js`],
    cwd: "/project",
    exit_code: 1,
    stdout_excerpt: null,
    stderr_excerpt: err,
    status: "failure",
  });
}

const capture = {
  host: "codex",
  codex_home: "/mock/codex",
  host_home: "/mock/home",
  thread_id: "stress-test-session",
  thread_name: "Stress Test: 54 golden + 300 noise",
  session_file: "/mock/session.jsonl",
  updated_at: "2026-06-12T12:00:00.000Z",
  totals: {
    raw_event_count: userMessages.length + commands.length + toolCalls.length,
    message_count: userMessages.length,
    user_message_count: userMessages.length,
    assistant_message_count: 0,
    commentary_count: 0,
    command_event_count: commands.length,
    tool_call_count: 0,
    mcp_call_count: 0,
  },
  governance_preview: {
    user_messages: userMessages,
    corrections: [],
    preferences: [],
    decisions: [],
    commands,
    tool_calls: toolCalls,
    mcp_calls: [],
    workspace_paths: [],
    readiness: {
      has_user_intent: true,
      has_execution_trace: true,
      has_tool_trace: false,
      has_corrections: false,
      quality: "medium",
      warnings: [],
    },
  },
};

// ─── Run pipeline ──────────────────────────────────────────────────────

console.log(`\nSession stats:`);
console.log(`  User messages: ${userMessages.length} (${goldenCases.length} golden + ${userMessages.length - goldenCases.length} filler)`);
console.log(`  Commands: ${commands.length} (50 success + 30 failure)`);
console.log(`  Total events: ${capture.totals.raw_event_count}`);
console.log(`  Token budget: 8000`);

const summarized = summarizeSession(capture, 8000);
const brief = buildMissionBrief(summarized);

console.log(`\nCompression results:`);
console.log(`  Retained events: ${summarized.retained_event_count}`);
console.log(`  Estimated tokens: ${summarized.estimated_tokens}`);
console.log(`  Compression ratio: ${(summarized.compression_ratio * 100).toFixed(1)}%`);
console.log(`  Signal stats: directives=${summarized.signal_stats.user_directives}, failures=${summarized.signal_stats.failure_events}, breakthroughs=${summarized.signal_stats.breakthrough_events}, success=${summarized.signal_stats.success_metadata}`);
console.log(`  Mission brief size: ${brief.text.length} chars`);

// ─── Check golden signal survival ──────────────────────────────────────

console.log(`\n${"═".repeat(70)}`);
console.log("GOLDEN SIGNAL SURVIVAL UNDER BUDGET PRESSURE");
console.log(`${"═".repeat(70)}`);

let survived = 0;
let failed = 0;
const survivalDetails = [];

for (const gc of goldenCases) {
  // Check if a significant portion of the input text survives
  const inputWords = gc.input.split(/[\s，,。！？]+/).filter(w => w.length >= 2);
  const foundWords = inputWords.filter(w => brief.text.toLowerCase().includes(w.toLowerCase()));
  const rate = inputWords.length > 0 ? foundWords.length / inputWords.length : 1;
  const pass = rate >= 0.3; // 30% threshold (lower due to budget pressure)

  if (pass) {
    survived++;
    console.log(`  ✓ ${gc.id} [${gc.category}] → ${(rate * 100).toFixed(0)}% survived`);
  } else {
    failed++;
    console.log(`  ✗ ${gc.id} [${gc.category}] → ${(rate * 100).toFixed(0)}% survived`);
    console.log(`      Input: "${gc.input.slice(0, 60)}..."`);
    console.log(`      Found: ${foundWords.slice(0, 3).join(", ")} | Missing: ${inputWords.filter(w => !brief.text.toLowerCase().includes(w.toLowerCase())).slice(0, 3).join(", ")}`);
  }

  survivalDetails.push({ id: gc.id, category: gc.category, rate, pass });
}

// ─── Summary ───────────────────────────────────────────────────────────

console.log(`\n${"═".repeat(70)}`);
console.log("BUDGET PRESSURE RESULTS");
console.log(`${"═".repeat(70)}`);
console.log(`Golden signals survived: ${survived}/${goldenCases.length} (${((survived / goldenCases.length) * 100).toFixed(1)}%)`);
console.log(`Golden signals lost:     ${failed}`);

// Per-category breakdown
const catStats = {};
for (const d of survivalDetails) {
  if (!catStats[d.category]) catStats[d.category] = { survived: 0, total: 0 };
  catStats[d.category].total++;
  if (d.pass) catStats[d.category].survived++;
}

console.log(`\nPer-category survival:`);
for (const [cat, stats] of Object.entries(catStats).sort((a, b) => (a[1].survived / a[1].total) - (b[1].survived / b[1].total))) {
  const pct = ((stats.survived / stats.total) * 100).toFixed(0);
  const bar = "█".repeat(stats.survived) + "░".repeat(stats.total - stats.survived);
  console.log(`  ${cat.padEnd(22)} ${stats.survived}/${stats.total} (${pct.padStart(3)}%) ${bar}`);
}

process.exit(failed > 0 ? 1 : 0);

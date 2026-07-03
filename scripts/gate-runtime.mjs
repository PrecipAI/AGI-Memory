// Gate Runtime — 加载 .trae/gates/*.hook.ts 并执行门控检查
//
// 用法:
//   node scripts/gate-runtime.mjs --mount-point=pre_commit
//   node scripts/gate-runtime.mjs --mount-point=pre_commit --task-type=coding
//
// 退出码:
//   0 — 全部 PASS（或无 hook 匹配）
//   1 — 有 hook REJECT（阻断动作）
//   2 — runtime 自身出错（不阻断，仅警告）

import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";
import { pathToFileURL } from "node:url";
import { register } from "node:module";

// ─── 参数解析 ───────────────────────────────────────────────────
const args = process.argv.slice(2);
const mountPoint = (args.find(a => a.startsWith("--mount-point="))?.split("=")[1]) ?? "pre_commit";
const taskType = (args.find(a => a.startsWith("--task-type="))?.split("=")[1]) ?? "coding";
const operation = (args.find(a => a.startsWith("--operation="))?.split("=")[1]) ?? "commit";
const quiet = args.includes("--quiet");

const REPO_ROOT = path.resolve(import.meta.dirname, "..");
const GATES_DIR = path.join(REPO_ROOT, ".trae", "gates");
const REGISTRY_PATH = path.join(GATES_DIR, "registry.json");

// ─── tsx loader 注册（让 node 能直接 import .ts 文件）──────────
// 优先用项目的 tsx；若不可用则降级到 ts-node
async function ensureTsLoader() {
  try {
    const tsxPath = path.join(REPO_ROOT, "node_modules", "tsx", "dist", "loader.mjs");
    if (existsSync(tsxPath)) {
      register(pathToFileURL(tsxPath).href);
      return;
    }
  } catch {}
  // 降级：尝试全局 tsx
  try {
    register("tsx/esm");
  } catch {
    console.error("[gate-runtime] 警告: 无法加载 tsx loader，.hook.ts 文件将无法执行");
    console.error("[gate-runtime] 请确保项目已安装 tsx: npm i -D tsx");
  }
}

await ensureTsLoader();

// ─── GateContext 实现 ──────────────────────────────────────────
function createGateContext() {
  return {
    taskType,
    operation,
    cwd: REPO_ROOT,
    host: process.env.HOST_NAME || "local",

    async getChangedFiles() {
      try {
        // pre_commit 场景: 取已暂存文件
        const out = execSync("git diff --cached --name-only --diff-filter=ACMR", { cwd: REPO_ROOT, encoding: "utf8" });
        return out.split("\n").filter(Boolean);
      } catch {
        return [];
      }
    },

    async searchInDiff(pattern) {
      try {
        const out = execSync("git diff --cached", { cwd: REPO_ROOT, encoding: "utf8" });
        const re = pattern instanceof RegExp ? pattern : new RegExp(pattern);
        const matches = out.split("\n").filter(l => re.test(l));
        return matches;
      } catch {
        return [];
      }
    },

    async readFile(filePath) {
      const abs = path.isAbsolute(filePath) ? filePath : path.join(REPO_ROOT, filePath);
      return readFileSync(abs, "utf8");
    },

    async exec(command) {
      try {
        const stdout = execSync(command, { cwd: REPO_ROOT, encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] });
        return { stdout, stderr: "", exitCode: 0 };
      } catch (e) {
        return { stdout: e.stdout ?? "", stderr: e.stderr ?? String(e.message), exitCode: e.status ?? 1 };
      }
    },

    async getGitStatus() {
      try {
        const out = execSync("git status --porcelain", { cwd: REPO_ROOT, encoding: "utf8" });
        const staged = [], modified = [], untracked = [];
        for (const line of out.split("\n").filter(Boolean)) {
          const x = line[0], y = line[1], file = line.slice(3);
          if (x === "?" && y === "?") untracked.push(file);
          else if (x === " " || x === "M" || x === "D") modified.push(file);
          else staged.push(file);
        }
        return { staged, modified, untracked };
      } catch {
        return { staged: [], modified: [], untracked: [] };
      }
    },

    async isFileChanged(filePath) {
      const changed = await this.getChangedFiles();
      return changed.includes(filePath);
    },

    async searchInFiles(pattern, glob) {
      try {
        const re = pattern instanceof RegExp ? pattern.source : String(pattern);
        const cmd = `git grep -n -E "${re}" ${glob ? "-- " + glob : ""}`;
        const out = execSync(cmd, { cwd: REPO_ROOT, encoding: "utf8" });
        return out.split("\n").filter(Boolean).map(l => {
          const [file, line, ...rest] = l.split(":");
          return { file, line: Number(line), text: rest.join(":") };
        });
      } catch {
        return [];
      }
    }
  };
}

// ─── 加载 hook 列表 ────────────────────────────────────────────
function loadHookList() {
  if (!existsSync(GATES_DIR)) return [];
  let registry = [];
  if (existsSync(REGISTRY_PATH)) {
    try {
      const reg = JSON.parse(readFileSync(REGISTRY_PATH, "utf8"));
      // 兼容两种 key：hostActionExecutor 写 "gates"，旧版可能用 "hooks"
      registry = Array.isArray(reg.gates) ? reg.gates
        : Array.isArray(reg.hooks) ? reg.hooks
        : Array.isArray(reg) ? reg : [];
    } catch {}
  }
  // 若 registry 缺失，扫描目录兜底
  if (registry.length === 0) {
    const files = readdirSync(GATES_DIR).filter(f => f.endsWith(".hook.ts"));
    return files.map(f => ({ file: f, mount_points: [mountPoint], enabled: true }));
  }
  return registry.filter(e => e.enabled !== false);
}

// ─── 主流程 ────────────────────────────────────────────────────
async function main() {
  const hookList = loadHookList();
  if (hookList.length === 0) {
    if (!quiet) console.log("[gate-runtime] 无已注册 hook，跳过");
    process.exit(0);
  }

  const context = createGateContext();
  const matched = [];
  const skipped = [];

  for (const entry of hookList) {
    const mountPoints = entry.mount_points ?? [];
    if (!mountPoints.includes(mountPoint)) {
      skipped.push(entry);
      continue;
    }
    matched.push(entry);
  }

  if (matched.length === 0) {
    if (!quiet) console.log(`[gate-runtime] mount_point=${mountPoint} 无匹配 hook（共 ${hookList.length} 个，跳过 ${skipped.length} 个）`);
    process.exit(0);
  }

  if (!quiet) console.log(`[gate-runtime] mount_point=${mountPoint} 匹配 ${matched.length} 个 hook，开始执行...`);

  let rejected = 0;
  let passed = 0;
  let errored = 0;

  for (const entry of matched) {
    const fileName = entry.file?.endsWith(".ts") ? entry.file : `${entry.rule_key ?? entry.hook_id}.hook.ts`;
    const filePath = path.join(GATES_DIR, fileName);

    if (!existsSync(filePath)) {
      if (!quiet) console.log(`  ⚠️  ${entry.rule_key ?? fileName}: 文件不存在，跳过`);
      errored++;
      continue;
    }

    try {
      const mod = await import(pathToFileURL(filePath).href);
      const hook = mod.hook;
      if (!hook || typeof hook.run !== "function") {
        if (!quiet) console.log(`  ⚠️  ${entry.rule_key}: 未导出 hook 或缺少 run()，跳过`);
        errored++;
        continue;
      }

      // shouldRun 快速过滤
      if (typeof hook.shouldRun === "function" && !hook.shouldRun(context)) {
        if (!quiet) console.log(`  ⊘  ${hook.rule_key}: shouldRun=false，跳过`);
        continue;
      }

      const result = await hook.run(context);

      if (result.action === "REJECT") {
        rejected++;
        console.log(`  ✗  ${hook.rule_key}: REJECT — ${result.reason ?? "无理由"}`);
      } else if (result.action === "PASS") {
        passed++;
        if (!quiet) console.log(`  ✓  ${hook.rule_key}: PASS`);
      } else {
        if (!quiet) console.log(`  →  ${hook.rule_key}: ${result.action} — ${result.reason ?? ""}`);
        passed++;
      }
    } catch (e) {
      errored++;
      console.log(`  ⚠️  ${entry.rule_key}: 执行异常 — ${e.message}`);
      // 执行异常不阻断（避免 runtime bug 卡死工作流）
    }
  }

  console.log(`[gate-runtime] 完成: ${passed} PASS, ${rejected} REJECT, ${errored} ERROR`);

  if (rejected > 0) {
    console.error(`\n❌ 门控拦截: ${rejected} 条规则 REJECT`);
    console.error(`   请修复上述问题后重试，或使用 \`git commit --no-verify\` 跳过（不推荐）`);
    process.exit(1);
  }
  process.exit(0);
}

main().catch(e => {
  console.error(`[gate-runtime] FATAL: ${e.message}`);
  // runtime 自身出错不阻断用户操作
  process.exit(2);
});

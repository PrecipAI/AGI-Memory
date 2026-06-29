import fs from "node:fs/promises";
import path from "node:path";

const MEMORY_SERVICE_URL = process.env.MEMORY_SERVICE_URL || "http://127.0.0.1:3101";
const GATES_DIR = process.env.GATES_DIR || path.join(process.cwd(), ".trae", "gates");
const PROJECT_ID = process.env.PROJECT_ID || null;
const GLOBAL_SKILLS_DIR = process.env.GLOBAL_SKILLS_DIR || path.join(process.env.USERPROFILE || process.env.HOME || process.cwd(), ".trae-cn", "skills");
const PROJECT_SKILLS_DIR = process.env.PROJECT_SKILLS_DIR || path.join(process.cwd(), ".trae", "skills");

const SKILL_MAP = {
  rule: "gate-master",
  skill: "skill-creator"
};

function isGlobalSkill(record) {
  return (
    ["global", "team"].includes(record.origin_scope) &&
    ["global_reusable", "team_reusable"].includes(record.availability_scope)
  );
}

function resolveSkillDir(record) {
  const skillKey = record.skill_key || "unnamed";
  if (isGlobalSkill(record)) {
    return path.join(GLOBAL_SKILLS_DIR, skillKey);
  }
  return path.join(PROJECT_SKILLS_DIR, skillKey);
}

async function fetchPending() {
  const url = new URL(`${MEMORY_SERVICE_URL}/internal/host-actions/pending`);
  url.searchParams.set("object_type", "all");
  if (PROJECT_ID) url.searchParams.set("project_id", PROJECT_ID);

  const res = await fetch(url, {
    headers: {
      "x-tenant-id": "tenant-local",
      "x-scope": "memory.validation"
    }
  });
  if (!res.ok) {
    throw new Error(`fetch pending failed: ${res.status} ${await res.text()}`);
  }
  const data = await res.json();
  return data.items || [];
}

async function markStatus(objectType, objectId, status, error, summary) {
  const body = { status };
  if (error) body.error = error;
  if (summary) body.summary = summary;
  const res = await fetch(`${MEMORY_SERVICE_URL}/internal/host-actions/${objectType}/${objectId}/status`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-tenant-id": "tenant-local",
      "x-scope": "memory.validation"
    },
    body: JSON.stringify(body)
  });
  if (!res.ok) {
    throw new Error(`mark status failed: ${res.status} ${await res.text()}`);
  }
}

async function loadSkillDefinition(skillName) {
  const filePath = path.join(GLOBAL_SKILLS_DIR, skillName, "SKILL.md");
  try {
    return await fs.readFile(filePath, "utf8");
  } catch {
    return null;
  }
}

function buildSkillCreatorPrompt(item, skillDefinition) {
  const record = item.invoke_skill?.payload?.skill_record || {};
  const hostContext = item.invoke_skill?.payload?.host_context || {};

  return `# Skill Creator Host Prompt

你现在是 Skill Creator Skill 的执行器。请根据以下输入生成一个完整的 SKILL.md 文件。

## 输入 Skill 记录

\`\`\`json
${JSON.stringify(record, null, 2)}
\`\`\`

## 宿主上下文

\`\`\`json
${JSON.stringify(hostContext, null, 2)}
\`\`\`

## Skill Creator 完整定义

${skillDefinition ?? "（未加载到 skill-creator/SKILL.md，请使用内置知识）"}

## 你的任务

1. 根据 origin_scope / availability_scope 判定 skill 级别（全局 / 项目 / 用户 / 会话）。
2. 按级别生成符合规范的 description，全局级严禁出现项目特定名词。
3. 把 applicable_scenarios、non_applicable_scenarios、execution_steps、validation_method 整理成标准 SKILL.md 结构。
4. 项目级必须显式声明 PROJECT_SCOPE。
5. 输出最终要写入的 SKILL.md 完整内容。

## 输出要求

- 只输出 SKILL.md 文件内容，不要任何额外解释。
- 必须包含 frontmatter：name 和 description。
- 必须包含 # 标题、触发条件、不适用场景、执行步骤、验证方法、Scope Metadata。
- 全局级描述中禁止出现具体项目名、角色名、文件路径、故事设定。
`;
}

function buildGateMasterPrompt(item, skillDefinition) {
  const payload = item.invoke_skill?.payload || {};

  return `# GateMaster Host Prompt

你现在是 GateMaster Skill 的执行器。请根据以下输入生成一个完整的 TypeScript RuleHook 文件。

## 输入规则

\`\`\`json
${JSON.stringify(payload, null, 2)}
\`\`\`

## GateMaster 完整定义

${skillDefinition ?? "（未加载到 gate-master/SKILL.md，请使用内置知识）"}

## 你的任务

1. 解析 IF-THEN 规则语句，提取 Trigger、Logic、Action。
2. 根据 trigger_conditions 确定 mount_points 和 shouldRun 的精确匹配逻辑。
3. 根据 statement 和 enforcement_level 生成 run() 中的真实检查逻辑。
4. 返回完整的 .hook.ts 文件内容。

## GateContext API 参考

- context.getChangedFiles() — 获取当前变更的文件列表
- context.searchInDiff(pattern) — 在 diff 中搜索匹配
- context.readFile(path) — 读取文件内容
- context.writeFile(path, content) — 写入文件内容
- context.exec(command) — 执行 shell 命令
- context.getGitStatus() — 获取 git 状态
- context.isFileChanged(path) — 检查指定文件是否被修改
- context.searchInFiles(pattern, glob) — 搜索代码内容
- context.taskType — 当前任务类型
- context.operation — 当前操作标识
- context.cwd — 当前工作目录
- context.projectId — 当前项目 ID
- context.sessionId — 当前会话 ID

## 输出要求

- 只输出文件内容，不要任何解释。
- 必须包含：import type { GateContext, HookResult, RuleHook } from "./types";
- 必须导出：export const hook: RuleHook
- id 格式：hook_{rule_key.toLowerCase()}
- mount_points 必须从 trigger_conditions 推导，不能写死 before_task_complete。
- shouldRun 必须根据 task_type / operation / checkpoint 等条件生成真实匹配。
- run 必须根据 statement 的 MUST/MUST NOT 生成检查，失败时返回 REJECT 并带 reason、retry_hint、rule_id、rule_key。
- 通过时返回 { action: "PASS" }。
`;
}

async function processSkill(item, skillDefinition) {
  const skillName = SKILL_MAP[item.object_type];
  const record = item.invoke_skill?.payload?.skill_record || {};
  const skillDir = resolveSkillDir(record);
  const promptDir = path.join(skillDir, "..", "..", "prompts");
  const promptPath = path.join(promptDir, `${record.skill_key || item.key}.prompt.md`);
  await fs.mkdir(promptDir, { recursive: true });
  await fs.writeFile(promptPath, buildSkillCreatorPrompt(item, skillDefinition), "utf8");
  console.log(`  ✅ [skill-creator] 生成 prompt: ${promptPath}`);
  const summary = `已生成 skill 创建 prompt，等待宿主模型写入 ${skillDir}/SKILL.md。`;
  await markStatus("skill", item.id, "generated", null, summary);
}

async function processRule(item, skillDefinition) {
  const ruleKey = item.key;
  const promptDir = path.join(GATES_DIR, "prompts");
  const promptPath = path.join(promptDir, `${ruleKey}.prompt.md`);
  await fs.mkdir(promptDir, { recursive: true });
  await fs.writeFile(promptPath, buildGateMasterPrompt(item, skillDefinition), "utf8");
  console.log(`  ✅ [gate-master] 生成 prompt: ${promptPath}`);
  const summary = `已生成 gate-master prompt，等待宿主模型根据 prompt 生成 ${GATES_DIR}/${ruleKey}.hook.ts。`;
  await markStatus("rule", item.id, "generated", null, summary);
}

async function main() {
  console.log("🚀 开始执行 pending 的 invoke_skill...\n");

  const items = await fetchPending();
  if (items.length === 0) {
    console.log("没有 pending 的 rule/skill，无需处理。");
    console.log("（如果刚审批完，请先确保 memory-service 已重启并加载最新代码。）");
    return;
  }

  console.log(`发现 ${items.length} 个 pending 项：\n`);

  for (const item of items) {
    const skillName = SKILL_MAP[item.object_type];
    const artifactKey = item.key;
    console.log(`▶ 触发 skill: ${skillName}（${item.object_type}: ${artifactKey}）`);

    const skillDef = await loadSkillDefinition(skillName);
    if (!skillDef) {
      console.warn(`  ⚠️ 未找到 ${skillName}/SKILL.md，将使用默认模板生成。`);
    } else {
      const firstLine = skillDef.split("\n").slice(0, 3).join("\n");
      console.log(`  📄 已加载 ${skillName}/SKILL.md`);
    }

    try {
      if (item.object_type === "skill") {
        await processSkill(item, skillDef);
      } else if (item.object_type === "rule") {
        await processRule(item, skillDef);
      } else {
        console.warn("  ⚠️ 未知类型，跳过:", item.object_type);
      }
    } catch (error) {
      console.error(`  ❌ 处理失败: ${error.message}`);
      await markStatus(item.object_type, item.id, "failed", String(error));
    }
  }

  console.log("\n✅ 处理完成。");
  console.log("🤖 宿主模型请读取上方生成的 .prompt.md 文件，生成最终代码并写回对应路径。");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

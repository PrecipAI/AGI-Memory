// 给 .trae-cn/mcps/ 下所有 memory_preview_host_governance.json 和 memory_run_full_governance.json
// 加上 host 和 host_home 参数（与 server.ts 的 zod schema 保持一致）
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "..");
const MCP_BASE = path.join(process.env.USERPROFILE || "", ".trae-cn", "mcps", "s_agi-memory-src-9e01dc3b");

const SUBDIRS = ["browser_use", "general_purpose_task", "search", "solo_agent_lite"];
const TOOLS = ["memory_preview_host_governance", "memory_run_full_governance"];

const HOST_PARAM = {
  type: "string",
  description: "宿主类型：codex / qoder / trae / cursor / windsurf / continue / aider / cline 等。默认 'codex'（向后兼容）。必须与当前实际宿主一致，否则会扫描错误的会话目录。常见别名：claude-code/claude/cc→claude-code, qoderwork/qoderworkcn→qoder, trae_cn/traecn→trae。"
};

const HOST_HOME_PARAM = {
  type: "string",
  description: "宿主数据目录路径（通用字段，适用于所有宿主）。优先级低于 codex_home（仅 codex 宿主）。"
};

let updated = 0;
let skipped = 0;

for (const sub of SUBDIRS) {
  for (const tool of TOOLS) {
    const filePath = path.join(MCP_BASE, sub, "mcp_memory-v3", "tools", `${tool}.json`);
    try {
      const content = JSON.parse(readFileSync(filePath, "utf8"));
      const props = content.arguments?.properties;
      if (!props) {
        console.log(`⊘ ${sub}/${tool}: 无 arguments.properties，跳过`);
        skipped++;
        continue;
      }

      // 已有 host 参数就跳过
      if (props.host) {
        console.log(`⊘ ${sub}/${tool}: 已有 host 参数，跳过`);
        skipped++;
        continue;
      }

      // 插入 host 和 host_home 到 properties 最前面（保持字段顺序）
      const newProps = { host: HOST_PARAM, host_home: HOST_HOME_PARAM, ...props };
      content.arguments.properties = newProps;

      writeFileSync(filePath, JSON.stringify(content, null, 2) + "\n", "utf8");
      console.log(`✓ ${sub}/${tool}: 已加 host + host_home 参数`);
      updated++;
    } catch (e) {
      console.log(`✗ ${sub}/${tool}: ${e.message}`);
      skipped++;
    }
  }
}

console.log(`\n===== 完成 =====`);
console.log(`更新: ${updated}, 跳过: ${skipped}`);

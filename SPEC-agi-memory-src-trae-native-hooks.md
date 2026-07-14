# Trae 原生 Hook 接入：把 memory L2 Rule 变成硬门控

## 目标

将 memory-service 中已审批通过的 L2 Rule，通过 GateMaster 机制翻译成 Trae IDE 原生可执行 Hook（`.trae/hooks/{rule_key}.mjs` + `.trae/hooks.json`），把原先依赖 LLM “自觉遵守”的软约束，变成在关键事件点可拦截、可阻断的硬门控。

## 决策记录

- **宿主环境**：本地 Trae IDE 个人版（来源：用户指定）。TRAE Work / Web 版已确认不支持 hook，不纳入本期范围。
- **Rule 来源**：memory-service `rule` 表中 `status='active'` 的 L2 Rule，当前共 5 条（来源：数据库查询确认）。
- **翻译机制**：GateMaster —— 生成 `.trae/hooks/{rule_key}.mjs` + 更新 `.trae/hooks.json` + 更新 `.trae/gates/registry.json` 做元数据备案（来源：项目既有 host-action-executor 逻辑 + GateMaster 技能规范）。
- **生效模式**：`hard_native`（Trae 原生 hook 实时拦截），在 host-action 执行结果中显式标注（来源：代码库推断 / 与既有 `enforcement_mode` 字段对齐）。
- **不适合硬门控的 Rule**：`host-reply-language`（语言选择无法由 hook 强制输出侧，拦截无效）。该规则仍保留在 AGENTS.md / Rule 召回面中作为软约束，不生成原生 hook（来源：技术机制不可行 / 访谈确认待补充）。
- **可翻译的 4 条 Rule**：
  - `host-graphify-priority` → `PreToolUse`（matcher: 搜索类工具）
  - `host-task-nature-confirm` → `UserPromptSubmit`
  - `host-safety-compliance` → `UserPromptSubmit`
  - `host-fact-confirmation` → `Stop`（任务完成前检查）+ 辅助 `PreToolUse`（搜索/抓取工具调用后校验）
- **不字面翻译 Rule statement**：每个 hook 必须先做场景发散设计，只拦截真正该触发场景（来源：GateMaster 强制原则）。
- **MCP 接入方式**：本地 Trae IDE 通过 stdio 启动 memory-mcp-server（`npm run start:memory-mcp` 或 `dist/services/memory-mcp-server/src/cli.js start`），保证 hook 触发时 MCP 工具可用（来源：项目 package.json 已有脚本 / 推断）。

## 假设

- 假设本地 Trae IDE 已安装并支持 `.trae/hooks.json` 配置（个人版 >= 1.x）。
- 假设 memory-mcp-server 已通过 `npm run start:memory-mcp` 或 PM2 在本地运行，端口/stdio 可被 Trae 调用。
- 假设当前工作区根目录存在 `.trae` 目录或允许创建；`hooks.json` 放入仓库共享，不加入 `.gitignore`。
- 假设 `rule` 表中 `scope='memory.validation'` 的 active rule 即为需要翻译的候选集；若后续 scope 策略变化，需更新本 SPEC。
- 假设 hook 对自然语言意图的判断采用轻量启发式（关键词 + 工具类型），允许合理误报；误报时用户可通过 `trae.skipHooks` 或类似机制跳过（若 Trae 支持）。
- 假设安全合规 hook 只做输入侧关键词过滤；输出侧违规由模型安全层兜底，不纳入本 hook。

## 实现范围

### 做

1. **创建 `.trae/hooks/_lib.mjs`**
   - 共享工具库：BOM 剥离、stdin JSON 容错、统一输出格式化、`runHook` 入口。

2. **生成 4 个原生 hook 脚本**

   #### `host-graphify-priority.mjs`
   - **trae_event**: `PreToolUse`
   - **matcher**: `Glob|Grep|SearchCodebase|Agent`（搜索/探索类工具）
   - **shouldRun**:
     - 工具名匹配搜索类工具；
     - 上下文或用户 prompt 中包含架构/关系类关键词（如“架构”、“模块关系”、“跨模块”、“调用链”、“依赖关系”）；
     - `graphify-out/GRAPH_REPORT.md` 存在；
     - 未在最近上下文里已经调用过 `graphify` 工具。
   - **run**:
     - REJECT 并提示："架构/关系问题请先用 graphify query/path/explain，GRAPH_REPORT.md 已存在。"
     - suggestions: `graphify query "..."`、`graphify path "A" "B"`、`graphify explain "..."`。

   #### `host-task-nature-confirm.mjs`
   - **trae_event**: `UserPromptSubmit`
   - **shouldRun**:
     - 用户 prompt 中同时出现“计划/方案/文档/SPEC”类关键词和“改代码/实现/修改/增加功能”类关键词；
     - 或 prompt 明显是要求写文档/计划但包含代码路径/代码修改暗示。
   - **run**:
     - REJECT 或追加提示："请确认这是文档/计划任务还是代码改动任务。若是计划或技术文档，不得修改源代码。"
     - suggestions: 要求用户明确"只出文档"或"开始改代码"。

   #### `host-safety-compliance.mjs`
   - **trae_event**: `UserPromptSubmit`
   - **shouldRun**:
     - 用户 prompt 命中敏感词表（自伤、自杀、暴力、未成年人不当、赌博、色情等）。
   - **run**:
     - REJECT，reason: "内容违反安全合规规则，无法处理。"
     - 不返回可执行建议。

   #### `host-fact-confirmation.mjs`
   - **trae_event**: `Stop`
   - **shouldRun**:
     - 任务完成前，检查 assistant 最后回复是否包含高置信未证实声明（如"肯定是"、"绝对"、无来源的"事实"等），且本次会话未调用过 `WebSearch` / `WebFetch` / `Read` 等确认工具。
   - **run**:
     - REJECT 或 block，reason: "回复中包含未经验证的断言，请用 Read/WebSearch/WebFetch 确认后再输出。"
     - suggestions: 调用 `WebSearch` 或 `Read` 确认具体事实。

3. **更新 `.trae/hooks.json`**
   - version: 1
   - 注册上述 4 个 hook 到对应事件和 matcher。

4. **更新 `.trae/gates/registry.json`**
   - 记录 rule_id、rule_key、trae_event、matcher、file、enforcement_mode='hard_native'。
   - 保持与 `hostActionExecutor` 输出格式兼容。

5. **更新 host-action 执行结果字段**
   - 在 `hostActionExecutor.ts` 中为 rule 类型 action 增加 `enforcement_mode='hard_native'` 和 `native_hook_path`。

6. **补充 `.trae` 目录下 MCP 配置（如需要）**
   - 若 Trae 需要 `.trae/mcp.json` 才能调用 memory-mcp-server，则创建/更新。

### 不做（本期）

- 不翻译 `host-reply-language` 为原生 hook（机制不可行）。
- 不改 memory-service 后端 governance/validation 逻辑。
- 不做 hook 的远程下发或热更新；本期只落地本地文件。
- 不做 hook 执行日志持久化到数据库；只写本地 stderr/stdout。
- 不处理 TRAE Work / Web 版 hook 缺失问题。

## 资源维护闭环

- **原生 hook 脚本 `.trae/hooks/*.mjs`**：
  - 新增：GateMaster 按 rule 生成。
  - 查看：直接读取文件。
  - 编辑：手动修改或重新触发 governance 生成。
  - 删除：删除文件并从 `hooks.json` 移除条目。
  - 测试验证：在 Trae 中触发对应事件，观察是否拦截/提示。
  - 审计：`registry.json` 记录生成来源 rule_id。

- **`.trae/hooks.json`**：
  - 新增/更新：GateMaster 合并写入，不覆盖已有配置。
  - 查看：IDE 直接读取。
  - 错误反馈：若 JSON 语法错误，Trae 会忽略 hooks。

- **`.trae/gates/registry.json`**：
  - 向后兼容，记录 rule 到 hook 的映射。

## 链路反推

- **治理触发**：用户完成有价值工作 → `memory_governance_run` 产出 rule candidate → 审批通过 → 进入 `host_actions` pending 队列。
- **落地入口**：`POST /internal/host-actions/execute` 或 skill `memory-host-action-execute` 调用 `hostActionExecutor`。
- **GateMaster 分支**：对 rule 类型，生成 `.trae/hooks/{rule_key}.mjs` 并注册到 `.trae/hooks.json`，`enforcement_mode='hard_native'`。
- **运行时生效**：Trae IDE 加载 `hooks.json` → 用户提交 prompt / 调用工具 / 任务完成 → hook 脚本被调用 → 根据 `shouldRun` 判断是否拦截 → REJECT 时阻断并给出建议。
- **关键保护**：
  - 同 rule_key 幂等更新，避免重复 hook。
  - hook 脚本内部出错时 exit 0，防止 bug 导致整个 IDE 卡死。
  - 敏感词表外置或常量化，便于后续维护。

## 验收标准

- [ ] `.trae/hooks/_lib.mjs` 存在且包含 `runHook`/`readStdin`/`outputResult`。
- [ ] 4 个 hook 脚本生成，文件头包含场景发散设计注释。
- [ ] `.trae/hooks.json` 正确注册 4 个 hook，语法合法。
- [ ] `.trae/gates/registry.json` 更新，包含 4 条 rule 的 `hard_native` 记录。
- [ ] `hostActionExecutor.ts` 输出包含 `enforcement_mode='hard_native'` 和 `native_hook_path`。
- [ ] 在本地 Trae 中验证：
  - 架构问题触发搜索工具时，`host-graphify-priority` 给出提示；
  - 同时要求写计划和改代码时，`host-task-nature-confirm` 给出提示；
  - 输入敏感内容时，`host-safety-compliance` 阻断；
  - 任务完成前输出无来源断言时，`host-fact-confirmation` 阻断或提示。
- [ ] `host-reply-language` 未生成 hook，仍作为 AGENTS.md 软约束存在。

## 用户偏好记录（本次新增）

- 正向偏好：本地 Trae IDE 个人版 + GateMaster 原生 hook 是首选硬门控方案。
- 正向偏好：已确认无法硬门控的规则（如输出语言）不强行翻译，避免无效 hook。
- 正向偏好：hook 生成必须做场景发散设计，禁止字面翻译 Rule statement。

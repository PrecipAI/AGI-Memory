# Codex 宿主原始记录契约测试报告（2026-05-06）

对应项目：
- `D:\workspace\projects\SuperAgentSystem-main`

相关文档：
- `D:\workspace\projects\SuperAgentSystem-main\docs\specs\knowledge-platform\34-unified-host-record-contract.md`
- `D:\workspace\projects\SuperAgentSystem-main\docs\specs\knowledge-platform\35-host-record-coverage-matrix.md`

## 1. 测试目标

验证当前 `Codex` 侧实现，是否已经满足统一宿主原始记录读取契约中的最小要求：

1. 不重复记录宿主原始层
2. 能恢复完整会话
3. 能恢复最终 answer 前的关键执行事件流
4. 能读取 tool / MCP 成功与失败结果
5. 能把失败路径保留到治理依据，而不是只保留成功路径

## 2. 测试命令

在项目根目录执行：

```powershell
npm run verify:codex-host-capture
npm run verify:codex-governance-batch
npm run verify:codex-governance-run
```

## 3. 测试结果

### 3.1 Host Capture Preview

结果：通过

输出摘要：

- `thread_id = 019df330-e9df-7ef3-90bc-7c403ef1741e`
- `raw_event_count = 11`
- `user_message_count = 3`
- `assistant_message_count = 1`
- `commentary_count = 1`
- `command_event_count = 2`
- `tool_call_count = 1`
- `mcp_call_count = 2`
- `quality = high`

说明：

- 当前 fixture 中的真实 user message、command、tool、MCP 事件都能被读取。
- `command` 现已包含：
  - `command`
  - `cwd`
  - `exit_code`
  - `stdout_excerpt`
  - `stderr_excerpt`
  - `status`
- `tool_call` 现已包含：
  - `arguments_summary`
  - `result_summary`
  - `error_summary`
  - `status`
- `mcp_call` 现已包含：
  - `arguments_summary`
  - `result_summary`
  - `error_summary`
  - `status`

### 3.2 Governance Batch Preview

结果：通过

输出摘要：

- `rule = 1`
- `memory = 1`
- `skill_proposal = 1`
- `knowledge = 0`
- `governance_evidence = 5`

说明：

- 内部 host 会话不会再误产 `knowledge`
- 当前会话治理证据能够被单独保留

### 3.3 Governance Run

结果：通过

输出摘要：

- `rule_ids = 1`
- `memory_ids = 1`
- `skill_proposal_ids = 1`
- `synthesized_knowledge_ids = 0`
- `governance_evidence_bundle_id` 已生成
- `context_bundle_id` 已生成

治理证据保留结果：

1. `Execution step evidence`
   - `success_reason`
   - `Get-Content C:\Users\Administrator\.codex\config.toml`
2. `Command/tool availability evidence`
   - `failure_reason`
   - `rg --files`
3. `Tool execution evidence`
   - `tool_execution`
   - `shell_command`
4. `MCP execution evidence`
   - `mcp_execution`
   - `memory-v3/memory_health`
5. `MCP execution evidence`
   - `mcp_execution`
   - `memory-v3/memory_retrieve_context`

说明：

- 当前治理层已经能把 `rg --files` 失败显式保留为 `failure_reason`
- 说明问题不再只是“保存了原始步骤”，而是“治理时能读出来并形成治理依据”

## 4. 按契约逐项验收

### 4.1 不重复记录宿主原始层

结果：通过

说明：

- 当前实现读取 `Codex` 现有 session 记录，不在项目内额外复制 transcript
- 项目只做 adapter、归一化和治理

### 4.2 能恢复完整会话

结果：通过（以测试 fixture 范围计）

说明：

- user / assistant / commentary 都能恢复
- `AGENTS.md` 注入内容会被过滤，不污染真实会话样本

### 4.3 能恢复最终 answer 前的关键执行事件流

结果：通过（当前基线）

说明：

- 已覆盖 command / tool / MCP 三类关键执行事件
- 目前仍是“关键执行事件流”，不是所有可能 UI 级动作的全采样

### 4.4 tool / MCP 成功与失败都能读到

结果：部分通过

已通过：
- command 成功与失败
- MCP 调用痕迹
- tool 调用痕迹

当前缺口：
- 当前 fixture 只验证了 command failure
- 还没有单独补出一条明确的 MCP error fixture
- 也还没有验证 tool 返回错误的完整落面

### 4.5 搜索结果 / 上传知识 / 读取结果归入执行记录子类

结果：未完成

说明：

- 契约已经定了
- 但当前 `Codex` 基线测试还没有覆盖：
  - 搜索结果事件
  - 上传知识事件
  - 文档解析结果事件

这部分还需要在 adapter 或 fixture 层继续补。

## 5. 当前结论

当前 `Codex` 基线测试说明三件事：

1. 统一 host record contract 的方向是对的。
2. `Codex` 这边已经不只是 transcript 读取，而是开始具备“执行事件流读取”能力。
3. 失败路径已经开始真正进入治理依据，而不是只停留在原始日志里。

## 6. 当前仍然缺的东西

这轮测试通过，不代表全部完成。当前还缺：

1. `MCP error` 的显式 fixture 和回归
2. `tool error` 的显式 fixture 和回归
3. 搜索结果 / 上传知识 / 文档读取结果的执行事件建模
4. `Claude Code` adapter 的同 contract 测试

## 7. 最终判断

如果只看 `Codex` 测试基线：

- **机制跑通：是**
- **契约方向正确：是**
- **失败路径能被治理层读取：是**
- **已经达到完整通用接入：否**

当前更准确的状态是：

**Codex 作为测试宿主已经达到了“可用基线”，但离跨宿主完整治理输入契约，还有剩余字段和事件类型要补齐。**

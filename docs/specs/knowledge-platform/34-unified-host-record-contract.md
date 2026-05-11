# 统一宿主原始记录读取契约

对应项目：
- `D:\workspace\projects\SuperAgentSystem-main`

相关文档：
- `D:\workspace\projects\SuperAgentSystem-main\docs\specs\knowledge-platform\23-agent-host-plugin-mcp-integration.md`
- `D:\workspace\projects\SuperAgentSystem-main\docs\specs\knowledge-platform\28-host-capture-and-governance-input.md`
- `D:\workspace\projects\SuperAgentSystem-main\docs\specs\knowledge-platform\30-memory-layer-extraction-and-promotion-spec.md`

## 1. 目标

本契约定义统一长期知识系统在接入多种 agent / host 时，如何读取宿主已经存在的：

- 会话记录
- 任务执行全记录
- tool / MCP 调用
- 验证结果
- 文件变更与中间产物信息

核心原则：

1. **如果宿主已经保存原始记录，我们不重复记录原始层。**
2. **我们只做统一读取、归一化、治理。**
3. **只有当宿主没有保存关键字段，或我们无法读取该字段时，才补最小必要记录。**

## 2. 原始输入边界

治理输入的原始层只保留三类：

1. `conversation records`
2. `task execution records`
3. `existing long-term layers`

其中：

- `conversation records`：完整对话消息、commentary、用户纠偏、确认、拒绝。
- `task execution records`：最终 answer 之前的完整执行事件流。
- `existing long-term layers`：当前 active `rule / memory / skill / knowledge`。

不再把“搜索结果”“外部资料”“MCP 返回”“上传知识解析结果”视为独立第四来源。

这些内容如果存在，都应视为 `task execution records` 的子类型。

## 3. 任务执行全记录定义

只要是最终 `answer` 之前实际经过、并且用户理论上能看到或能追溯的步骤，都属于任务执行记录。

至少应包含：

1. 搜索请求与搜索结果
2. 网页/文档读取结果
3. tool 调用参数与返回
4. MCP 调用参数与返回
5. shell / 命令执行
6. 成功原因
7. 失败原因
8. 放弃原因
9. 文件改动摘要
10. 中间产物路径
11. 验证步骤与验证结果
12. 关键阶段性执行判断

这些内容默认：

- **不注入日常问答上下文**
- **只做存储**
- **只在治理时读取**

## 4. 统一读取原则

宿主适配器必须优先复用宿主已有存储，而不是重复造一份完整日志。

统一流程：

```text
host native records
-> host adapter
-> normalized records
-> governance-only read surface
-> governance routing
-> long-term outputs
```

## 5. Host Adapter 最小能力

每个宿主适配器至少要实现以下读取能力：

1. `conversation_reader`
2. `execution_reader`
3. `tool_result_reader`
4. `mcp_result_reader`
5. `artifact_reader`
6. `validation_reader`
7. `workspace_context_reader`

输出到统一 schema 时，至少具备：

- `host`
- `thread_id`
- `session_id`
- `task_request_id`（如有）
- `event_id`
- `event_type`
- `timestamp`
- `source_ref`
- `payload`
- `workspace_path`
- `governance_status`

## 6. 执行事件最小字段

### 6.1 Conversation Event

- `role`
- `text`
- `channel`
- `visibility`

### 6.2 Command Event

- `command`
- `cwd`
- `exit_code`
- `stdout_excerpt`
- `stderr_excerpt`
- `status`

### 6.3 Tool Event

- `tool_name`
- `arguments_summary`
- `result_summary`
- `status`
- `error_summary`

### 6.4 MCP Event

- `server`
- `tool`
- `arguments_summary`
- `result_summary`
- `status`
- `error_summary`

### 6.5 Artifact Event

- `artifact_type`
- `path_or_uri`
- `origin`
- `parse_status`

### 6.6 Validation Event

- `validation_type`
- `target`
- `status`
- `evidence_ref`

## 7. 治理专用读取面

从任务执行记录中整理出治理专用读取面，用于：

- 执行复盘
- 知识治理
- 失败模式识别
- 成功路径归纳

这个读取面不是额外来源，而是执行记录的治理视图。

必须能聚合出：

1. `search_result`
2. `uploaded_knowledge`
3. `execution_step`
4. `verification_evidence`
5. `failure_reason`
6. `success_reason`
7. `tool_execution`
8. `mcp_execution`

## 8. 最小补录原则

只有在以下两种情况下，系统才允许补最小必要记录：

1. 宿主没有保存关键字段。
2. 宿主保存了，但我们无法读取。

补录时只允许补缺口，不允许重复保存整份原始 transcript / 全量执行日志。

## 9. 高频失败模式要求

如果某类失败反复出现，例如：

- `memory-v3 fetch failed`
- `rg.exe Access is denied`
- 某个 MCP route 持续超时

则宿主适配器或治理读取层必须能：

1. 读取该失败事件
2. 识别同类重复
3. 在治理时形成聚合视图

这类信息默认进入治理依据，不直接进入长期 `knowledge`。

## 10. 当前实现要求

第一阶段：

1. `Codex`：直接读取本地 session / execution records
2. `Claude Code`：读取本地 transcript / session records
3. `OpenCode`：读取本地 session / message / log records
4. `OpenClaw`：读取已保存 session history 或 transcript/history surface

第二阶段：

1. `Hermes`
2. `OpenCode` 更细粒度执行结果
3. 自研 agent runtime
4. Generic MCP client hosts

## 11. 验收标准

满足以下条件，才算宿主侧原始记录读取达标：

1. 不重复存储宿主已存在的原始记录。
2. 能从宿主原始记录中恢复完整会话。
3. 能从宿主原始记录中恢复最终 answer 之前的完整执行事件流。
4. tool / MCP 成功与失败都能读取到。
5. 搜索结果、上传知识、验证结果能被识别为执行记录子类。
6. 治理层读取的是统一 schema，而不是直接依赖宿主私有格式。
7. 只有真正缺失字段时，才补最小增量记录。

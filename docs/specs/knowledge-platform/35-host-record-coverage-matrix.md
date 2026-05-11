# 宿主原始记录覆盖矩阵

对应项目：
- `D:\workspace\projects\SuperAgentSystem-main`

相关文档：
- `D:\workspace\projects\SuperAgentSystem-main\docs\specs\knowledge-platform\34-unified-host-record-contract.md`

## 1. 目标

这份矩阵只回答一个问题：

**我们计划接入的各类 agent / host，宿主本身是否已经保存了足够的原始记录，足以支撑统一治理读取。**

如果已经有，则：
- 不重复记录原始层
- 只做统一读取与归一化

如果没有或证据不足，则：
- 标记为需要验证
- 只补最小必要记录

## 2. 判定等级

- `A 已实机验证`
  - 当前机器已确认存在对应本地记录
- `B 官方文档确认`
  - 当前机器未验证，但官方文档明确说明有本地记录或可读取记录
- `C 功能面存在但原始记录形态未确认`
  - 文档说明能查看 session/history，但未确认本地持久化细节
- `D 未确认`
  - 还没有足够证据

## 3. 覆盖矩阵

| 宿主 | 记录状态 | 会话记录 | 执行记录 | tool/MCP 结果 | 本地位置/读取面 | 当前策略 |
| --- | --- | --- | --- | --- | --- | --- |
| Codex | A 已实机验证 | 有 | 有 | 有 | `C:\Users\Administrator\.codex\session_index.jsonl`、`C:\Users\Administrator\.codex\sessions\...\*.jsonl` | 直接做 adapter，优先复用现有记录 |
| Claude Code | B 官方文档确认 | 有 | 会话级有，执行细粒度待实机验证 | 待实机验证 | `~/.claude/projects/` 本地 transcript；可镜像到外部 store | 优先读宿主本地 transcript，再验证执行事件粒度 |
| OpenCode | B 官方文档确认 | 有 | 有 session/message/log 本地数据 | 待实机验证 | Windows：`%USERPROFILE%\\.local\\share\\opencode`，其中 `project/` 保存 session/message data，`log/` 保存日志 | 优先读本地 project/log 数据，不重复记录 |
| OpenClaw | C 功能面存在但原始记录形态未确认 | 有 stored sessions / transcript history | 可读 routed history；执行细粒度待确认 | MCP bridge 有 conversations/history tools | `openclaw sessions`、`openclaw sessions --json`、`messages_read` 等读取面 | 先做 reader contract，不先假设本地文件布局 |
| Hermes | D 未确认 | 未确认 | 未确认 | 未确认 | 未确认 | 先调研宿主是否已有原始记录，再决定是否补最小记录 |
| 自研 agent/runtime | D 未确认 | 取决于实现 | 取决于实现 | 取决于实现 | 取决于实现 | 强制实现统一 host record contract |
| Generic MCP client hosts | D 未确认 | 取决于宿主 | 取决于宿主 | 取决于宿主 | 取决于宿主 | 只有宿主能暴露原始记录时才进入自动治理 |

## 4. 当前机器实机结果

### 4.1 Codex

当前机器已确认存在：

- `C:\Users\Administrator\.codex\session_index.jsonl`
- `C:\Users\Administrator\.codex\sessions\...\*.jsonl`
- `C:\Users\Administrator\.codex\sqlite\`

并且当前项目已经实机从这些记录中读出过：

- user / assistant / commentary
- shell 命令执行
- tool call
- MCP call

结论：

- Codex 原始记录已经足够作为治理输入来源
- 不需要项目再重复保存原始 transcript
- 缺的不是“记录存在性”，而是“字段抽取完整性”

### 4.2 Claude Code

当前机器未发现本地目录，因此没有实机验证结果。

但官方文档明确指出：

- 客户端会把 session transcript 本地明文保存在 `~/.claude/projects/`
- 本地 transcript 默认保留 30 天
- session store 是镜像，不替代本地写入；Claude Code 总是先写本地磁盘

结论：

- Claude Code 原则上已经具备本地会话记录能力
- 需要后续在实际安装环境上验证执行事件和 tool/MCP 结果的粒度

### 4.3 OpenCode

官方文档明确指出：

- OpenCode 会把 session data 和其他应用数据保存在本地磁盘
- Windows 路径为 `%USERPROFILE%\\.local\\share\\opencode`
- `project/` 中保存 project-specific session and message data
- `log/` 中保存应用日志

结论：

- OpenCode 原则上已经具备本地会话与日志记录能力
- 后续只需验证这些数据是否足够还原完整执行事件流

### 4.4 OpenClaw

当前拿到的公开信息说明：

- `openclaw sessions` / `openclaw sessions --json` 可以列出 stored conversation sessions
- `openclaw mcp serve` 的 transcript/history tools 可以读取 routed conversation history

但当前还没有证据证明：

- 本地文件布局是什么
- 是否保存了足够细粒度的 command/tool execution 事件

结论：

- OpenClaw 已有会话历史能力
- 但原始记录承载面还需继续验证

## 5. 最终策略

### 5.1 不重复记录原始层

对于已经具备本地记录能力的宿主：

- Codex
- Claude Code
- OpenCode
- 可能的 OpenClaw

统一策略都是：

1. 不重复保存原始 transcript
2. 不重复保存完整执行日志
3. 直接读宿主现有记录
4. 归一化后进入治理

### 5.2 只补最小缺口

只有当宿主原始记录缺失以下关键字段时，才允许补最小必要记录：

- tool 返回错误
- MCP 返回错误
- 搜索结果摘要
- 上传知识解析结果
- 成功原因 / 失败原因 / 放弃原因

### 5.3 统一治理前提

只要宿主满足以下条件，就可进入统一治理：

1. 能读完整会话
2. 能读最终 answer 前的关键执行事件
3. 能读 tool / MCP 结果或错误
4. 能关联到 workspace / project

## 6. 下一步实施顺序

1. 先固化 `Codex` adapter，为字段完整性补缺口
2. 再做 `Claude Code` adapter，并验证实际本地目录与执行粒度
3. 再做 `OpenCode` adapter
4. 对 `OpenClaw` 先做 reader feasibility 验证，再决定是否直接接统一治理
5. `Hermes` 和自研 runtime 统一按 contract 做兼容性检查

# Codex 本机实际运行报告（2026-05-06）

对应项目：
- `D:\workspace\projects\SuperAgentSystem-main`

相关文档：
- `D:\workspace\projects\SuperAgentSystem-main\docs\specs\knowledge-platform\36-codex-host-record-contract-test-report-2026-05-06.md`
- `D:\workspace\projects\SuperAgentSystem-main\docs\specs\knowledge-platform\34-unified-host-record-contract.md`

## 1. 目的

本报告不是 fixture 测试，而是直接读取本机真实 `Codex` 目录：

- `C:\Users\Administrator\.codex\session_index.jsonl`
- `C:\Users\Administrator\.codex\sessions\...\*.jsonl`

验证当前实现能否：

1. 读取本机真实会话记录
2. 读取本机真实任务执行记录
3. 从真实记录中生成治理批次
4. 在不误产内部 knowledge 的前提下完成治理

## 2. 实际运行方式

通过内存服务 app 直接注入调用：

- `/internal/host-capture/codex/preview`
- `/internal/host-capture/codex/governance-batch-preview`
- `/internal/host-capture/codex/governance-run`

未显式传 `codex_home`，因此默认读取：

- `C:\Users\Administrator\.codex`

## 3. 读取到的真实线程

当前默认命中的真实线程是：

- `thread_id = 019df330-e9df-7ef3-90bc-7c403ef1741e`
- `thread_name = 验证 memory-v3 MCP 接入`
- `session_file = C:\Users\Administrator\.codex\sessions\2026\05\04\rollout-2026-05-04T21-32-42-019df330-e9df-7ef3-90bc-7c403ef1741e.jsonl`

## 4. 真实读取结果

### 4.1 Preview

- `raw_event_count = 138`
- `message_count = 21`
- `user_message_count = 1`
- `assistant_message_count = 10`
- `commentary_count = 10`
- `command_event_count = 20`
- `tool_call_count = 26`
- `mcp_call_count = 6`

说明：

- 当前实现已经能从本机真实 `.codex` 记录中读出完整会话与大量执行事件。
- 当前线程中只有 1 条真实 user message 被保留，是因为这是那次“验证 memory-v3 MCP 接入”的独立线程本身，不是今天这个超长会话。

### 4.2 Governance Batch Preview

当前真实线程抽出的候选中，最重要的是：

- `rule_candidates = 1`
- `memory_candidates = 1`
- `skill_proposal_candidates = 1`
- `knowledge_candidates = 0`
- `governance_evidence_candidates` 大于 fixture，包含大量真实执行步骤

关键点：

- 真实线程中的内部执行、验证、MCP 调用，没有再被误提成长期 `knowledge`
- 失败路径也被保留为治理依据

## 5. 真实治理结果

真实运行一次 `governance-run` 后，结果为：

- `rule_ids = 1`
- `memory_ids = 1`
- `skill_proposal_ids = 1`
- `synthesized_knowledge_ids = 0`
- `governance_evidence_bundle_id` 已生成

这说明：

1. 当前实现能够对本机真实会话做治理，不依赖 fixture。
2. 当前 host 内部会话不会误产 `knowledge`。
3. 当前治理重点已经转成：
   - `rule`
   - `memory`
   - `skill proposal`
   - `governance evidence`

## 6. 真实保留到治理依据的内容

真实线程里被识别并保留的治理依据，代表性包括：

1. 配置检查
   - 读取 `C:\Users\Administrator\.codex\config.toml`
2. 验证路径
   - `memory-mcp doctor`
   - `npm run verify:mcp-cli`
   - `npm run verify:mcp-client-smoke`
   - `npm run verify:mcp`
3. 失败路径
   - `rg -n "\[mcp_servers\.memory-v3\]" ...` 失败
4. MCP 调用轨迹
   - `memory_health`
   - `memory_retrieve_context`
   - `memory_ingest_candidate`
   - `memory_run_governance`

## 7. 当前实现已经证明的能力

这次真实运行已经证明：

1. 本机真实 `.codex` 会话记录可以直接作为治理输入。
2. 本机真实 `.codex` 任务执行记录可以直接作为治理输入。
3. 统一 host record contract 不只是测试概念，已经能作用于真实本地会话。

## 8. 当前还没有做到的事

虽然真实运行已经成功，但当前还没做到：

1. 一次自动扫描多个线程并做跨会话批量治理
2. 对多个历史线程做去重、聚合和故障复发统计
3. 自动把“今天这个 live 窗口”与历史窗口一起批量纳入同一轮治理

所以现在的状态是：

- **单线程真实治理：已可行**
- **跨会话批量治理：方向可行，但还没实现完整批处理入口**

## 9. 对“新开窗口跨会话治理”的判断

如果你的使用方式是：

1. 固定在一个新的 Codex 窗口里运行治理
2. 让该窗口去读取 `C:\Users\Administrator\.codex` 里的全部会话与执行记录
3. 再按未治理状态做批次治理

那么这个方向是可行的。

原因：

- 会话记录已经统一落在 `.codex`
- 执行记录也已经在 `.codex` 的 session 事件里
- 当前实现已经能读取并治理真实单线程

但当前还需要再补一个正式能力：

- `跨线程批量扫描 + 未治理批次装配 + 去重/聚合 + 批次治理`

也就是说：

- **方向没问题**
- **基础能力已证明**
- **真正的跨会话批处理入口还需要继续实现**

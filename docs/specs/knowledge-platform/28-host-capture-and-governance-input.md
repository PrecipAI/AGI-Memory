# Host Capture And Governance Input Design

## 1. 目标

为统一长期知识系统补齐一层跨宿主的原始材料接入框架，把 `Codex`、`Claude Code` 以及后续其他 agent host 的会话记录、执行轨迹、工具调用、文件变更和验证结果，统一纳入治理输入池。

本设计要解决的不是“某个 host 能不能连上 MCP”，而是“治理到底基于什么原始材料”。

## 2. 本轮确认结论

以下结论已由用户确认，后续实现必须严格遵守：

1. 当前治理结果失真，根因不是原始数据不存在，而是治理输入范围过窄。
2. 本地 host 已经保存了大量原始记录，不能只对已写入 `memory_v3` 的 candidate 做治理。
3. 治理必须基于：
   - 未治理会话
   - 未治理任务执行记录
   - 已有长期层
4. 设计原则必须采用：
   - 由浅入深
   - 由表及里
5. 这不是只给 Codex 打补丁，而是为 `Codex`、`Claude Code` 等宿主定义统一 capture contract。

## 3. 问题定义

当前系统的主要问题不是没有记录，而是没有把原始记录正式接入治理链。

以 Codex 为例，本机已经存在：

- `C:\Users\Administrator\.codex\session_index.jsonl`
- `C:\Users\Administrator\.codex\sessions\2026\...\*.jsonl`
- `C:\Users\Administrator\.codex\logs_2.sqlite`
- `C:\Users\Administrator\.codex\state_5.sqlite`

这些文件中已经包含：

- 线程索引
- 会话消息
- 命令执行事件
- 工具调用事件
- 部分输出与错误
- 配置与运行状态

但当前治理链主要从如下对象出发：

- `memory_candidate`
- `memory`
- `skill`
- `resident_snapshot`

这会导致两个后果：

1. 治理输入严重缩窄，只整理“已经被写进去的一小部分对象”。
2. 用户在会话中表达的关键意图、纠偏、拒绝偏好、设计确认和执行过程，大量没有进入治理输入。

因此，当前问题是“治理输入接入缺失”，不是“治理器不会运行”。

## 4. 设计原则

## 4.1 由浅入深

治理不要一上来就做高层抽象，必须先收集稳定的表层记录，再逐层上提：

1. 先拿表层原始记录：
   - 会话消息
   - 命令执行
   - 工具调用
   - 文件变更
   - 验证结果
   - 用户确认 / 否决
2. 再做结构化中间对象：
   - session event
   - task event
   - artifact
   - evidence
   - decision candidate
3. 再做治理输出：
   - rule
   - memory
   - skill proposal
   - knowledge

## 4.2 由表及里

治理不能只停在“发生了什么”，还要继续判断“这件事说明了什么”：

1. 表层：
   - 说了什么
   - 做了什么
   - 改了什么
   - 成功还是失败
2. 里层：
   - 用户偏好
   - 项目约束
   - 设计决策
   - 失败模式
   - 可复用流程
   - 跨来源规律

## 4.3 原始记录先全量纳管，长期层再严格收敛

原始记录可以多，长期层必须少而精。

因此系统要区分：

- `capture corpus`
- `intermediate governance objects`
- `long-term outputs`

不能把“原始记录多”错误地等同于“长期记忆多”。

## 5. 总体架构

```text
host raw records
-> host adapter
-> normalized capture corpus
-> governance batch input
-> classification and synthesis
-> long-term outputs
   - rules
   - memory
   - skill proposals
   - knowledge
-> context assembly
```

核心新增的是中间两层：

1. `host adapter`
2. `normalized capture corpus`

## 6. 宿主适配范围

第一阶段必须覆盖：

1. `Codex`
2. `Claude Code`

第二阶段预留：

1. `Claude Desktop`
2. `OpenCode`
3. `OpenClaw`
4. 自研 agent / 后端 agent runtime

## 7. Host Capture 层

## 7.1 Host Capture 职责

Host Capture 只负责把宿主原始记录取出来并标记上下文，不负责直接决定是否进入长期层。

职责包括：

1. 发现未治理线程 / 任务
2. 读取宿主原始日志
3. 读取关联工作目录
4. 抽取执行事件
5. 识别文件变更
6. 识别用户确认 / 拒绝 / 纠偏
7. 输出统一 capture payload

## 7.2 Codex Adapter

Codex 第一阶段至少读取：

1. `session_index.jsonl`
2. `sessions/**/*.jsonl`
3. `logs_2.sqlite`
4. 当前项目目录中的变更痕迹

Codex adapter 需要识别：

1. 线程 id
2. turn 边界
3. user message
4. assistant message
5. commentary / final
6. shell/tool execution
7. file edit
8. verification result
9. user correction

## 7.3 Claude Code Adapter

Claude Code adapter 采用同样的外壳，不绑定某个具体本地文件名。

第一阶段 contract 只要求宿主能提供等价数据：

1. thread / session id
2. message stream
3. tool execution stream
4. file change summary
5. command result summary
6. user approval / rejection markers

如果 Claude Code 的本地日志格式与 Codex 不同，差异只允许存在于 adapter 层，不能污染治理层 schema。

## 7.4 Generic Host Adapter

对于后续宿主，统一要求实现：

```yaml
host_name:
thread_locator:
message_reader:
execution_reader:
artifact_reader:
approval_reader:
normalizer:
```

没有 adapter 的宿主不进入自动治理，只允许手工导入。

## 8. Normalization 层

## 8.1 统一输入对象

不同 host 的原始记录统一转换为以下中间对象：

1. `captured_session`
2. `captured_turn`
3. `captured_message`
4. `captured_execution_event`
5. `captured_tool_event`
6. `captured_file_change`
7. `captured_validation_event`
8. `captured_user_decision`
9. `captured_artifact`

## 8.2 最小字段

每个中间对象至少带：

- `host`
- `thread_id`
- `task_id`
- `event_id`
- `event_type`
- `timestamp`
- `source_ref`
- `payload`
- `workspace_path`
- `governance_status`

`governance_status` 至少支持：

- `ungoverned`
- `governed`
- `superseded`
- `discarded`

## 8.3 任务聚合

治理不是按单条 event 做，而是按任务聚合。

一个 `governance batch` 至少由以下输入组成：

1. 当前任务关联的未治理会话消息
2. 当前任务关联的未治理执行事件
3. 当前任务关联的文件变更与验证结果
 4. 当前任务执行中出现的搜索结果、上传知识、读取结果与中间产物
 5. 与该任务强相关的已有长期层对象

## 9. Governance Input 层

## 9.1 治理输入范围

每次治理必须面向完整批次，而不是只看单条 candidate。

治理输入包括：

1. `ungoverned_sessions`
2. `ungoverned_execution_events`
3. `ungoverned_artifacts`
4. `active_rules`
5. `active_memory`
6. `active_knowledge`
7. `active_skills`

## 9.2 治理前检查

治理开始前必须先检查：

1. 本次是否包含未治理会话
2. 本次是否包含未治理执行记录
3. 本次是否只看到了 candidate 而漏掉 host raw records
4. 本次是否只会产出测试残留项
5. 本次是否具备足够证据支撑知识合成

如果输入池明显不完整，必须返回：

- 机制可运行
- 但治理输入不完整

不能再把这种情况汇报成“治理成功”。

## 10. 四层输出判定

## 10.1 Rule

只保留：

- `must`
- `must_not`

只有真正约束后续 agent 行为的内容才能进入 `rule`。

来源通常包括：

1. 用户明确强约束
2. 审批通过的治理规则
3. 项目硬边界
4. 安全 / 权限 / 审批强约束

## 10.2 Memory

只保留长期稳定事实：

1. 用户长期偏好
2. 项目长期约束事实
3. 已确认设计决策
4. 长期有效环境事实
5. 已验证的失败模式总结

不允许把一次性运行细节、验证细节、测试细节直接塞进长期 memory。

## 10.3 Skill

skill 只允许通过 proposal 进入变更流程。

治理可以输出：

- `new_skill_proposal`
- `update_skill_proposal`
- `split_skill_proposal`
- `merge_skill_proposal`
- `retire_skill_proposal`

没有用户批准，不允许直接改真实 `SKILL.md`。

## 10.4 Knowledge

knowledge 是最重要的长期产物。

它不是观点列表，而是经过以下处理后的知识对象：

1. 去重
2. 合并
3. 抽象提升
4. 冲突检测
5. 适用边界标注
6. 来源溯源

`document / section / fact / relation / evidence` 默认只作为中间层和溯源层存在。

## 11. 知识合成要求

当前治理效果不合格的核心原因之一，是 knowledge 还停在“整理观点”，没有做到“合并总结”。

修正后，knowledge synthesis 必须显式支持：

1. 多条相近结论合并为更高一层规律
2. 不同来源相互支撑时上提为综合知识
3. 不同来源明显冲突时保留冲突，不强行合并
4. 低相关内容允许保持孤岛
5. 高相关内容不能错误保持孤岛

示意：

```text
多个事实 / 多篇文档 / 多次任务结论
-> 增量匹配
-> 判断是重复、补充、冲突还是可抽象提升
-> 生成新的 knowledge object
-> 保留来源与证据链
```

## 12. 会话与执行记录的价值

会话和执行记录不是“辅助材料”，而是治理的核心原料之一。

至少要从会话与执行里抽这几类信息：

1. 用户正向偏好
2. 用户否定偏好
3. 用户纠偏
4. 设计确认
5. 阶段切换
6. 失败路径
7. 成功验证
8. 不应再重复尝试的错误路径
9. 值得沉淀为 knowledge 的抽象判断
10. 值得形成 skill proposal 的执行规律

## 13. 状态模型

新增 capture corpus 后，治理状态至少分为：

1. `captured`
2. `normalized`
3. `batched`
4. `governed`
5. `applied`
6. `discarded`

宿主原始记录不能在未归档前直接丢弃。

## 14. 与现有系统的关系

该设计不是替换原有：

- `memory_run_governance`
- `memory_retrieve_context`
- `resident_snapshot`

而是在它们前面新增一个更完整的输入层。

新的顺序应为：

```text
host capture
-> normalize
-> governance batch assembly
-> governance
-> resident rebuild
-> context assembly
```

## 15. 实施顺序

### Phase 1

1. 固化本 spec
2. 定义 capture corpus schema
3. 定义 Codex adapter contract
4. 定义 Claude Code adapter contract

### Phase 2

1. 先落 Codex adapter
2. 扫描本地 session 和 log
3. 生成 ungoverned batch
4. 做一次只读审计，验证输入覆盖面

### Phase 3

1. 把 ungoverned batch 接到治理层
2. 修 knowledge synthesis
3. 修 rule / memory / skill 入口判定

### Phase 4

1. 实现 Claude Code adapter
2. 接统一 normalization
3. 跑跨 host 的一致性测试

## 16. 验收标准

1. 治理前可以明确列出当前线程有哪些未治理会话和未治理执行记录。
2. 治理输入不再只来自 `memory_candidate`。
3. Codex 本地 `sessions/*.jsonl` 与日志中的关键内容能进入治理批次。
4. Claude Code 有明确 adapter contract，不再是口头预留。
5. 治理结果能区分：
   - 机制跑通
   - 输入完整
   - 内容合格
6. knowledge 产物能体现合并、抽象提升和冲突处理，而不是简单观点堆积。
7. rule / memory / skill 不再混入测试残留、接入事实和一次性验证细节。
8. 每次治理都能说明：
   - 这次用了哪些原始输入
   - 产出了哪些长期对象
   - 丢弃了哪些内容
   - 为什么丢弃

## 17. 开放问题

1. Claude Code 本地日志与执行记录的最稳定读取面是什么。
2. 是否需要单独的 `governance_batch` 物理表，还是先用现有表扩展。
3. session capture 是否需要增量游标和断点续扫。
4. host raw records 的清理与保留周期如何设计。
5. 是否要把“当前线程完整治理输入预览”做进 Ops Console。

# AGI-Memory 项目自有 Skills

本目录存放 AGI-Memory 项目自身的 skill 定义文件（SKILL.md），与 `hostBootstrap.ts` 中的元数据一一对应。

## 目录结构

```
skills/
├── README.md                           # 本文件
├── memory-extract-preview/SKILL.md     # 记忆抽取预览（不写库）
├── memory-governance-run/SKILL.md      # 治理运行（写库 + L2/L3/L4）
├── memory-layer-links-query/SKILL.md   # 跨层派生关系查询
├── memory-learning-chain-detect/SKILL.md # 学习行为链检测
├── memory-recall-assemble/SKILL.md     # 上下文装配（回答前注入）
├── memory-governance-review/SKILL.md   # 审批队列查询与通知
├── memory-host-action-execute/SKILL.md # host-actions 队列消费与落地
├── memory-governance-knowledge/SKILL.md # 治理体系知识（纯知识型）
├── memory-lifecycle/SKILL.md           # 生命周期维护
├── GateMaster/SKILL.md                 # Rule → Hook 代码生成
└── skill-creator/SKILL.md              # Skill → SKILL.md 生成
```

## 与 hostBootstrap.ts 的关系

`services/memory-service/src/hostBootstrap.ts` 在服务启动时将这 11 个 skill 注册到数据库（幂等），包含 `skill_key`、`title`、`description`、`skill_type`、`risk_level`、`tags` 等元数据。

本目录的 SKILL.md 文件是这些 skill 的**完整定义**，包含触发条件、执行步骤、API 调用和注意事项。

## skill 分类

| skill_key | 类型 | 说明 |
|-----------|------|------|
| memory-extract-preview | procedural | 抽取预览，不写库 |
| memory-governance-run | procedural | 完整治理运行，写库 |
| memory-layer-links-query | procedural | 查询跨层派生关系 |
| memory-learning-chain-detect | procedural | 检测学习行为链 |
| memory-recall-assemble | procedural | 装配上下文用于回答前注入 |
| memory-governance-review | procedural | 查询并通知待审批候选 |
| memory-host-action-execute | procedural | 消费 host-actions 队列，落地硬编码 |
| memory-governance-knowledge | knowledge | 治理体系知识（纯知识型，不调 API） |
| memory-lifecycle | knowledge | 生命周期维护任务 |
| GateMaster | procedural | Rule → Hook 代码生成 |
| skill-creator | procedural | Skill → SKILL.md 生成 |

## 运行时产物 vs 源码定义

- **本目录**（`skills/`）是源码定义，提交到 Git 仓库。
- **运行时产物**（`.trae/skills/`）由 `host-actions/execute` 自动生成，已被 `.gitignore` 忽略。
- 两者关系：源码定义是"模板"，运行时产物是"实例化后的结果"。

---
name: memory-governance-knowledge
description: >
  记忆治理体系知识：四层派生机制（Memory 事实/Rule 门控/Skill 流程/Knowledge 认知）、
  复合信号拆分（PowerShell 案例）、Knowledge 双重门槛（OOD + Reusable）、学习行为链判定。
  用于回答治理机制相关问题。
---

# Memory Governance Knowledge

## 触发条件

满足以下任一条件即触发：

1. **用户询问治理机制** — 用户问"四层派生是什么""治理体系怎么工作""L2/L3/L4 是什么"。
2. **用户询问 Knowledge 门槛** — 用户问"什么样的知识才会被存""Knowledge 的判断标准是什么"。
3. **用户询问复合信号** — 用户问"复合信号怎么拆分""PowerShell 案例是什么"。
4. **用户询问学习链** — 用户问"学习行为链怎么判定""什么情况下合成 Knowledge"。

## 知识内容

### 四层派生机制

```
Memory (事实层)  ──derived_from──▶  Rule (门控层)
     │                                    │
     │                              constrains
     │                                    │
     ▼                                    ▼
Skill (流程层)  ◀──explains──  Knowledge (认知层)
```

| 层 | 职责 | 存储表 | 生命周期 |
|----|------|--------|----------|
| Memory | 记录事实型知识（用户偏好、项目约定、经验教训） | `memory` | 长期 |
| Rule | 门禁型约束（IF/THEN 规则，必须遵守） | `rule` | 长期 |
| Skill | 流程型操作（多步骤可执行流程） | `skill` | 长期 |
| Knowledge | 认知型综合（跨事实归纳、外部检索获取） | `kp_synthesized_knowledge` | 长期 |

### 治理流水线

| 阶段 | 名称 | 作用 |
|------|------|------|
| L2 | 冲突检测 | 语义级查重：≥0.96 丢弃，0.50-0.96 分类（CONTRADICTION/SPECIALIZATION/EXTENSION/GENERALIZATION） |
| L3 | 演进扫描 | 检测跨层信号、写入 layer_links 派生关系 |
| L4 | 认知合成 | 跨事实归纳生成 Knowledge，需满足双重门槛 |

### Knowledge 双重门槛

1. **模型 OOD（Out-of-Distribution）** — 模型训练数据中不包含的知识。
2. **可复用** — 跨会话、跨项目可复用的知识，非一次性信息。

两个条件**同时满足**才会持久化为 Knowledge。

### 复合信号拆分

当一条候选同时包含"事实根因"和"硬门禁约束"时，必须拆分为两条：
- 一条 Memory（存储事实根因）
- 一条 Rule（存储门禁约束）
- 通过 `layer_links.derived_from` 关联

典型案例：PowerShell 环境差异（`&&` 不支持、UTF-8 编码问题）既是事实又是约束。

### 学习行为链

```
search → learn → apply → summary
```

- **search**：通过工具检索外部信息
- **learn**：理解并提取关键知识
- **apply**：将知识应用到当前任务
- **summary**：产出总结性文本

只有四步完整（`isComplete=true`）才允许合成 Knowledge。缺少 summary 则不硬造（防御原则）。

## 注意事项

- 此 skill 是纯知识型，不需要调用 API。
- 回答时引用具体的表名和字段名，便于用户理解数据结构。
- 如果用户进一步询问具体操作，引导到对应的 procedural skill。

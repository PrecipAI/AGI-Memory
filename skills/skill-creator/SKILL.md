---
name: skill-creator
description: >
  将治理系统审批通过的 skill 记录转换为宿主可识别的 SKILL.md 文件。
  生成 .trae/skills/{skill_key}/SKILL.md，包含 frontmatter + 触发条件 + 执行步骤。
---

# Skill Creator

## 触发条件

1. **host-actions/execute 自动调用** — 当 host-actions 队列中有 `create_skill` 类型的待处理 action 时。
2. **不需要用户手动触发** — 审批通过后自动执行。

## 执行步骤

1. 从 host-action payload 中读取技能信息：
   - `skill_key` — 技能唯一标识
   - `title` — 技能标题
   - `description` — 技能描述
   - `procedure_payload.execution_steps` — 执行步骤
   - `applicable_scenarios` — 适用场景
   - `non_applicable_scenarios` — 不适用场景
   - `trigger_conditions` — 触发条件
   - `origin_scope` / `availability_scope` — 作用域
2. 确定生成路径：
   - 全局技能 → `~/.trae-cn/skills/{skill_key}/SKILL.md`
   - 项目技能 → `.trae/skills/{skill_key}/SKILL.md`
3. 生成 SKILL.md 文件，包含：
   - YAML frontmatter（`name`、`description`）
   - 描述段落
   - 使用场景列表
   - 不适用场景列表
   - 执行步骤（有序列表）
   - 触发条件（JSON 格式）
   - 作用域信息
4. 创建目录（如不存在）并写入文件。

## 生成的 SKILL.md 模板

```markdown
---
name: {title}
description: {description}
---

# {title}

## 描述

{description}

## 使用场景

- 场景 1
- 场景 2

## 不适用场景

- 场景 1

## 指令

1. 第一步
2. 第二步
3. 第三步

## 触发条件

\`\`\`json
{trigger_conditions}
\`\`\`

## 作用域

- Origin scope: {origin_scope}
- Availability scope: {availability_scope}
```

## 注意事项

- 全局技能的 SKILL.md 生成到用户目录 `~/.trae-cn/skills/`，项目技能生成到 `.trae/skills/`。
- `.trae/skills/` 是运行时产物，已被 `.gitignore` 忽略。
- 全局技能严禁在描述中引用项目特定名称、角色名、文件路径或故事设定。
- 如果技能没有 `execution_steps`，则标注"暂无执行步骤"。

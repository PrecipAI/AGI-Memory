---
name: memory-layer-links-query
description: >
  查询跨层派生关系。
  传入 source_id 或 target_id，返回 derived_from/explains/constrains/provenance 关联记录。
  用于回溯一条 Rule 的事实根因 Memory，或反查一条 Memory 对应的硬门控 Rule。
---

# Memory Layer Links Query

## 触发条件

满足以下任一条件即触发：

1. **用户询问根因** — 用户问"为什么这条规则存在""这条记忆的根因是什么""这个规则是从哪来的"。
2. **用户询问派生** — 用户问"这条记忆派生出了哪些规则/技能""这个知识是从哪些事实推导出来的"。
3. **显式触发** — 用户说"查一下层关系""看看派生链"。

## 执行步骤

1. 确定查询参数：
   - `source_id` — 查询某个实体派生出了哪些下游实体
   - `target_id` — 查询某个实体是由哪些上游实体派生的
   - `relation_type` — 可选过滤：`derived_from` / `explains` / `constrains` / `provenance`
2. 调用 `GET /internal/layer-links`，传入查询参数。
3. 解析返回结果，向用户展示派生链：
   ```
   Memory(事实根因) → derived_from → Rule(门禁规则) → constrains → Skill(执行流程)
                                                  → explains → Knowledge(认知综合)
   ```
4. 如果无结果，告知用户"未找到跨层派生关系"。

## API 调用

```
GET /internal/layer-links?source_id={id}&relation_type={type}
GET /internal/layer-links?target_id={id}&relation_type={type}

Headers:
  x-tenant-id: {tenant}
  x-scope: {scope}
```

## 注意事项

- `derived_from` 关系为单向存储，避免冗余。
- 层链接数据由 L3 演进扫描自动写入，不需要手动创建。
- 如果 L4 未写入 `derived_from` 关系，可能返回空（已知限制）。

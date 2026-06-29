-- 0017: 为 kp_synthesized_knowledge 添加 scope 治理字段
--
-- 背景：L4 认知引擎产出的合成知识缺少 origin_scope 和 availability_scope 字段，
-- 导致 retrievalHook 的 shouldRecall 走到"未知 scope：保守策略，不召回"分支，
-- 合成知识被静默过滤，Agent 永远收不到 L4 的合成产出。
--
-- ⚠️ 重要设计决策：retrieve 链路的"静默失效而非显式报错"
-- 这两列是 retrieve 链路的入口条件。shouldRecall 对未知 scope 走保守策略 return false，
-- 不抛异常、不记日志、不告警——合成知识直接消失在过滤层，上层完全无感知。
-- 这类"静默失效"的设计决策如果不文档化，下次排查类似问题要走很长的诊断路径：
--   queryActiveDerivedKnowledge 返回 2 条 → buildRetrieveBundle 返回 0 条 →
--   追踪到 applyRetrievalHook → shouldRecall → 发现 scope 字段缺失
-- 本次根因是靠评估脚本的 synthLayerRecall 指标逼出来的，不是代码审查或测试用例。
-- 教训：涉及"保守策略"的过滤逻辑，其入口条件必须有 NOT NULL DEFAULT 兜底 + 文档化。
--
-- NOT NULL DEFAULT 已自动 backfill 所有历史记录为 'project' / 'project_reusable'，
-- 无需额外 backfill SQL。但如果未来有其他表走同样的 shouldRecall 逻辑，
-- 必须确保对应的 scope 列也有 NOT NULL DEFAULT。

ALTER TABLE kp_synthesized_knowledge
    ADD COLUMN IF NOT EXISTS origin_scope text NOT NULL DEFAULT 'project';

ALTER TABLE kp_synthesized_knowledge
    ADD COLUMN IF NOT EXISTS availability_scope text NOT NULL DEFAULT 'project_reusable';

-- 为 scope 过滤建索引
CREATE INDEX IF NOT EXISTS idx_kp_synthesized_knowledge_scope_filter
    ON kp_synthesized_knowledge (tenant_id, scope, origin_scope, availability_scope, status);

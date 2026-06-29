-- 0018: 为 kp_synthesized_knowledge 添加 rejected_at 字段，支持反馈学习的 reject 衰减
--
-- 背景：L4 反馈学习从历史被 Reject 的假设组合中学习，对同类假设降权。
-- 原实现是累计计数无衰减——3 次 Reject 后永久最大降权（扣 0.3）。
-- 这会导致一次性的错误判断永久影响该类型假设的生成。
--
-- 本 migration 添加 rejected_at 字段，loadRejectedHypothesisCombos 只查
-- rejected_at >= NOW() - INTERVAL '90 days' 的记录。
-- 90 天窗口内的 Reject 才降权，之前的自动失效。
--
-- rejected_at 在 applyKnowledgeReviewAction 的 reject 分支设置。
-- 历史已 reject 的记录 rejected_at 为 NULL，不会进入 90 天窗口，等同于已衰减。

ALTER TABLE kp_synthesized_knowledge
    ADD COLUMN IF NOT EXISTS rejected_at TIMESTAMPTZ;

-- 为衰减查询建索引
CREATE INDEX IF NOT EXISTS idx_kp_synthesized_knowledge_rejected_at
    ON kp_synthesized_knowledge (tenant_id, scope, review_state, rejected_at)
    WHERE review_state IN ('rejected', 'human_rejected');

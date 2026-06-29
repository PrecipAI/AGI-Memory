-- 0023: 遗忘机制第一步——合成知识 TTL 归档
--
-- 问题：kp_synthesized_knowledge 只增不减，写入即 curated/active，永不淘汰。
-- 跑久了知识库膨胀，召回质量下降。真正的记忆需要选择性遗忘。
--
-- 第一步（TTL 归档）：
--   1. 加 last_recalled_at 字段，retrieve 召回时更新
--   2. 90 天没召回的 lifecycle_state='archived'，不再参与召回
--
-- 这不够（不是认知科学的重要性加权衰减），但是必要的开始。
-- 中期目标是 importance * recency * frequency 的加权衰减。

BEGIN;

ALTER TABLE kp_synthesized_knowledge
    ADD COLUMN IF NOT EXISTS last_recalled_at timestamptz;

-- 给已有数据填个默认值（用 updated_at），避免一上来全归档
UPDATE kp_synthesized_knowledge
SET last_recalled_at = COALESCE(last_recalled_at, updated_at, created_at, now())
WHERE last_recalled_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_kp_synthesized_knowledge_recall_ttl
    ON kp_synthesized_knowledge (tenant_id, scope, last_recalled_at)
    WHERE status = 'active' AND lifecycle_state = 'curated';

COMMIT;

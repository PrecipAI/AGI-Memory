-- 0026: kp_synthesized_knowledge.importance_weight 字段
-- 用于加权衰减：retrieve 排序 + 归档判定
--
-- 三因子加权：importance_weight = 0.3×recency + 0.3×frequency + 0.4×utility
-- recency = exp(-days_since_last_recall / 30)
-- frequency = log(1+recall_count) / log(1+max_recall_count_in_scope)
-- utility = knowledge_utility.utility_score ?? 0.5
--
-- 归档条件（取代 90 天 TTL）：
--   importance_weight < 0.2 AND importance_weight_updated_at < now() - 30 days
--
-- 归档保护：
--   归档前检查同 scope 最近 30 天平均 term_hit_ratio
--   < 0.4 → 跳过归档（retrieve 的锅，不是知识的锅）
--
-- 数据不足降级：
--   session_outcomes < 300 条时，importance_weight 全部 0.5

BEGIN;

ALTER TABLE kp_synthesized_knowledge
    ADD COLUMN IF NOT EXISTS importance_weight double precision NOT NULL DEFAULT 0.5;

ALTER TABLE kp_synthesized_knowledge
    ADD COLUMN IF NOT EXISTS importance_weight_updated_at timestamptz;

-- 初始化 importance_weight_updated_at 为已知的更新时间
UPDATE kp_synthesized_knowledge
SET importance_weight_updated_at = COALESCE(importance_weight_updated_at, updated_at, created_at, now())
WHERE importance_weight_updated_at IS NULL;

-- retrieve 排序索引：按 importance_weight 降序
CREATE INDEX IF NOT EXISTS idx_kp_synthesized_knowledge_importance_weight
    ON kp_synthesized_knowledge (tenant_id, scope, importance_weight DESC)
    WHERE status = 'active' AND lifecycle_state = 'curated';

-- 归档扫描索引：按 importance_weight_updated_at 升序（老的最先归档）
CREATE INDEX IF NOT EXISTS idx_kp_synthesized_knowledge_importance_weight_updated_at
    ON kp_synthesized_knowledge (tenant_id, scope, importance_weight_updated_at)
    WHERE status = 'active' AND lifecycle_state = 'curated';

COMMIT;

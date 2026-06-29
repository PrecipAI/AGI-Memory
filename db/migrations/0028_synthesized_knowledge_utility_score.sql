-- ─── fix-9: utility_score 列 ───
-- 修复 fix-8 SPEC 假设但 schema 缺失的字段
-- importance_weight = 0.3×recency + 0.3×frequency + 0.4×utility
-- utility_score 由 recomputeImportanceWeights 从 retrieve_quality_log 反推：
--   同 scope 最近 30 天平均 term_hit_ratio 高 → utility 高
-- 不设默认值（NULL 表示无信号，应用层处理）

ALTER TABLE kp_synthesized_knowledge
    ADD COLUMN IF NOT EXISTS utility_score double precision;

-- utility_score 更新时间戳，用于追踪信号时效
ALTER TABLE kp_synthesized_knowledge
    ADD COLUMN IF NOT EXISTS utility_score_updated_at timestamptz;

-- 索引：按 utility_score 排序，retrieve 排序时用
CREATE INDEX IF NOT EXISTS idx_kp_synthesized_knowledge_utility_score
    ON kp_synthesized_knowledge (tenant_id, scope, utility_score DESC NULLS LAST)
    WHERE status = 'active' AND lifecycle_state = 'curated';

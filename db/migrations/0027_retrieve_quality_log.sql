-- 0027: retrieve_quality_log 表
-- 记录每次 retrieve 的 term 命中率，给归档保护做数据底子
--
-- 背景：归档保护需要查"最近 30 天同 scope 的平均 term_hit_ratio"
-- 如果 retrieve 整体 poor，归档应该跳过（retrieve 的锅，不是知识的锅）
--
-- 复用信号：buildMetacognitionAssessment 算 knowledge_gaps 后顺便算 term_hit_ratio
-- 不需要额外分词，零成本

BEGIN;

CREATE TABLE IF NOT EXISTS kp_retrieve_quality_log (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id       text NOT NULL,
    scope           text NOT NULL,
    status          record_status NOT NULL DEFAULT 'active',
    trace_id        text NOT NULL,
    query           text NOT NULL,
    query_terms     jsonb NOT NULL DEFAULT '[]'::jsonb,
    hit_terms       jsonb NOT NULL DEFAULT '[]'::jsonb,
    term_hit_ratio  double precision NOT NULL,
    retrieve_quality text NOT NULL CHECK (retrieve_quality IN ('good', 'partial', 'poor')),
    created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_kp_retrieve_quality_log_scope_time
    ON kp_retrieve_quality_log (tenant_id, scope, created_at DESC)
    WHERE status = 'active';

COMMIT;

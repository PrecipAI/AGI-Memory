-- 0025: 阈值校准表——从 session_outcomes 反推 L2 阈值
--
-- 背景：L2 的 DUPLICATE_THRESHOLD=0.96 / SIMILARITY_TRIGGER=0.50 / JACCARD_DUPLICATE_THRESHOLD=0.80
-- 都是拍脑袋决定的常数。这些阈值应该从真实对话 outcome 反推：
--
-- 核心思路（来自用户原话）：
--   "被标记为 failure_recovered 的对话里，retrieve 到的相似知识的分布是什么？
--    这个分布就是阈值应该在的位置，不是拍脑袋决定的常数。"
--
-- 数学逻辑：
--   - success 组的 query-content 相似度分布 = "刚好够用"的相似度
--   - failure_recovered 组 = "接近但需要纠正"的相似度
--   - failure 组 = "不相关或误导"的相似度
--
-- 阈值反推：
--   - SIMILARITY_TRIGGER 应 ≤ failure_recovered 组 P25（让"接近但需纠正"的能进入 L2 检测）
--   - DUPLICATE_THRESHOLD 应 > success 组 P95（避免把"刚好够用"的判为重复 SKIP）
--
-- 校准在 lifecycleWorker 跑完归档后执行，结果写入本表。
-- L2ConflictDetector 读取最新校准值，带 fallback 到默认常数。

BEGIN;

CREATE TABLE IF NOT EXISTS kp_threshold_calibration (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id       text NOT NULL,
    scope           text NOT NULL,
    status          record_status NOT NULL DEFAULT 'active',
    threshold_name  text NOT NULL CHECK (threshold_name IN (
        'similarity_trigger', 'duplicate_threshold', 'jaccard_duplicate_threshold'
    )),
    recommended_value   double precision NOT NULL,
    default_value       double precision NOT NULL,
    applied_value       double precision NOT NULL,
    sample_size         integer NOT NULL,
    basis_outcome       text NOT NULL,
    distribution_p25    double precision,
    distribution_p50    double precision,
    distribution_p95    double precision,
    rationale           text,
    calibrated_at       timestamptz NOT NULL DEFAULT now(),
    created_at          timestamptz NOT NULL DEFAULT now(),
    updated_at          timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_kp_threshold_calibration_latest
    ON kp_threshold_calibration (tenant_id, scope, threshold_name, calibrated_at DESC)
    WHERE status = 'active';

COMMIT;

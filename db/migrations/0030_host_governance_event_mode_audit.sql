-- 0030: host_governance_event 加 governance_mode 审计列
--
-- 背景：之前 governance_mode 只能藏在 metadata jsonb 里查，而且实际根本没写进去。
-- L1 抽取的"主路径是不是真的走了 host_model"完全不可观测。
-- 现在把 governance_mode / model_adapter_mode / model_ref / accepted / warning 提升为一等公民字段，
-- 便于审计 host_model 路径是否真的被走通，以及 fallback 是否在静默发生。
--
-- 同时为 preview_token 机制预留存储（token 主体放内存表，这里只存 token_id 做关联追溯）。

BEGIN;

ALTER TABLE host_governance_event
    ADD COLUMN IF NOT EXISTS governance_mode text,
    ADD COLUMN IF NOT EXISTS model_adapter_mode text,
    ADD COLUMN IF NOT EXISTS model_ref text,
    ADD COLUMN IF NOT EXISTS accepted boolean,
    ADD COLUMN IF NOT EXISTS warning text,
    ADD COLUMN IF NOT EXISTS preview_token_id uuid;

-- 历史数据 backfill：所有既有记录在新增列前都没有 host_model 信息，统一标记为 unknown。
-- 不假设是 rules_fallback，因为历史可能混杂两种模式，标记 unknown 比误标更诚实。
UPDATE host_governance_event
SET governance_mode = COALESCE(governance_mode, 'unknown'),
    model_adapter_mode = COALESCE(model_adapter_mode, 'unknown'),
    accepted = COALESCE(accepted, false)
WHERE governance_mode IS NULL OR model_adapter_mode IS NULL;

-- 索引：按 mode 过滤是高频审计查询（"最近哪些 run 实际走了 fallback"）
CREATE INDEX IF NOT EXISTS idx_host_governance_event_mode_audit
    ON host_governance_event (tenant_id, scope, governance_mode, model_adapter_mode, accepted, created_at DESC);

-- preview_token_id 索引：从 token 反查 event 用
CREATE INDEX IF NOT EXISTS idx_host_governance_event_preview_token
    ON host_governance_event (tenant_id, scope, preview_token_id)
    WHERE preview_token_id IS NOT NULL;

COMMIT;

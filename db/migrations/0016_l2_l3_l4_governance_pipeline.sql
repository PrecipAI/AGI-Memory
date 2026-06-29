-- 0016: L2/L3/L4 治理流水线扩展
-- 扩展 governance_change_proposal 支持冲突检测和演进扫描的提案

ALTER TABLE governance_change_proposal
  ADD COLUMN IF NOT EXISTS conflict_metadata JSONB DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS evolution_signal TEXT,
  ADD COLUMN IF NOT EXISTS original_artifact_id UUID,
  ADD COLUMN IF NOT EXISTS proposed_action_type TEXT DEFAULT 'add';
  -- proposed_action_type: add | update | delete | merge | supersede | upgrade_scope | strengthen

-- 索引：按提案类型和状态查询
CREATE INDEX IF NOT EXISTS idx_governance_change_proposal_action_type
  ON governance_change_proposal(tenant_id, scope, proposed_action_type, status, created_at DESC);

-- 索引：按演进信号类型查询
CREATE INDEX IF NOT EXISTS idx_governance_change_proposal_evolution_signal
  ON governance_change_proposal(tenant_id, scope, evolution_signal, status, created_at DESC);

-- 索引：按原始制品 ID 查询（用于查某条 rule/skill/memory 上挂了哪些提案）
CREATE INDEX IF NOT EXISTS idx_governance_change_proposal_original_artifact
  ON governance_change_proposal(tenant_id, scope, original_artifact_id, status, created_at DESC);

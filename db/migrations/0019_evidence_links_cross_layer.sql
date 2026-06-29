-- 0019: evidence 跨层关联表
--
-- 背景：当前 evidence 只通过 kp_synthesized_knowledge_evidence 关联到 synthesized_knowledge，
-- 无法表达"这条 rule 从哪轮对话的哪句话抽取的"。
-- 用户原话："一条 Rule 被抽取，它的 evidence 应该是那段用户原话或 AI 推理过程"
--
-- 本 migration 新建 evidence_links 表，让 evidence 能关联到 rule/skill/memory/synthesis 任意层。
-- L1 candidateIngress 写入 rule/skill/memory 时同步建 evidence → target 关联，link_type='source_of'。
-- 图谱能展示"这条规则从第几轮对话的哪句话抽取的"。
--
-- link_type 语义：
--   source_of    — evidence 是 target 的来源（L1 抽取时建）
--   supports     — evidence 支持 target（L4 合成时建）
--   explains     — evidence 解释 target
--   contradicts  — evidence 与 target 矛盾

CREATE TABLE IF NOT EXISTS evidence_links (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id text NOT NULL,
    scope text NOT NULL,
    status record_status NOT NULL DEFAULT 'active',
    evidence_id uuid NOT NULL REFERENCES kp_evidence(id) ON DELETE CASCADE,
    target_id uuid NOT NULL,
    target_layer text NOT NULL CHECK (target_layer IN ('rule','skill','knowledge','memory','synthesis')),
    link_type text NOT NULL CHECK (link_type IN ('supports','explains','source_of','contradicts')),
    confidence real NOT NULL DEFAULT 1.0,
    trace_id text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (evidence_id, target_id, target_layer, link_type)
);

CREATE INDEX IF NOT EXISTS idx_evidence_links_target
    ON evidence_links (tenant_id, scope, target_layer, target_id)
    WHERE status = 'active';
CREATE INDEX IF NOT EXISTS idx_evidence_links_evidence
    ON evidence_links (tenant_id, scope, evidence_id)
    WHERE status = 'active';

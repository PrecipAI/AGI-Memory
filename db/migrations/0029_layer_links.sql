-- 0029: layer_links 跨层派生关系表
--
-- 背景：四层架构升级（从"分类"到"派生"）。
-- 复合信号（如"PowerShell + UTF-8 乱码"）必须同时派生 Memory（事实根因）+ Rule（门控逻辑），
-- 并建立 derived_from 关系连接，禁止二选一。
--
-- 与 evidence_links（0019）的区别：
--   evidence_links = evidence → target（evidence 是 target 的来源/支持/解释）
--   layer_links    = target  → target（跨层派生/约束/追溯关系）
--
-- 单向存储原则：
--   constrains 单向存储 A constrains B（A 约束 B），
--   查询"谁约束了 B"用反查 WHERE target_id = B AND link_type = 'constrains'，
--   避免双向存储的数据冗余和不一致。
--
-- link_type 语义：
--   derived_from  — A 由 B 派生（如 Rule derived_from Memory：Rule 是从 Memory 事实推导出的门控）
--   explains      — A 解释 B（如 Memory explains Rule：解释为什么这条 Rule 存在）
--   constrains    — A 约束 B（单向：A 是约束方，B 是被约束方）
--   provenance    — A 是 B 的来源追溯（A 是 B 的认知源头）

CREATE TABLE IF NOT EXISTS layer_links (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id text NOT NULL,
    scope text NOT NULL,
    status record_status NOT NULL DEFAULT 'active',
    source_id uuid NOT NULL,
    source_layer text NOT NULL CHECK (source_layer IN ('rule','skill','knowledge','memory')),
    target_id uuid NOT NULL,
    target_layer text NOT NULL CHECK (target_layer IN ('rule','skill','knowledge','memory')),
    link_type text NOT NULL CHECK (link_type IN ('derived_from','explains','constrains','provenance')),
    confidence real NOT NULL DEFAULT 1.0,
    trace_id text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (source_id, target_id, link_type)
);

CREATE INDEX IF NOT EXISTS idx_layer_links_source
    ON layer_links (tenant_id, scope, source_layer, source_id)
    WHERE status = 'active';

CREATE INDEX IF NOT EXISTS idx_layer_links_target
    ON layer_links (tenant_id, scope, target_layer, target_id)
    WHERE status = 'active';

CREATE INDEX IF NOT EXISTS idx_layer_links_link_type
    ON layer_links (tenant_id, scope, link_type)
    WHERE status = 'active';

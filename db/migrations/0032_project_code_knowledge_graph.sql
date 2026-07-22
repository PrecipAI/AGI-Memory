-- 0032: 项目代码知识图谱接入
--
-- 背景：Graphify 代码知识图谱接入 AGI-Memory，作为 Knowledge 层的"项目代码"分支。
-- Spec: docs/specs/knowledge-platform/42-project-code-knowledge-graph-spec.md
--
-- 改动：
-- 1. 扩展 layer_links.link_type CHECK 约束，新增 4 种代码图谱边类型
-- 2. 加 layers 表 project_structure 索引（按 kind 前缀过滤）
--
-- link_type 新增值：
--   calls        — 函数 A 调用函数 B
--   imports      — 模块 A 导入模块 B
--   belongs_to   — 函数 A 属于类 B
--   depends_on   — 服务 A 依赖服务 B

-- 1. 扩展 layer_links.link_type CHECK 约束
-- 新增 4 种代码图谱边类型：calls / imports / belongs_to / depends_on
ALTER TABLE layer_links DROP CONSTRAINT IF EXISTS layer_links_link_type_check;
ALTER TABLE layer_links ADD CONSTRAINT layer_links_link_type_check
    CHECK (link_type IN (
        'derived_from', 'explains', 'constrains', 'provenance',
        'calls', 'imports', 'belongs_to', 'depends_on'
    ));

-- 2. kp_synthesized_knowledge 表 project_structure 索引
-- 注意：本项目没有 layers 表，knowledge 数据存储在 kp_synthesized_knowledge
-- project_structure knowledge 用 knowledge_type='project_structure' 过滤
CREATE INDEX IF NOT EXISTS idx_kp_synthesized_knowledge_project_structure
    ON kp_synthesized_knowledge (tenant_id, scope, knowledge_type)
    WHERE status = 'active' AND knowledge_type = 'project_structure';

-- 3. layer_links 代码图谱边索引（按 link_type 过滤）
CREATE INDEX IF NOT EXISTS idx_layer_links_code_graph
    ON layer_links (tenant_id, scope, link_type)
    WHERE status = 'active' AND link_type IN ('calls','imports','belongs_to','depends_on');

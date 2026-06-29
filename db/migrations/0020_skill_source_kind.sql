-- 0020: 为 skill 表添加 source_kind 字段，区分技能来源
--
-- 背景：skill 表之前没有"数据来源"维度，前端 getSkillCategory 用 origin_scope 推断来源，
-- 但 session 级 skill（L1 抽取的、host capture 的、新建未指定作用域的）全 fallback 到 "host"，
-- 导致 L1 抽取出来的技能也被标成"宿主"。
--
-- source_kind 取值：
--   host_builtin    — 宿主自带技能（如 skill-creator / gate-master）
--   l1_extracted    — L1 candidateIngress 从对话抽取的技能
--   user_uploaded   — 用户下载/上传的技能
--   system_seed     — 系统种子数据
--
-- 默认 'l1_extracted'：因为现有 skill 几乎都是 L1 抽取的（host_builtin 走宿主本地 SKILL.md，不进数据库）

ALTER TABLE skill
    ADD COLUMN IF NOT EXISTS source_kind text NOT NULL DEFAULT 'l1_extracted';

-- 加索引便于按来源筛选
CREATE INDEX IF NOT EXISTS idx_skill_source_kind
    ON skill (tenant_id, scope, source_kind)
    WHERE status = 'active';

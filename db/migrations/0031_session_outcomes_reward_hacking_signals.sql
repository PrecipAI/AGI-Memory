-- 0031: 反投机取巧信号——session_outcomes 加 SUPERSEDED outcome + 分类推翻信号字段
--
-- 背景：反 Reward Hacking 改进方案方向四。
-- session_outcomes 之前只记录任务级 outcome（成功/失败/恢复/知识过时/放弃），
-- 没有专门记录"这条知识当初的分类判断后来被证明是错的"这种信号。
--
-- 本次改动：
--   1. outcome 枚举加 'superseded'（分类判断被后续推翻）
--   2. 新增 classification_overturned / overturn_source / overturn_detected_at 字段
--   3. 更新 knowledge_utility 视图加 classification_overturn_rate 指标
--
-- 数据回路：
--   L3 演进扫描 SUPERSEDED → 写 session_outcomes (outcome='superseded', classification_overturned=true, overturn_source='l3_evolution')
--   人工审批推翻 → 写 session_outcomes (classification_overturned=true, overturn_source='manual_review')
--   L2 冲突推翻初判 → 写 session_outcomes (classification_overturned=true, overturn_source='l2_conflict')

BEGIN;

-- 1. 加 SUPERSEDED outcome
ALTER TABLE session_outcomes
  DROP CONSTRAINT IF EXISTS session_outcomes_outcome_check;
ALTER TABLE session_outcomes
  ADD CHECK (outcome IN (
    'success', 'failure', 'failure_recovered',
    'knowledge_outdated', 'abandoned', 'superseded'
  ));

-- 2. 加"分类判断被推翻"信号字段
ALTER TABLE session_outcomes
  ADD COLUMN IF NOT EXISTS classification_overturned boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS overturn_source text CHECK (overturn_source IN (
    'review_trace', 'l3_evolution', 'l2_conflict', 'manual_review', 'self_test_crosscheck'
  )),
  ADD COLUMN IF NOT EXISTS overturn_detected_at timestamptz;

-- 3. 索引：按"被推翻"筛选
CREATE INDEX IF NOT EXISTS idx_session_outcomes_overturned
  ON session_outcomes (tenant_id, scope, classification_overturned)
  WHERE status = 'active' AND classification_overturned = true;

-- 4. 更新 knowledge_utility 视图：加"分类推翻率"指标
CREATE OR REPLACE VIEW knowledge_utility AS
SELECT
  UNNEST(retrieved_ids) AS entry_id,
  COUNT(*)::int AS total_recalls,
  COUNT(*) FILTER (WHERE outcome IN ('success', 'failure_recovered'))::int AS success_count,
  COUNT(*) FILTER (WHERE outcome IN ('failure', 'abandoned'))::int AS failure_count,
  COUNT(*) FILTER (WHERE outcome = 'knowledge_outdated')::int AS outdated_count,
  COUNT(*) FILTER (WHERE outcome = 'superseded')::int AS superseded_count,
  COUNT(*) FILTER (WHERE classification_overturned = true)::int AS classification_overturned_count,
  CASE WHEN COUNT(*) > 0
    THEN COUNT(*) FILTER (WHERE outcome IN ('success', 'failure_recovered'))::real / COUNT(*)
    ELSE NULL
  END AS utility_score,
  CASE WHEN COUNT(*) > 0
    THEN COUNT(*) FILTER (WHERE classification_overturned = true)::real / COUNT(*)
    ELSE NULL
  END AS classification_overturn_rate
FROM session_outcomes
WHERE status = 'active'
GROUP BY UNNEST(retrieved_ids);

-- 5. 同步更新 knowledge_utility_used 视图
CREATE OR REPLACE VIEW knowledge_utility_used AS
SELECT
  UNNEST(used_ids) AS entry_id,
  COUNT(*)::int AS total_uses,
  COUNT(*) FILTER (WHERE outcome IN ('success', 'failure_recovered'))::int AS success_count,
  COUNT(*) FILTER (WHERE outcome IN ('failure', 'abandoned'))::int AS failure_count,
  COUNT(*) FILTER (WHERE outcome = 'superseded')::int AS superseded_count,
  COUNT(*) FILTER (WHERE classification_overturned = true)::int AS classification_overturned_count,
  CASE WHEN COUNT(*) > 0
    THEN COUNT(*) FILTER (WHERE outcome IN ('success', 'failure_recovered'))::real / COUNT(*)
    ELSE NULL
  END AS utility_score,
  CASE WHEN COUNT(*) > 0
    THEN COUNT(*) FILTER (WHERE classification_overturned = true)::real / COUNT(*)
    ELSE NULL
  END AS classification_overturn_rate
FROM session_outcomes
WHERE status = 'active' AND array_length(used_ids, 1) > 0
GROUP BY UNNEST(used_ids);

COMMIT;

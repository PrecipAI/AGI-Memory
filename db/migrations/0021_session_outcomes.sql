-- 0021: Outcome Tracker — 记录每次对话 retrieve 用了哪些知识 + 任务结果
--
-- 背景：之前系统是"只写不读反馈"的知识收集器——retrieve 把知识取出来放进 AI 上下文，
-- 但系统永远不知道这条知识在那次对话里有没有帮上忙。utility_score 无法计算。
--
-- session_outcomes 记录每次对话的 outcome + 这次 retrieve 用了哪些条目，
-- knowledge_utility 视图聚合出每条知识的成功率（utility_score），
-- 供 P1-3 的 retrieve ranking 使用：高效用浮上来，低效用沉底。
--
-- outcome 取值：
--   success             — 任务完成，用户继续下一个问题
--   failure             — 任务失败，用户明确报错
--   failure_recovered   — 失败后 AI 自我纠正并成功
--   knowledge_outdated  — AI 识别出已有知识过时
--   abandoned           — 用户放弃

BEGIN;

CREATE TABLE IF NOT EXISTS session_outcomes (
    id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id        text NOT NULL,
    scope            text NOT NULL,
    status           record_status NOT NULL DEFAULT 'active',
    session_id       text NOT NULL,
    round_number     integer,
    task_description text,

    -- 这次 retrieve 用了哪些（从 retrieve hook 注入）
    retrieved_ids    uuid[] NOT NULL DEFAULT ARRAY[]::uuid[],

    -- AI 实际引用了哪些（用 citation 追踪，可空）
    used_ids         uuid[] NOT NULL DEFAULT ARRAY[]::uuid[],

    -- outcome 来源
    outcome          text NOT NULL CHECK (outcome IN (
        'success', 'failure', 'failure_recovered', 'knowledge_outdated', 'abandoned'
    )),

    -- 工具执行结果（可从 tool_result 自动推断）
    tool_success     boolean,
    failure_reason   text,

    -- 场景类型（数据集来源：ai_corrected / tool_failure_recovered / knowledge_outdated / user_error）
    scenario_type    text,

    trace_id         text NOT NULL,
    created_at       timestamptz NOT NULL DEFAULT now()
);

-- 按 tenant+scope 查最近 outcome
CREATE INDEX IF NOT EXISTS idx_session_outcomes_scope
    ON session_outcomes (tenant_id, scope, created_at DESC)
    WHERE status = 'active';

-- 按 outcome 筛选（统计成功率用）
CREATE INDEX IF NOT EXISTS idx_session_outcomes_outcome
    ON session_outcomes (tenant_id, scope, outcome)
    WHERE status = 'active';

-- GIN 索引加速 retrieved_ids / used_ids 的 UNNEST 查询
CREATE INDEX IF NOT EXISTS idx_session_outcomes_retrieved_gin
    ON session_outcomes USING GIN (retrieved_ids)
    WHERE status = 'active';
CREATE INDEX IF NOT EXISTS idx_session_outcomes_used_gin
    ON session_outcomes USING GIN (used_ids)
    WHERE status = 'active';

-- knowledge_utility 视图：聚合每条知识的成功率
-- 这是 P1-3 retrieve ranking 的输入
-- utility_score = success_count / total_uses
-- NULL 表示从未被用到（无信号，不影响 ranking）
CREATE OR REPLACE VIEW knowledge_utility AS
SELECT
    UNNEST(retrieved_ids) AS entry_id,
    COUNT(*)::int AS total_recalls,
    COUNT(*) FILTER (WHERE outcome IN ('success', 'failure_recovered'))::int AS success_count,
    COUNT(*) FILTER (WHERE outcome IN ('failure', 'abandoned'))::int AS failure_count,
    COUNT(*) FILTER (WHERE outcome = 'knowledge_outdated')::int AS outdated_count,
    CASE WHEN COUNT(*) > 0
        THEN COUNT(*) FILTER (WHERE outcome IN ('success', 'failure_recovered'))::real / COUNT(*)
        ELSE NULL
    END AS utility_score
FROM session_outcomes
WHERE status = 'active'
GROUP BY UNNEST(retrieved_ids);

-- 同样的视图但只统计 AI 实际引用过的条目（used_ids）
-- 这个比 retrieved_ids 更精准：retrieved 是进了上下文，used 是 AI 真的引用了
CREATE OR REPLACE VIEW knowledge_utility_used AS
SELECT
    UNNEST(used_ids) AS entry_id,
    COUNT(*)::int AS total_uses,
    COUNT(*) FILTER (WHERE outcome IN ('success', 'failure_recovered'))::int AS success_count,
    COUNT(*) FILTER (WHERE outcome IN ('failure', 'abandoned'))::int AS failure_count,
    CASE WHEN COUNT(*) > 0
        THEN COUNT(*) FILTER (WHERE outcome IN ('success', 'failure_recovered'))::real / COUNT(*)
        ELSE NULL
    END AS utility_score
FROM session_outcomes
WHERE status = 'active' AND array_length(used_ids, 1) > 0
GROUP BY UNNEST(used_ids);

COMMIT;

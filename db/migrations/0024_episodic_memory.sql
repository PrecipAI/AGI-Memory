-- 0024: 情景记忆表——从 session_outcomes 升级到真正记忆的桥梁
--
-- 问题：系统只有语义记忆的索引（memory/rule/skill/kp_synthesized_knowledge），
-- 没有情景记忆。session_outcomes 记录了"retrieve 用了什么 + outcome 是什么"，
-- 但没有结构化的"什么时候、发生了什么、AI 知道什么、做了什么、结果怎样、因果链"。
--
-- 情景记忆是离 AGI 最近的一步：把时序因果结构化，让系统能"回忆"而非"检索"。
--
-- 设计：
--   - 从 session_outcomes 提炼写入（规则提炼，后续 L4 接 LLM 后可升级）
--   - 每条 episodic_memory 对应一轮对话的"事件"
--   - causal_chain 是 JSONB 数组：[{step, action, result}]
--   - lessons 根据 outcome 类型推导，供后续 ranking 参考

BEGIN;

CREATE TABLE IF NOT EXISTS episodic_memory (
    id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id        text NOT NULL,
    scope            text NOT NULL,
    status           record_status NOT NULL DEFAULT 'active',
    version          integer NOT NULL DEFAULT 1,

    -- 什么时候
    event_time       timestamptz NOT NULL DEFAULT now(),
    session_id       text NOT NULL,
    round_number     integer,

    -- 发生了什么
    task_description text NOT NULL,
    scenario_type    text,

    -- AI 知道什么（retrieve 召回的知识摘要）
    ai_knew          jsonb NOT NULL DEFAULT '[]'::jsonb,

    -- AI 做了什么（工具调用/回复摘要）
    ai_did           text,

    -- 结果怎样
    outcome          text NOT NULL CHECK (outcome IN (
        'success', 'failure', 'failure_recovered', 'knowledge_outdated', 'abandoned'
    )),
    tool_success     boolean,

    -- 因果链：[{step, action, result}] 结构化记录事件链
    causal_chain     jsonb NOT NULL DEFAULT '[]'::jsonb,

    -- 教训：从 outcome 推导
    -- success → "知识有效，可复用"
    -- failure_recovered → "初次失败后恢复，知识需补充"
    -- knowledge_outdated → "知识过时，需更新"
    lessons          text,

    -- 关联
    source_outcome_id uuid REFERENCES session_outcomes(id) ON DELETE SET NULL,
    trace_id         text NOT NULL,

    created_at       timestamptz NOT NULL DEFAULT now(),
    updated_at       timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_episodic_memory_session
    ON episodic_memory (tenant_id, scope, session_id, round_number)
    WHERE status = 'active';

CREATE INDEX IF NOT EXISTS idx_episodic_memory_time
    ON episodic_memory (tenant_id, scope, event_time DESC)
    WHERE status = 'active';

CREATE INDEX IF NOT EXISTS idx_episodic_memory_outcome
    ON episodic_memory (tenant_id, scope, outcome)
    WHERE status = 'active';

COMMIT;

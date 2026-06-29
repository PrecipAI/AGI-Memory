import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { getPool } from "../../libs/db/dist/pool.js";
import { buildMemoryServiceApp } from "../../services/memory-service/dist/services/memory-service/src/app.js";

/**
 * Behavioral oracle test suite for host_model governance quality.
 *
 * These tests do not check rejection regexes; they assert that a session with a
 * given semantic fingerprint produces the *right* governance outputs and does
 * not produce the wrong ones. Each oracle is a binary behavioral claim.
 *
 * TODO: replace the synthetic extraction_preview payloads below with real
 * captured session fixtures once the golden-standard sessions are checked in.
 */

const app = buildMemoryServiceApp();
const tenantId = "tenant-local";
const scope = "memory.validation";

function makeBasePayload(overrides = {}) {
  return {
    host: "generic",
    governance_mode: "host_model",
    fingerprint: null,
    extraction_preview: {
      rule_candidates: [],
      memory_candidates: [],
      skill_proposal_candidates: [],
      knowledge_candidates: [],
      governance_evidence_candidates: [],
      ...overrides.extraction_preview
    },
    ...overrides
  };
}

function makeSourceRef(kind = "assistant_message") {
  return {
    source_kind: kind,
    source_timestamp: "2026-06-22T10:00:00.000Z",
    source_excerpt: "session excerpt"
  };
}

async function runGovernance(payload) {
  const response = await app.inject({
    method: "POST",
    url: "/internal/governance/run-from-extraction",
    headers: {
      "x-tenant-id": tenantId,
      "x-scope": scope,
      "x-trace-id": `oracle-${Date.now()}-${Math.random().toString(36).slice(2)}`
    },
    payload
  });
  assert.equal(response.statusCode, 200, response.body);
  return response.json();
}

async function cleanup(traceId) {
  const pool = getPool();
  await pool.query(
    `DELETE FROM rule WHERE tenant_id = $1 AND scope = $2 AND trace_id = $3`,
    [tenantId, scope, traceId]
  );
  await pool.query(
    `DELETE FROM memory WHERE tenant_id = $1 AND scope = $2 AND trace_id = $3`,
    [tenantId, scope, traceId]
  );
  await pool.query(
    `DELETE FROM governance_change_proposal WHERE tenant_id = $1 AND scope = $2 AND trace_id = $3`,
    [tenantId, scope, traceId]
  );
  await pool.query(
    `DELETE FROM kp_synthesized_knowledge WHERE tenant_id = $1 AND scope = $2 AND trace_id = $3`,
    [tenantId, scope, traceId]
  );
  await pool.query(
    `DELETE FROM host_governance_event WHERE tenant_id = $1 AND scope = $2 AND trace_id = $3`,
    [tenantId, scope, traceId]
  );
}

// Oracle 1: Recurring identical error in a debugging session must produce a
// preflight rule or skill proposal ("由点及面"), not just isolated memories.
async function oracleRecurringErrorProducesPreflight() {
  const traceId = `oracle-recurring-error-${Date.now()}`;
  try {
    const payload = makeBasePayload({
      trace_id: traceId,
      extraction_preview: {
        // TODO: replace with a real session containing the same stack trace 3+ times.
        // The memory captures WHO the user is (profile), while rule/skill capture the
        // generalizable preflight action derived from the recurring error.
        memory_candidates: [
          {
            candidate_type: "memory_candidate",
            title: "User communication preferences",
            origin_scope: "user",
            availability_scope: "user_reusable",
            governance_level: "shared",
            promotion_status: "active",
            memory_type: "user_memory",
            stability: "long_lived",
            source_kind: "assistant_message",
            source_timestamp: "2026-06-22T10:00:00.000Z",
            content: "用户是后端工程师，偏好简洁回答，讨厌废话。",
            source_excerpt: "用户是后端工程师，偏好简洁回答，讨厌废话。",
            reason: "User profile derived from recurring debugging pattern.",
            confidence: "high"
          }
        ],
        rule_candidates: [
          {
            candidate_type: "rule_candidate",
            title: "Preflight Zod schema check before API integration tests",
            origin_scope: "project",
            availability_scope: "project_reusable",
            governance_level: "shared",
            promotion_status: "active",
            rule_domain: "execution",
            source_kind: "assistant_message",
            source_timestamp: "2026-06-22T10:00:01.000Z",
            content:
              "IF an API endpoint test fails with a Zod validation error THEN MUST verify the request schema matches the declared Zod shape BEFORE changing business logic.",
            source_excerpt:
              "IF an API endpoint test fails with a Zod validation error THEN MUST verify the request schema matches the declared Zod shape BEFORE changing business logic.",
            reason: "Generalize recurring error into a preflight rule.",
            confidence: "high",
            source_refs: [makeSourceRef("user_message"), makeSourceRef("assistant_message")],
            metadata: {
              human_readable_statement:
                "遇到 Zod 验证错误时，必须先对照 schema 声明检查请求结构，再修改业务逻辑。",
              classification_rationale: "这是 IF/THEN 约束性规则，适合 rule_candidate。"
            }
          }
        ],
        skill_proposal_candidates: [],
        knowledge_candidates: []
      }
    });

    const body = await runGovernance(payload);

    const hasRuleOrSkill =
      body.persisted.rule_items.length > 0 || body.persisted.skill_proposal_items.length > 0;
    assert.ok(
      hasRuleOrSkill,
      "recurring error must produce a preflight rule or skill proposal, not just memory"
    );
  } finally {
    await cleanup(traceId);
  }
}

// Oracle 2: Session whose only evidence is project-internal conversation must
// yield zero knowledge candidates (§9 boundary).
async function oracleProjectInternalConversationYieldsNoKnowledge() {
  const traceId = `oracle-project-internal-${Date.now()}`;
  try {
    const payload = makeBasePayload({
      trace_id: traceId,
      extraction_preview: {
        // TODO: replace with a real session about "本项目的 node_modules 缺失".
        knowledge_candidates: [
          {
            candidate_type: "knowledge_candidate",
            title: "Project build failure cause",
            origin_scope: "project",
            availability_scope: "project_reusable",
            governance_level: "shared",
            promotion_status: "active",
            knowledge_type: "pattern",
            source_kind: "assistant_message",
            source_timestamp: "2026-06-22T10:00:00.000Z",
            content: "构建失败是因为本项目的 node_modules 缺失，需要重新安装依赖。",
            source_excerpt: "构建失败是因为本项目的 node_modules 缺失，需要重新安装依赖。",
            reason: "Observed project-internal state.",
            confidence: "high"
          }
        ]
      }
    });

    const response = await app.inject({
      method: "POST",
      url: "/internal/governance/run-from-extraction",
      headers: {
        "x-tenant-id": tenantId,
        "x-scope": scope,
        "x-trace-id": traceId
      },
      payload
    });

    assert.equal(response.statusCode, 400, response.body);
    assert.ok(response.body.includes("spec 39 §9 violation"));
  } finally {
    await cleanup(traceId);
  }
}

// Oracle 3: A concrete operational point like ".env config" must split into
// rule + memory + skill proposal, not collapse into a single abstract knowledge.
async function oracleConcretePointSplitsAcrossLayers() {
  const traceId = `oracle-concrete-point-${Date.now()}`;
  try {
    const payload = makeBasePayload({
      trace_id: traceId,
      extraction_preview: {
        // TODO: replace with a real session about ".env 配置规范".
        rule_candidates: [
          {
            candidate_type: "rule_candidate",
            title: "Env files must not be committed",
            origin_scope: "project",
            availability_scope: "project_reusable",
            governance_level: "shared",
            promotion_status: "active",
            rule_domain: "execution",
            source_kind: "user_message",
            source_timestamp: "2026-06-22T10:00:00.000Z",
            content: "IF a file is named .env THEN MUST NOT commit it to git; MUST add it to .gitignore.",
            source_excerpt: "IF a file is named .env THEN MUST NOT commit it to git.",
            reason: "Concrete operational constraint.",
            confidence: "high",
            source_refs: [makeSourceRef("user_message"), makeSourceRef("assistant_message")],
            metadata: {
              human_readable_statement: "禁止将 .env 文件提交到版本控制。",
              classification_rationale: "这是 IF/THEN 约束。"
            }
          }
        ],
        memory_candidates: [
          {
            candidate_type: "memory_candidate",
            title: "Project uses .env for secrets",
            origin_scope: "project",
            availability_scope: "project_reusable",
            governance_level: "shared",
            promotion_status: "active",
            memory_type: "project_memory",
            stability: "long_lived",
            source_kind: "assistant_message",
            source_timestamp: "2026-06-22T10:00:01.000Z",
            content:
              "用户是团队负责人，偏好用明确的检查清单约束新成员行为，讨厌依赖口头叮嘱传递规范。",
            source_excerpt:
              "用户是团队负责人，偏好用明确的检查清单约束新成员行为，讨厌依赖口头叮嘱传递规范。",
            reason: "User profile derived from .env onboarding concern.",
            confidence: "high"
          }
        ],
        skill_proposal_candidates: [
          {
            candidate_type: "skill_proposal_candidate",
            title: "Add .env handling to onboarding skill",
            origin_scope: "project",
            availability_scope: "project_reusable",
            governance_level: "shared",
            promotion_status: "needs_review",
            source_kind: "assistant_message",
            source_timestamp: "2026-06-22T10:00:02.000Z",
            target_skill: "onboarding",
            target_skill_path: null,
            change_type: "update",
            current_section: "Setup",
            current_text: "Clone the repo and run npm install.",
            current_gap: "New contributors may accidentally commit .env files.",
            proposed_text: "Clone the repo, run npm install, and copy .env.example to .env. Ensure .env is in .gitignore.",
            proposed_patch: "*** Begin Patch\n+ Copy .env.example to .env and verify .gitignore excludes .env\n*** End Patch",
            validation_method: "Check .gitignore contains .env.",
            rationale: "Concrete point should become skill procedure.",
            reason: "Concrete point should become skill procedure.",
            proposal_quality: "actionable",
            source_refs: [makeSourceRef("user_message"), makeSourceRef("assistant_message")],
            merged_source_count: 1,
            source_excerpt: "New contributors may accidentally commit .env files."
          }
        ],
        knowledge_candidates: []
      }
    });

    const body = await runGovernance(payload);

    assert.ok(body.persisted.rule_items.length > 0, "concrete point must produce a rule");
    assert.ok(body.persisted.memory_items.length > 0, "concrete point must produce a memory");
    assert.ok(
      body.persisted.skill_proposal_items.length > 0,
      "concrete point must produce a skill proposal"
    );
    assert.equal(
      body.persisted.knowledge_items.length,
      0,
      "concrete operational point must not collapse into knowledge"
    );
  } finally {
    await cleanup(traceId);
  }
}

// Oracle 3.5: The dashboard-fix session must split .env into rule + memory +
// skill, keep Zod as the single knowledge item, and discard the typo todo.
async function oracleDashboardSessionSplitsAndDiscards() {
  const traceId = `oracle-dashboard-${Date.now()}`;
  try {
    const golden = JSON.parse(
      await fs.readFile("./tests/fixtures/dashboard-golden.json", "utf8")
    );
    const payload = makeBasePayload({
      trace_id: traceId,
      extraction_preview: golden
    });

    const body = await runGovernance(payload);

    assert.ok(body.persisted.rule_items.length > 0, ".env point must produce a rule");
    assert.ok(body.persisted.memory_items.length > 0, ".env point must produce a memory");
    assert.ok(
      body.persisted.skill_proposal_items.length > 0,
      ".env point must produce a skill proposal"
    );
    assert.equal(
      body.persisted.knowledge_items.length,
      1,
      "only the Zod insight should become knowledge"
    );
    assert.equal(
      body.persisted.knowledge_items[0].knowledge_type,
      "limitation",
      "Zod insight must be typed as limitation"
    );
    assert.ok(
      body.persisted.governance_evidence_bundle_id,
      "completed typo todo must be retained as session-only evidence"
    );
  } finally {
    await cleanup(traceId);
  }
}

// Oracle 3.75: The trap session must extract a Skill from repeated build commands
// and must NOT turn raw search results into Knowledge (Anti-Proxy-Search).
async function oracleTrapSessionExtractsSkillNotSearchDump() {
  const traceId = `oracle-trap-session-${Date.now()}`;
  try {
    const golden = JSON.parse(
      await fs.readFile("./tests/fixtures/trap-golden.json", "utf8")
    );
    const payload = makeBasePayload({
      trace_id: traceId,
      extraction_preview: golden
    });

    const body = await runGovernance(payload);

    assert.ok(
      body.persisted.skill_proposal_items.length > 0 || body.persisted.rule_items.length > 0,
      "repeated npm run build must produce at least a skill proposal or rule (behavioral pattern)"
    );
    assert.equal(
      body.persisted.knowledge_items.length,
      0,
      "raw search results must not be promoted to knowledge without project-specific processing"
    );
    assert.ok(
      body.persisted.governance_evidence_bundle_id,
      "raw search results may be retained as session-only evidence"
    );
  } finally {
    await cleanup(traceId);
  }
}

// Oracle 4: A completed one-off todo must be discarded or left as evidence_only,
// not promoted to rule/memory/skill/knowledge.
async function oracleCompletedOneOffTodoIsDiscarded() {
  const traceId = `oracle-completed-todo-${Date.now()}`;
  try {
    const payload = makeBasePayload({
      trace_id: traceId,
      extraction_preview: {
        // TODO: replace with a real session about a one-off completed task.
        // The only retained artifact is session-only governance evidence;
        // nothing reusable should be promoted.
        memory_candidates: [],
        governance_evidence_candidates: [
          {
            candidate_type: "governance_evidence_candidate",
            title: "README typo fix evidence",
            origin_scope: "session",
            availability_scope: "session_only",
            governance_level: "session",
            promotion_status: "candidate",
            evidence_category: "execution_step",
            source_kind: "assistant_message",
            source_timestamp: "2026-06-22T10:00:00.000Z",
            source_excerpt: "Fixed a typo in README.md on 2026-06-22.",
            reason: "Session-only evidence.",
            confidence: "medium"
          }
        ]
      }
    });

    const body = await runGovernance(payload);

    assert.equal(body.persisted.rule_items.length, 0, "completed todo must not become a rule");
    assert.equal(body.persisted.memory_items.length, 0, "completed todo must not become memory");
    assert.equal(
      body.persisted.skill_proposal_items.length,
      0,
      "completed todo must not become a skill proposal"
    );
    assert.equal(
      body.persisted.knowledge_items.length,
      0,
      "completed todo must not become knowledge"
    );
    // It may be retained as session-only governance evidence.
    assert.ok(
      body.persisted.governance_evidence_bundle_id,
      "completed todo may be retained as evidence"
    );
  } finally {
    await cleanup(traceId);
  }
}

// Oracle 5: A trivial session with nothing reusable must return empty outputs.
async function oracleTrivialSessionReturnsEmpty() {
  const traceId = `oracle-trivial-${Date.now()}`;
  try {
    const payload = makeBasePayload({
      trace_id: traceId,
      extraction_preview: {
        // TODO: replace with a real "hello / thanks" session.
        governance_evidence_candidates: [
          {
            candidate_type: "governance_evidence_candidate",
            title: "Greeting",
            origin_scope: "session",
            availability_scope: "session_only",
            governance_level: "session",
            promotion_status: "candidate",
            evidence_category: "user_input",
            source_kind: "user_message",
            source_timestamp: "2026-06-22T10:00:00.000Z",
            source_excerpt: "Hi, can you help me?",
            reason: "Trivial greeting.",
            confidence: "low"
          }
        ]
      }
    });

    const body = await runGovernance(payload);

    assert.equal(body.persisted.rule_items.length, 0, "trivial session must not produce rules");
    assert.equal(body.persisted.memory_items.length, 0, "trivial session must not produce memory");
    assert.equal(
      body.persisted.skill_proposal_items.length,
      0,
      "trivial session must not produce skill proposals"
    );
    assert.equal(
      body.persisted.knowledge_items.length,
      0,
      "trivial session must not produce knowledge"
    );
  } finally {
    await cleanup(traceId);
  }
}

// Oracle 6 (positive Knowledge): External-knowledge-dense session must produce
// at least one valid knowledge candidate when the content is universal and
// well-sourced.
async function oracleExternalKnowledgeDenseSessionProducesKnowledge() {
  const traceId = `oracle-positive-knowledge-${Date.now()}`;
  try {
    const payload = makeBasePayload({
      trace_id: traceId,
      extraction_preview: {
        // TODO: replace with a real "read three RAG papers and compare" session.
        knowledge_candidates: [
          {
            candidate_type: "knowledge_candidate",
            title: "RAG 检索粒度权衡：句子级 vs 段落级",
            origin_scope: "project",
            availability_scope: "global_reusable",
            governance_level: "shared",
            promotion_status: "active",
            knowledge_type: "comparison",
            source_kind: "assistant_message",
            source_timestamp: "2026-06-22T10:00:00.000Z",
            content:
              "在 RAG 系统中，句子级检索对事实密集型查询的精确率更高，但检索次数更多、延迟更大；段落级检索对宽泛问题的召回率更高，但容易引入无关信息。",
            source_excerpt:
              "三篇 RAG 论文横向对比：句子级检索精确率高但延迟大，段落级检索召回率高但噪声大。",
            reason: "跨论文横向对比，提炼为通用技术洞察。",
            synthesis_reasoning: "论文 A 强调句子级在事实型问题上的高精确率，论文 B 证明段落级在开放域问题上的高召回率，论文 C 指出混合粒度可平衡二者。综合得出该权衡规律。",
            avoid_pitfall: "IF RAG 系统面向事实密集型查询 THEN 优先使用句子级检索；IF 面向开放域宽泛问题 THEN 优先使用段落级检索；MUST NOT 只用单一粒度处理所有查询类型",
            confidence: "high"
          }
        ],
        governance_evidence_candidates: [
          {
            candidate_type: "governance_evidence_candidate",
            title: "RAG paper A excerpt",
            origin_scope: "session",
            availability_scope: "session_only",
            governance_level: "session",
            promotion_status: "candidate",
            evidence_category: "external_reference",
            source_kind: "assistant_message",
            source_timestamp: "2026-06-22T10:00:00.000Z",
            source_excerpt: "Paper A: sentence-level retrieval precision = 0.89.",
            reason: "Reading credential.",
            confidence: "high"
          },
          {
            candidate_type: "governance_evidence_candidate",
            title: "RAG paper B excerpt",
            origin_scope: "session",
            availability_scope: "session_only",
            governance_level: "session",
            promotion_status: "candidate",
            evidence_category: "external_reference",
            source_kind: "assistant_message",
            source_timestamp: "2026-06-22T10:00:01.000Z",
            source_excerpt: "Paper B: paragraph-level retrieval recall = 0.92.",
            reason: "Reading credential.",
            confidence: "high"
          }
        ]
      }
    });

    const body = await runGovernance(payload);

    assert.ok(
      body.persisted.knowledge_items.length > 0,
      "external-knowledge-dense session must produce knowledge"
    );
    assert.equal(
      body.persisted.knowledge_items[0].knowledge_type,
      "comparison",
      "knowledge type must be preserved"
    );
  } finally {
    await cleanup(traceId);
  }
}

try {
  // Ensure the oracle suite is idempotent: stale rows from previous failed runs
  // can cause filterExisting* deduplication to silently drop expected outputs.
  const pool = getPool();
  await pool.query(`DELETE FROM rule WHERE tenant_id = $1 AND scope = $2`, [tenantId, scope]);
  await pool.query(`DELETE FROM memory WHERE tenant_id = $1 AND scope = $2`, [tenantId, scope]);
  await pool.query(`DELETE FROM governance_change_proposal WHERE tenant_id = $1 AND scope = $2`, [tenantId, scope]);
  await pool.query(`DELETE FROM kp_synthesized_knowledge WHERE tenant_id = $1 AND scope = $2`, [tenantId, scope]);
  await pool.query(`DELETE FROM host_governance_event WHERE tenant_id = $1 AND scope = $2`, [tenantId, scope]);

  await oracleRecurringErrorProducesPreflight();
  await oracleProjectInternalConversationYieldsNoKnowledge();
  await oracleConcretePointSplitsAcrossLayers();
  await oracleDashboardSessionSplitsAndDiscards();
  await oracleTrapSessionExtractsSkillNotSearchDump();
  await oracleCompletedOneOffTodoIsDiscarded();
  await oracleTrivialSessionReturnsEmpty();
  await oracleExternalKnowledgeDenseSessionProducesKnowledge();
  console.log("\n✅ Governance behavioral oracle skeleton passed.");
} finally {
  await app.close();
  await getPool().end();
}

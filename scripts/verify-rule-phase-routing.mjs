import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createOrReplaceRule, getPool, queryActiveRules } from "../libs/db/dist/index.js";
import { buildMemoryServiceApp } from "../services/memory-service/dist/services/memory-service/src/app.js";

const tenantId = "tenant-local";
const scope = "memory.validation";
const runRef = randomUUID().slice(0, 8);
const planningKey = `verify-phase-planning-${runRef}`;
const codingKey = `verify-phase-coding-${runRef}`;

const app = buildMemoryServiceApp();

try {
  const planningRuleId = await createOrReplaceRule({
    tenantId,
    scope,
    ruleKey: planningKey,
    ruleType: "design_rule",
    title: `Phase routing planning rule ${runRef}`,
    statement: `规划阶段必须先确认目标和边界。验证批次：${runRef}。`,
    normalizedStatement: `规划阶段必须先确认目标和边界。验证批次：${runRef}。`.toLowerCase(),
    appliesTo: ["planning", "design"],
    triggerConditions: {
      applies_to_phase: ["planning", "design"]
    },
    enforcementLevel: "must",
    priority: 99,
    riskLevel: "medium",
    verificationStatus: "verified",
    sourceRefs: [`verify://rule-phase-routing/${runRef}/planning`],
    evidenceRefs: [],
    originScope: "project",
    governanceLevel: "shared",
    availabilityScope: "project_reusable",
    promotionStatus: "active",
    ruleDomain: "design",
    ruleScope: "project",
    traceId: "verify-rule-phase-routing"
  });

  const codingRuleId = await createOrReplaceRule({
    tenantId,
    scope,
    ruleKey: codingKey,
    ruleType: "execution_rule",
    title: `Phase routing coding rule ${runRef}`,
    statement: `编码阶段必须先运行相关验证。验证批次：${runRef}。`,
    normalizedStatement: `编码阶段必须先运行相关验证。验证批次：${runRef}。`.toLowerCase(),
    appliesTo: ["coding", "testing"],
    triggerConditions: {
      applies_to_phase: ["coding", "testing"]
    },
    enforcementLevel: "must",
    priority: 99,
    riskLevel: "medium",
    verificationStatus: "verified",
    sourceRefs: [`verify://rule-phase-routing/${runRef}/coding`],
    evidenceRefs: [],
    originScope: "project",
    governanceLevel: "shared",
    availabilityScope: "project_reusable",
    promotionStatus: "active",
    ruleDomain: "execution",
    ruleScope: "project",
    traceId: "verify-rule-phase-routing"
  });

  const directCodingRules = await queryActiveRules({
    tenantId,
    scope,
    query: `phase routing ${runRef}`,
    taskPhase: "coding",
    limit: 20
  });
  assert.ok(directCodingRules.some((rule) => rule.rule_key === codingKey), "coding phase should retrieve coding rule");
  assert.equal(directCodingRules.some((rule) => rule.rule_key === planningKey), false, "coding phase should not retrieve planning-only rule");

  const directPlanningRules = await queryActiveRules({
    tenantId,
    scope,
    query: `phase routing ${runRef}`,
    taskPhase: "planning",
    limit: 20
  });
  assert.ok(directPlanningRules.some((rule) => rule.rule_key === planningKey), "planning phase should retrieve planning rule");
  assert.equal(directPlanningRules.some((rule) => rule.rule_key === codingKey), false, "planning phase should not retrieve coding-only rule");

  const retrieve = await app.inject({
    method: "POST",
    url: "/internal/memory/retrieve",
    payload: {
      task_request_id: "33333333-3333-4333-8333-333333333333",
      query: `phase routing ${runRef}`,
      fingerprint_status: "matched_or_na",
      include_factual: false,
      include_procedural: false,
      task_type: "execution",
      task_phase: "coding",
      required_layers: ["rules"],
      forbidden_layers: ["conversation_summary", "resident_snapshot", "factual_memory", "procedural_memory", "synthesized_knowledge", "evidence_index"],
      limit: 20
    }
  });
  assert.equal(retrieve.statusCode, 200, retrieve.body);
  const retrieveBody = retrieve.json();
  assert.equal(retrieveBody.assembly_context.task_phase, "coding");
  assert.ok(retrieveBody.rules.some((rule) => rule.rule_key === codingKey), "retrieve should return coding-phase rule");
  assert.equal(retrieveBody.rules.some((rule) => rule.rule_key === planningKey), false, "retrieve should not return planning-only rule for coding phase");

  process.stdout.write(
    `${JSON.stringify(
      {
        run_ref: runRef,
        planning_rule_id: planningRuleId,
        coding_rule_id: codingRuleId,
        checks: [
          "queryActiveRules filters by task_phase",
          "memory_retrieve preserves task_phase",
          "memory_retrieve returns phase-matched rules only"
        ]
      },
      null,
      2
    )}\n`
  );
} finally {
  await app.close();
  const pool = getPool();
  await pool.query("UPDATE rule SET status = 'retired' WHERE tenant_id = $1 AND scope = $2 AND rule_key = ANY($3::text[])", [
    tenantId,
    scope,
    [planningKey, codingKey]
  ]);
}

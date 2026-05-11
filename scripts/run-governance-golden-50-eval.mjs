import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { applyHostModelGovernanceResult } from "../services/memory-service/dist/services/memory-service/src/hostModelGovernanceAdapter.js";

const root = process.cwd();
const datasetPath = path.join(root, "tests", "governance-quality", "golden-50.v1.json");
const reportDir = path.join(root, "tests", "governance-quality", "reports");
const reportJsonPath = path.join(reportDir, "governance-golden-50-report.json");
const reportMdPath = path.join(reportDir, "governance-golden-50-report.md");

const dataset = JSON.parse(fs.readFileSync(datasetPath, "utf8"));
assert.equal(dataset.version, "governance-golden-50.v1");
assert.equal(dataset.cases.length, 50, "golden set must contain exactly 50 cases");

const results = [];
for (const testCase of dataset.cases) {
  const prediction = buildReferencePrediction(testCase);
  const validation = validateCase(testCase, prediction);
  results.push({
    id: testCase.id,
    category: testCase.category,
    expected_layer: testCase.expected.layer,
    predicted_layer: validation.predictedLayer,
    passed: validation.errors.length === 0,
    errors: validation.errors,
    output: prediction
  });
}

const passed = results.filter((item) => item.passed).length;
const failed = results.length - passed;
const byCategory = summarizeByCategory(results);
const metrics = computeMetrics(results);

const report = {
  dataset: datasetPath,
  mode: "gold_reference_contract_eval",
  note:
    "This validates the 50-case golden target outputs and governance contract. It does not call an external LLM; host-model live quality should be evaluated by supplying model predictions against the same dataset.",
  total: results.length,
  passed,
  failed,
  score: passed / results.length,
  metrics,
  by_category: byCategory,
  failed_cases: results.filter((item) => !item.passed),
  cases: results
};

fs.mkdirSync(reportDir, { recursive: true });
fs.writeFileSync(reportJsonPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
fs.writeFileSync(reportMdPath, renderMarkdown(report), "utf8");

assert.equal(failed, 0, "all 50 golden governance quality cases should pass");
process.stdout.write(`${JSON.stringify({ report: reportJsonPath, markdown: reportMdPath, total: results.length, passed, failed, metrics }, null, 2)}\n`);

function buildReferencePrediction(testCase) {
  const expected = testCase.expected;
  if (expected.layer === "discard") {
    return emptyExtraction();
  }
  const common = {
    title: expected.title,
    origin_scope: inferOriginScope(expected.layer),
    availability_scope: inferAvailabilityScope(expected),
    governance_level: expected.governance_level ?? inferGovernanceLevel(expected.layer),
    promotion_status: inferPromotionStatus(expected.layer),
    source_kind: "user_message",
    source_timestamp: "2026-05-11T00:00:00.000Z",
    source_excerpt: testCase.input,
    reason: buildReason(testCase),
    confidence: "high"
  };
  const extraction = emptyExtraction();

  if (expected.layer === "rule") {
    extraction.rule_candidates.push({
      ...common,
      candidate_type: "rule_candidate",
      content: expected.content,
      rule_domain: expected.rule_domain,
      rule_scope: common.origin_scope,
      applies_to_phase: expected.applies_to_phase,
      violation_behavior: expected.violation_behavior
    });
  }

  if (expected.layer === "memory") {
    extraction.memory_candidates.push({
      ...common,
      candidate_type: "memory_candidate",
      content: expected.content,
      memory_type: expected.memory_type,
      stability: expected.stability
    });
  }

  if (expected.layer === "knowledge") {
    extraction.knowledge_candidates.push({
      ...common,
      candidate_type: "knowledge_candidate",
      content: expected.content,
      knowledge_type: expected.knowledge_type,
      governance_action: expected.governance_action,
      related_existing_knowledge_ids: [],
      relation_proposals: [],
      synthesis_reasoning: `Governance action ${expected.governance_action} is expected for ${testCase.id}.`,
      recall_state: expected.governance_action === "evidence_only" ? "audit_only" : "active"
    });
  }

  if (expected.layer === "skill_proposal") {
    extraction.skill_proposal_candidates.push({
      ...common,
      candidate_type: "skill_proposal_candidate",
      target_skill: expected.target_skill,
      target_skill_path: null,
      change_type: "update",
      current_section: null,
      current_text: null,
      current_gap: expected.current_gap,
      proposed_text: expected.proposed_text,
      proposed_patch: `Update ${expected.target_skill}: ${expected.proposed_text}`,
      validation_method: expected.validation_method,
      proposal_quality: "actionable"
    });
  }

  if (expected.layer === "governance_evidence") {
    extraction.governance_evidence_candidates.push({
      ...common,
      candidate_type: "governance_evidence_candidate",
      content: expected.content,
      evidence_category: expected.evidence_category,
      availability_scope: "session_only",
      governance_level: "session",
      promotion_status: "candidate"
    });
  }

  return extraction;
}

function validateCase(testCase, extraction) {
  const errors = [];
  const expected = testCase.expected;
  try {
    applyHostModelGovernanceResult({
      batch: buildBaseBatch(testCase),
      governanceMode: "host_model",
      hostModelResult: {
        model_ref: "golden-reference",
        generated_at: "2026-05-11T00:00:00.000Z",
        extraction_preview: extraction
      }
    });
  } catch (error) {
    errors.push(`contract validation failed: ${error.message}`);
  }

  const layerCounts = {
    rule: extraction.rule_candidates.length,
    memory: extraction.memory_candidates.length,
    knowledge: extraction.knowledge_candidates.length,
    skill_proposal: extraction.skill_proposal_candidates.length,
    governance_evidence: extraction.governance_evidence_candidates.length
  };
  const predictedLayer = Object.entries(layerCounts).find(([, count]) => count > 0)?.[0] ?? "discard";

  if (predictedLayer !== expected.layer) {
    errors.push(`expected layer ${expected.layer}, got ${predictedLayer}`);
  }

  for (const rejectedLayer of expected.reject ?? []) {
    if (layerCounts[rejectedLayer] > 0) {
      errors.push(`forbidden layer ${rejectedLayer} has output`);
    }
  }

  const candidate = getCandidateByLayer(extraction, expected.layer);
  if (expected.layer !== "discard" && !candidate) {
    errors.push("expected a candidate but no candidate was produced");
  }

  if (candidate) {
    const candidateText = flattenCandidateText(candidate);
    for (const requiredText of [expected.title, expected.content].filter(Boolean)) {
      if (!candidateText.includes(requiredText)) {
        errors.push(`candidate does not include required text: ${requiredText}`);
      }
    }
    if (expected.layer === "rule" && !/必须|不得|不能|不允许|不要|只能|must|must_not|must not/i.test(candidate.content ?? "")) {
      errors.push("rule output is not enforceable");
    }
    if (expected.layer === "skill_proposal") {
      for (const field of ["target_skill", "current_gap", "proposed_text", "validation_method", "proposed_patch"]) {
        if (!candidate[field]) {
          errors.push(`skill proposal missing ${field}`);
        }
      }
    }
    if (expected.layer === "knowledge" && candidate.recall_state === "active" && expected.governance_action === "evidence_only") {
      errors.push("evidence_only knowledge must not be active");
    }
  }

  if (testCase.category === "dependency_preflight" || testCase.id === "rule-dependency-003" || testCase.id === "skill-dependency-preflight-017") {
    const serialized = JSON.stringify(extraction).toLowerCase();
    if (!serialized.includes("preflight") && !serialized.includes("health")) {
      errors.push("dependency case did not generalize to health/preflight");
    }
  }

  return { errors, predictedLayer };
}

function emptyExtraction() {
  return {
    rule_candidates: [],
    memory_candidates: [],
    skill_proposal_candidates: [],
    knowledge_candidates: [],
    governance_evidence_candidates: []
  };
}

function buildBaseBatch(testCase) {
  return {
    host: "codex",
    thread_id: `golden-${testCase.id}`,
    thread_name: "governance golden 50",
    session_file: datasetPath,
    ingestion_readiness: { status: "ready", warnings: [] },
    raw_inputs: {
      user_messages: [{ timestamp: "2026-05-11T00:00:00.000Z", text: testCase.input }],
      commentary_messages: [],
      commands: [],
      tool_calls: [],
      mcp_calls: []
    },
    extraction_preview: emptyExtraction()
  };
}

function inferOriginScope(layer) {
  if (layer === "knowledge") {
    return "global";
  }
  if (layer === "governance_evidence") {
    return "session";
  }
  return "project";
}

function inferAvailabilityScope(expected) {
  if (expected.governance_level === "session" || expected.layer === "governance_evidence") {
    return "session_only";
  }
  if (expected.layer === "knowledge") {
    return "global_reusable";
  }
  if (expected.memory_type === "user_memory") {
    return "user_reusable";
  }
  if (expected.memory_type === "workspace_memory") {
    return "workspace_reusable";
  }
  if (expected.memory_type === "team_memory") {
    return "team_reusable";
  }
  return "project_reusable";
}

function inferGovernanceLevel(layer) {
  return layer === "governance_evidence" ? "session" : "shared";
}

function inferPromotionStatus(layer) {
  if (layer === "skill_proposal") {
    return "needs_review";
  }
  if (layer === "governance_evidence") {
    return "candidate";
  }
  return "candidate";
}

function buildReason(testCase) {
  return `Golden case ${testCase.id} expects ${testCase.expected.layer} because ${testCase.category} governance requires this layer.`;
}

function getCandidateByLayer(extraction, layer) {
  if (layer === "rule") return extraction.rule_candidates[0] ?? null;
  if (layer === "memory") return extraction.memory_candidates[0] ?? null;
  if (layer === "knowledge") return extraction.knowledge_candidates[0] ?? null;
  if (layer === "skill_proposal") return extraction.skill_proposal_candidates[0] ?? null;
  if (layer === "governance_evidence") return extraction.governance_evidence_candidates[0] ?? null;
  return null;
}

function flattenCandidateText(candidate) {
  const values = [];
  for (const value of Object.values(candidate)) {
    if (typeof value === "string") {
      values.push(value);
    }
    if (Array.isArray(value)) {
      for (const entry of value) {
        if (typeof entry === "string") {
          values.push(entry);
        }
      }
    }
  }
  return values.join("\n");
}

function summarizeByCategory(results) {
  const summary = {};
  for (const result of results) {
    const item = summary[result.category] ?? { total: 0, passed: 0, failed: 0 };
    item.total += 1;
    item.passed += result.passed ? 1 : 0;
    item.failed += result.passed ? 0 : 1;
    summary[result.category] = item;
  }
  return summary;
}

function computeMetrics(results) {
  const layerAccuracy = results.filter((item) => item.expected_layer === item.predicted_layer).length / results.length;
  const crossLayerViolations = results.filter((item) => item.errors.some((error) => error.includes("forbidden layer"))).length;
  const contractFailures = results.filter((item) => item.errors.some((error) => error.includes("contract validation"))).length;
  const abstractionFailures = results.filter((item) => item.errors.some((error) => error.includes("health/preflight"))).length;
  const falsePromotionRate = results.filter((item) => item.expected_layer === "discard" && item.predicted_layer !== "discard").length / results.length;
  return {
    layer_accuracy: layerAccuracy,
    false_promotion_rate: falsePromotionRate,
    cross_layer_violation_count: crossLayerViolations,
    contract_failure_count: contractFailures,
    abstraction_failure_count: abstractionFailures
  };
}

function renderMarkdown(report) {
  const lines = [];
  lines.push("# Governance Golden 50 Evaluation Report");
  lines.push("");
  lines.push(`- Dataset: \`${report.dataset}\``);
  lines.push(`- Mode: \`${report.mode}\``);
  lines.push(`- Total: ${report.total}`);
  lines.push(`- Passed: ${report.passed}`);
  lines.push(`- Failed: ${report.failed}`);
  lines.push(`- Score: ${(report.score * 100).toFixed(2)}%`);
  lines.push("");
  lines.push("## Metrics");
  lines.push("");
  for (const [key, value] of Object.entries(report.metrics)) {
    lines.push(`- ${key}: ${typeof value === "number" ? Number(value).toFixed(4) : value}`);
  }
  lines.push("");
  lines.push("## Category Summary");
  lines.push("");
  lines.push("| Category | Total | Passed | Failed |");
  lines.push("| --- | ---: | ---: | ---: |");
  for (const [category, item] of Object.entries(report.by_category)) {
    lines.push(`| ${category} | ${item.total} | ${item.passed} | ${item.failed} |`);
  }
  lines.push("");
  lines.push("## Case Results");
  lines.push("");
  for (const item of report.cases) {
    lines.push(`### ${item.id}`);
    lines.push("");
    lines.push(`- Category: ${item.category}`);
    lines.push(`- Expected layer: ${item.expected_layer}`);
    lines.push(`- Predicted layer: ${item.predicted_layer}`);
    lines.push(`- Passed: ${item.passed ? "yes" : "no"}`);
    if (item.errors.length > 0) {
      lines.push(`- Errors: ${item.errors.join("; ")}`);
    }
    lines.push("");
  }
  return `${lines.join("\n")}\n`;
}

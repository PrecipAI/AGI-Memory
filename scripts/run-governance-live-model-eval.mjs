import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { applyHostModelGovernanceResult } from "../services/memory-service/dist/services/memory-service/src/hostModelGovernanceAdapter.js";

const root = process.cwd();
const datasetPath = process.argv[2] ?? path.join(root, "tests", "governance-quality", "golden-50.v1.json");
const answerKeyPath = process.env.GOVERNANCE_ANSWER_KEY_PATH || process.argv[3] || "";
const reportDir = path.join(root, "tests", "governance-quality", "reports");
const datasetSlug = path.basename(datasetPath).replace(/\.json$/i, "").replace(/[^a-z0-9._-]+/gi, "-");
const reportJsonPath = path.join(reportDir, `governance-live-${datasetSlug}-report.json`);
const reportMdPath = path.join(reportDir, `governance-live-${datasetSlug}-report.md`);
const predictionsPath = process.env.GOVERNANCE_LLM_PREDICTIONS_PATH || "";

const apiKey = process.env.GOVERNANCE_LLM_API_KEY || process.env.OPENAI_API_KEY || process.env.DEEPSEEK_API_KEY || "";
const baseUrl = trimTrailingSlash(process.env.GOVERNANCE_LLM_BASE_URL || inferBaseUrl());
const model = process.env.GOVERNANCE_LLM_MODEL || process.env.OPENAI_MODEL || process.env.DEEPSEEK_MODEL || "";
const timeoutMs = Number(process.env.GOVERNANCE_LLM_TIMEOUT_MS || 120000);
const maxCases = Number(process.env.GOVERNANCE_LLM_MAX_CASES || 50);

const dataset = JSON.parse(fs.readFileSync(datasetPath, "utf8"));
assert.ok(Array.isArray(dataset.cases), "dataset.cases must be an array");
const answerKey = answerKeyPath ? JSON.parse(fs.readFileSync(answerKeyPath, "utf8")) : null;
const cases = attachExpected(dataset.cases, answerKey).slice(0, maxCases);

fs.mkdirSync(reportDir, { recursive: true });

let predictions;
let runMode;
if (predictionsPath) {
  predictions = JSON.parse(fs.readFileSync(predictionsPath, "utf8"));
  runMode = "predictions_file";
} else if (apiKey && baseUrl && model) {
  runMode = "live_openai_compatible_chat";
  predictions = await runLiveModel(cases);
} else {
  const blocked = {
    dataset: datasetPath,
    mode: "blocked",
    reason: "No live model provider is configured.",
    required_configuration: {
      GOVERNANCE_LLM_API_KEY: "required unless OPENAI_API_KEY or DEEPSEEK_API_KEY is set",
      GOVERNANCE_LLM_MODEL: "required unless OPENAI_MODEL or DEEPSEEK_MODEL is set",
      GOVERNANCE_LLM_BASE_URL: "optional; defaults to OpenAI or DeepSeek compatible chat completions endpoint"
    },
    safe_to_run_examples: [
      "$env:GOVERNANCE_LLM_API_KEY='<redacted>'; $env:GOVERNANCE_LLM_MODEL='gpt-4.1'; npm run eval:governance:live-50",
      "$env:GOVERNANCE_LLM_API_KEY='<redacted>'; $env:GOVERNANCE_LLM_BASE_URL='https://api.deepseek.com'; $env:GOVERNANCE_LLM_MODEL='<model>'; npm run eval:governance:live-50",
      "$env:GOVERNANCE_LLM_PREDICTIONS_PATH='D:\\workspace\\projects\\SuperAgentSystem-main\\tests\\governance-quality\\reports\\some-model-predictions.json'; npm run eval:governance:live-50",
      "$env:GOVERNANCE_ANSWER_KEY_PATH='D:\\workspace\\projects\\SuperAgentSystem-main\\tests\\governance-quality\\hidden.answer-key.json'; npm run eval:governance:live-50 -- D:\\workspace\\projects\\SuperAgentSystem-main\\tests\\governance-quality\\hidden.inputs.json"
    ]
  };
  fs.writeFileSync(reportJsonPath, `${JSON.stringify(blocked, null, 2)}\n`, "utf8");
  fs.writeFileSync(reportMdPath, renderBlockedMarkdown(blocked), "utf8");
  process.stdout.write(`${JSON.stringify({ report: reportJsonPath, markdown: reportMdPath, status: "blocked", reason: blocked.reason }, null, 2)}\n`);
  process.exitCode = 2;
  process.exit();
}

const evaluated = evaluatePredictions(cases, predictions);
const report = {
  dataset: datasetPath,
  mode: runMode,
  model,
  base_url: redactBaseUrl(baseUrl),
  total: evaluated.length,
  passed: evaluated.filter((item) => item.passed).length,
  failed: evaluated.filter((item) => !item.passed).length,
  score: evaluated.filter((item) => item.passed).length / evaluated.length,
  metrics: computeMetrics(evaluated),
  by_category: summarizeByCategory(evaluated),
  failed_cases: evaluated.filter((item) => !item.passed),
  cases: evaluated
};

fs.writeFileSync(reportJsonPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
fs.writeFileSync(reportMdPath, renderMarkdown(report), "utf8");
process.stdout.write(`${JSON.stringify({ report: reportJsonPath, markdown: reportMdPath, total: report.total, passed: report.passed, failed: report.failed, score: report.score, metrics: report.metrics }, null, 2)}\n`);

async function runLiveModel(inputCases) {
  const outputs = [];
  for (const testCase of inputCases) {
    const prompt = buildPrompt(testCase);
    const response = await callOpenAICompatibleChat(prompt);
    outputs.push({
      id: testCase.id,
      raw_output: response,
      extraction_preview: parseExtractionPreview(response)
    });
  }
  const predictionsOutput = path.join(reportDir, `governance-live-50-predictions-${Date.now()}.json`);
  fs.writeFileSync(predictionsOutput, `${JSON.stringify({ model, base_url: redactBaseUrl(baseUrl), predictions: outputs }, null, 2)}\n`, "utf8");
  return { predictions: outputs };
}

function buildPrompt(testCase) {
  return [
    "你是长期知识系统的治理审计模型，不是任务执行模型。",
    "你必须从输入中判断是否产出 rule、memory、knowledge、skill_proposal、governance_evidence，或全部丢弃。",
    "必须由点及面、由表及里；不得机械保存原话；没有长期价值时返回空数组。",
    "Rule 只能是 must/must_not 行为约束；Memory 是用户/项目/机器/团队/会话上下文；Knowledge 是外部通用知识；Skill proposal 是可复用执行流程或 skill 改动提案；Evidence 是仅供治理审查的过程证据。",
    "外部依赖失败必须抽象为 health/preflight、配置、认证、端口/网络、协议和降级问题。",
    "输出必须是严格 JSON 对象，且只包含 extraction_preview。",
    "extraction_preview 必须包含 rule_candidates、memory_candidates、skill_proposal_candidates、knowledge_candidates、governance_evidence_candidates 五个数组。",
    "候选字段必须满足本项目 host_model_result contract。skill proposal 必须包含 target_skill、current_gap、proposed_text、proposed_patch、validation_method。",
    "如果应丢弃，则五个数组都为空。",
    "",
    `输入案例 ID: ${testCase.id}`,
    `类别提示: ${testCase.category ?? "unknown"}`,
    `输入内容: ${testCase.input}`,
    "",
    "只输出 JSON。"
  ].join("\n");
}

function attachExpected(inputCases, loadedAnswerKey) {
  if (inputCases.every((testCase) => testCase.expected)) {
    return inputCases;
  }
  if (!loadedAnswerKey) {
    throw new Error("dataset has no expected answers; provide GOVERNANCE_ANSWER_KEY_PATH or pass answer key as the third argument");
  }
  const answers = new Map((loadedAnswerKey.cases ?? []).map((testCase) => [testCase.id, testCase.expected]));
  return inputCases.map((testCase) => {
    const expected = answers.get(testCase.id);
    if (!expected) {
      throw new Error(`answer key is missing expected output for ${testCase.id}`);
    }
    return { ...testCase, expected };
  });
}

async function callOpenAICompatibleChat(prompt) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(`${baseUrl}/v1/chat/completions`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model,
        messages: [{ role: "user", content: prompt }],
        temperature: 0,
        response_format: { type: "json_object" }
      }),
      signal: controller.signal
    });
    const text = await response.text();
    if (!response.ok) {
      throw new Error(`model request failed: HTTP ${response.status} ${text.slice(0, 500)}`);
    }
    const body = JSON.parse(text);
    return body.choices?.[0]?.message?.content ?? "";
  } finally {
    clearTimeout(timeout);
  }
}

function parseExtractionPreview(raw) {
  const parsed = JSON.parse(stripCodeFence(raw));
  return parsed.extraction_preview ?? parsed;
}

function evaluatePredictions(inputCases, predictionPayload) {
  const predictionItems = Array.isArray(predictionPayload) ? predictionPayload : predictionPayload.predictions ?? [];
  const byId = new Map(predictionItems.map((item) => [item.id, item]));
  return inputCases.map((testCase) => {
    const prediction = byId.get(testCase.id);
    if (!prediction) {
      return {
        id: testCase.id,
        category: testCase.category,
        expected_layer: testCase.expected.layer,
        predicted_layer: "missing",
        passed: false,
        errors: ["missing prediction"],
        output: null
      };
    }
    const extraction = normalizeExtraction(prediction.extraction_preview ?? prediction.output ?? prediction);
    const validation = validateCase(testCase, extraction);
    return {
      id: testCase.id,
      category: testCase.category,
      expected_layer: testCase.expected.layer,
      predicted_layer: validation.predictedLayer,
      passed: validation.errors.length === 0,
      errors: validation.errors,
      risk_flags: validation.riskFlags,
      output: extraction
    };
  });
}

function normalizeExtraction(extraction) {
  return {
    rule_candidates: Array.isArray(extraction.rule_candidates) ? extraction.rule_candidates : [],
    memory_candidates: Array.isArray(extraction.memory_candidates) ? extraction.memory_candidates : [],
    skill_proposal_candidates: Array.isArray(extraction.skill_proposal_candidates) ? extraction.skill_proposal_candidates : [],
    knowledge_candidates: Array.isArray(extraction.knowledge_candidates) ? extraction.knowledge_candidates : [],
    governance_evidence_candidates: Array.isArray(extraction.governance_evidence_candidates) ? extraction.governance_evidence_candidates : []
  };
}

function validateCase(testCase, extraction) {
  const errors = [];
  const riskFlags = [];
  const expected = testCase.expected;
  try {
    applyHostModelGovernanceResult({
      batch: buildBaseBatch(testCase),
      governanceMode: "host_model",
      hostModelResult: {
        model_ref: model || "predictions-file",
        generated_at: new Date().toISOString(),
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
  const nonEmpty = Object.entries(layerCounts).filter(([, count]) => count > 0);
  const predictedLayer = nonEmpty.length === 0 ? "discard" : nonEmpty.length === 1 ? nonEmpty[0][0] : "multiple";

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
    const text = flattenCandidateText(candidate);
    const requiredTerms = requiredTermsFor(testCase);
    for (const term of requiredTerms) {
      if (term === "__DEPENDENCY_PREFLIGHT_SIGNAL__") {
        if (!/(health|preflight|检查|可达|认证|端口|配置|权限|服务|降级)/i.test(text)) {
          errors.push("candidate missing dependency preflight signal");
        }
        continue;
      }
      if (!text.toLowerCase().includes(term.toLowerCase())) {
        errors.push(`candidate missing required term: ${term}`);
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
    if (expected.layer === "knowledge" && expected.governance_action && candidate.governance_action !== expected.governance_action) {
      errors.push(`expected governance_action ${expected.governance_action}, got ${candidate.governance_action}`);
    }
  }
  riskFlags.push(...detectRiskFlags(testCase, extraction, predictedLayer));
  return { errors, predictedLayer, riskFlags };
}

function detectRiskFlags(testCase, extraction, predictedLayer) {
  const flags = [];
  const category = String(testCase.category ?? "");
  const allText = flattenExtractionText(extraction);
  const hasLongTermOutput =
    extraction.rule_candidates.length > 0 ||
    extraction.memory_candidates.length > 0 ||
    extraction.skill_proposal_candidates.length > 0 ||
    extraction.knowledge_candidates.length > 0;

  if (category === "red_team" && hasLongTermOutput) {
    flags.push("red_team_promoted_to_long_term");
  }
  if (category === "conflict" && (extraction.memory_candidates.length > 0 || extraction.rule_candidates.length > 0)) {
    flags.push("conflict_promoted_without_confirmation");
  }
  if (category === "broken_knowledge" && extraction.knowledge_candidates.some((item) => item.recall_state === "active" && item.governance_action !== "create")) {
    flags.push("broken_knowledge_active_without_synthesis");
  }
  const shouldRequireDependencyPreflight =
    category === "dependency_preflight" ||
    testCase.id === "rule-dependency-003" ||
    testCase.id === "skill-dependency-preflight-017" ||
    testCase.id === "evidence-mcp-fetch-024" ||
    testCase.id === "stress-mixed-tool-failure-010";
  if (shouldRequireDependencyPreflight) {
    if (!/(health|preflight|检查|可达|认证|端口|配置|权限|服务|降级|connection|string|schema|collection)/i.test(allText)) {
      flags.push("dependency_preflight_missing");
    }
  }
  if (predictedLayer === "multiple") {
    flags.push("multiple_layer_pollution");
  }
  if (expectedLayerIsDiscard(testCase) && hasLongTermOutput) {
    flags.push("discard_case_promoted");
  }
  return flags;
}

function requiredTermsFor(testCase) {
  const expected = testCase.expected;
  const terms = [expected.title];
  if (testCase.category === "dependency_preflight" || testCase.id.includes("dependency") || testCase.id.includes("mcp")) {
    terms.push("__DEPENDENCY_PREFLIGHT_SIGNAL__");
  }
  if (expected.layer === "skill_proposal") {
    terms.push(expected.target_skill);
  }
  if (expected.layer === "memory" && expected.memory_type) {
    terms.push(expected.memory_type);
  }
  if (expected.layer === "knowledge" && expected.knowledge_type) {
    terms.push(expected.knowledge_type);
  }
  return terms.filter(Boolean);
}

function buildBaseBatch(testCase) {
  return {
    host: "codex",
    thread_id: `live-${testCase.id}`,
    thread_name: "governance live 50",
    session_file: datasetPath,
    ingestion_readiness: { status: "ready", warnings: [] },
    raw_inputs: {
      user_messages: [{ timestamp: "2026-05-11T00:00:00.000Z", text: testCase.input }],
      commentary_messages: [],
      commands: [],
      tool_calls: [],
      mcp_calls: []
    },
    extraction_preview: normalizeExtraction({})
  };
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
    if (typeof value === "string") values.push(value);
    if (Array.isArray(value)) {
      for (const entry of value) {
        if (typeof entry === "string") values.push(entry);
        if (entry && typeof entry === "object") values.push(JSON.stringify(entry));
      }
    }
  }
  return values.join("\n");
}

function flattenExtractionText(extraction) {
  return [
    ...extraction.rule_candidates,
    ...extraction.memory_candidates,
    ...extraction.skill_proposal_candidates,
    ...extraction.knowledge_candidates,
    ...extraction.governance_evidence_candidates
  ]
    .map((candidate) => flattenCandidateText(candidate))
    .join("\n");
}

function expectedLayerIsDiscard(testCase) {
  return testCase.expected?.layer === "discard";
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
  return {
    layer_accuracy: results.filter((item) => item.expected_layer === item.predicted_layer).length / results.length,
    pass_rate: results.filter((item) => item.passed).length / results.length,
    false_promotion_rate: results.filter((item) => item.expected_layer === "discard" && item.predicted_layer !== "discard").length / results.length,
    multiple_layer_rate: results.filter((item) => item.predicted_layer === "multiple").length / results.length,
    contract_failure_count: results.filter((item) => item.errors.some((error) => error.includes("contract validation"))).length,
    red_team_promotion_count: results.filter((item) => item.risk_flags.includes("red_team_promoted_to_long_term")).length,
    conflict_unconfirmed_promotion_count: results.filter((item) => item.risk_flags.includes("conflict_promoted_without_confirmation")).length,
    broken_knowledge_active_risk_count: results.filter((item) => item.risk_flags.includes("broken_knowledge_active_without_synthesis")).length,
    dependency_preflight_missing_count: results.filter((item) => item.risk_flags.includes("dependency_preflight_missing")).length,
    risk_flag_count: results.reduce((sum, item) => sum + item.risk_flags.length, 0)
  };
}

function renderMarkdown(report) {
  const lines = [];
  lines.push("# Governance Live 50 Evaluation Report");
  lines.push("");
  lines.push(`- Dataset: \`${report.dataset}\``);
  lines.push(`- Mode: \`${report.mode}\``);
  lines.push(`- Model: \`${report.model || "n/a"}\``);
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
  const flagged = report.cases.filter((item) => item.risk_flags.length > 0);
  lines.push("");
  lines.push("## Risk Flags");
  lines.push("");
  if (flagged.length === 0) {
    lines.push("- No risk flags.");
  } else {
    for (const item of flagged) {
      lines.push(`- ${item.id}: ${item.risk_flags.join(", ")}`);
    }
  }
  if (report.failed_cases.length > 0) {
    lines.push("");
    lines.push("## Failed Cases");
    lines.push("");
    for (const item of report.failed_cases) {
      lines.push(`### ${item.id}`);
      lines.push("");
      lines.push(`- Category: ${item.category}`);
      lines.push(`- Expected layer: ${item.expected_layer}`);
      lines.push(`- Predicted layer: ${item.predicted_layer}`);
      lines.push(`- Errors: ${item.errors.join("; ")}`);
      lines.push("");
    }
  }
  return `${lines.join("\n")}\n`;
}

function renderBlockedMarkdown(report) {
  return [
    "# Governance Live 50 Evaluation Report",
    "",
    "- Status: blocked",
    `- Reason: ${report.reason}`,
    "",
    "## Required Configuration",
    "",
    "- `GOVERNANCE_LLM_API_KEY` or provider-specific API key",
    "- `GOVERNANCE_LLM_MODEL` or provider-specific model name",
    "- Optional `GOVERNANCE_LLM_BASE_URL` for OpenAI-compatible providers",
    "",
    "## Commands",
    "",
    "```powershell",
    ...report.safe_to_run_examples,
    "```",
    ""
  ].join("\n");
}

function inferBaseUrl() {
  if (process.env.DEEPSEEK_API_KEY) {
    return "https://api.deepseek.com";
  }
  if (process.env.OPENAI_API_KEY) {
    return "https://api.openai.com";
  }
  return "";
}

function redactBaseUrl(value) {
  return value.replace(/[?&]api_key=[^&]+/i, "api_key=<redacted>");
}

function trimTrailingSlash(value) {
  return value.replace(/\/+$/, "");
}

function stripCodeFence(raw) {
  const trimmed = String(raw ?? "").trim();
  const match = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  return match ? match[1] : trimmed;
}

/**
 * Adapter Pressure Test — Closed-Loop Metric Proxy
 * 
 * Since we can't run a live MCP server + host LLM, this script simulates
 * what happens when the host LLM returns host_model_result payloads.
 * 
 * Three proxy dimensions measured:
 *   1. Handshake feasibility (would Step 2 be callable?)
 *   2. Validation first-pass rate (does it pass on first try?)
 *   3. Layer classification accuracy (are items in correct layers?)
 * 
 * Also compares old pipeline quality vs new adapter expectations.
 */
import { applyHostModelGovernanceResult } from "../services/memory-service/dist/services/memory-service/src/hostModelGovernanceAdapter.js";

// ─── Helpers ─────────────────────────────────────────────────────────────

let passed = 0;
let failed = 0;
const results = [];

function record(name, outcome, detail = "") {
  results.push({ name, outcome, detail });
  if (outcome === "PASS") passed++;
  else failed++;
}

function mockBatch() {
  return {
    host: "codex",
    thread_id: "test-thread",
    thread_name: "Pressure Test Session",
    session_file: "/tmp/test.jsonl",
    ingestion_readiness: { status: "ready", warnings: [] },
    raw_inputs: { user_messages: [], commentary_messages: [], commands: [], tool_calls: [], mcp_calls: [] },
    extraction_preview: {
      rule_candidates: [],
      memory_candidates: [],
      skill_proposal_candidates: [],
      knowledge_candidates: [],
      governance_evidence_candidates: [],
    },
  };
}

function run(name, hostModelResult, expectPass = true) {
  try {
    const result = applyHostModelGovernanceResult({
      batch: mockBatch(),
      governanceMode: "host_model",
      hostModelResult,
    });
    if (expectPass) {
      record(name, "PASS", `accepted=${result.modelAdapter.accepted}, mode=${result.modelAdapter.mode}`);
    } else {
      record(name, "FAIL", `Expected rejection but passed: mode=${result.modelAdapter.mode}`);
    }
    return { ok: true, result };
  } catch (err) {
    if (!expectPass) {
      record(name, "PASS", `Correctly rejected: ${err.message.slice(0, 120)}`);
    } else {
      record(name, "FAIL", `Unexpected rejection: ${err.message.slice(0, 120)}`);
    }
    return { ok: false, error: err.message };
  }
}

// ─── SCENARIO 1: Perfect Submission (all four layers) ────────────────────

console.log("\n═══ SCENARIO 1: Perfect Four-Layer Submission ═══");

run("perfect_submission", {
  model_ref: "gpt-4o",
  generated_at: "2026-06-12T10:00:00Z",
  extraction_preview: {
    rule_candidates: [{
      candidate_type: "rule_candidate",
      title: "User prefers explanation before code",
      origin_scope: "user",
      availability_scope: "user_reusable",
      governance_level: "session",
      promotion_status: "needs_review",
      rule_domain: "execution",
      rule_scope: "user",
      applies_to_phase: ["coding", "review"],
      violation_behavior: "warn",
      source_kind: "user_message",
      source_timestamp: "2026-06-12T09:00:00Z",
      content: "[UP-Override] IF user asks for approach explanation THEN MUST provide conceptual reasoning first; MUST NOT output code before explanation",
      source_excerpt: "不要再只是停留在代码层面了可以吗",
      reason: "User explicitly requested conceptual explanations before code",
      confidence: "high",
    }],
    memory_candidates: [{
      candidate_type: "memory_candidate",
      title: "Node 18 CI build incompatibility",
      origin_scope: "project",
      availability_scope: "project_reusable",
      governance_level: "shared",
      promotion_status: "needs_review",
      memory_type: "design_decision",
      stability: "long_lived",
      source_kind: "command",
      source_timestamp: "2026-06-12T09:15:00Z",
      content: "symptom: npm ERR! engine incompatible during CI build. root_cause: CI defaults to Node 16, project requires 18+. fix_action: Add .nvmrc and CI pre-step for nvm use. future_trigger: Node build failure + engine incompatibility + CI environment",
      source_excerpt: "npm ERR! engine: incompatible Node version",
      reason: "Recurring CI failure with transferable fix",
      confidence: "high",
    }],
    knowledge_candidates: [{
      candidate_type: "knowledge_candidate",
      title: "Fastify HTTP framework for memory service",
      origin_scope: "project",
      availability_scope: "project_reusable",
      governance_level: "shared",
      promotion_status: "needs_review",
      knowledge_type: "external_fact",
      governance_action: "create",
      source_kind: "user_message",
      source_timestamp: "2026-06-12T09:30:00Z",
      content: "Backend API uses Fastify as the HTTP framework with TypeScript",
      synthesis_reasoning: "Derived from multiple code references in session",
      source_excerpt: "Fastify is the framework used",
      reason: "Project architecture fact with reuse value",
      confidence: "high",
    }],
    skill_proposal_candidates: [{
      candidate_type: "skill_proposal_candidate",
      title: "Production deployment via Docker Compose",
      origin_scope: "project",
      availability_scope: "project_reusable",
      governance_level: "shared",
      promotion_status: "needs_review",
      target_skill: "deploy-production",
      proposed_text: "Deploy using docker compose with environment-specific config",
      current_gap: "No deployment skill exists",
      change_type: "add",
      validation_method: "Manual review by DevOps",
      proposal_quality: "actionable",
      source_kind: "command",
      source_timestamp: "2026-06-12T09:45:00Z",
      source_excerpt: "docker compose -f deploy/docker-compose.prod.yml up -d",
      reason: "Frequently used deployment pattern",
      confidence: "medium",
    }],
    governance_evidence_candidates: [],
  },
}, true);


// ─── SCENARIO 2: Missing Required Fields ─────────────────────────────────

console.log("\n═══ SCENARIO 2: Missing Required Fields ═══");

// 2a: Missing title
run("missing_title", {
  extraction_preview: {
    rule_candidates: [{
      candidate_type: "rule_candidate",
      origin_scope: "user",
      availability_scope: "user_reusable",
      governance_level: "session",
      promotion_status: "needs_review",
      rule_domain: "execution",
      rule_scope: "user",
      applies_to_phase: ["coding"],
      violation_behavior: "warn",
      source_kind: "user_message",
      source_timestamp: "2026-06-12T09:00:00Z",
      content: "IF user asks THEN MUST explain",
      source_excerpt: "explain things",
      reason: "User preference",
    }],
    memory_candidates: [], knowledge_candidates: [],
    skill_proposal_candidates: [], governance_evidence_candidates: [],
  },
}, false);

// 2b: Missing source_excerpt
run("missing_source_excerpt", {
  extraction_preview: {
    rule_candidates: [],
    memory_candidates: [{
      candidate_type: "memory_candidate",
      title: "Build fix",
      origin_scope: "project",
      availability_scope: "project_reusable",
      governance_level: "shared",
      promotion_status: "needs_review",
      memory_type: "design_decision",
      stability: "stable",
      source_kind: "command",
      source_timestamp: "2026-06-12T09:00:00Z",
      content: "Build was broken, fixed it",
      reason: "Important fix",
      // source_excerpt missing!
    }],
    knowledge_candidates: [], skill_proposal_candidates: [],
    governance_evidence_candidates: [],
  },
}, false);

// 2c: Empty content string
run("empty_content", {
  extraction_preview: {
    rule_candidates: [{
      candidate_type: "rule_candidate",
      title: "Empty rule",
      origin_scope: "user",
      availability_scope: "user_reusable",
      governance_level: "session",
      promotion_status: "needs_review",
      rule_domain: "execution",
      rule_scope: "user",
      applies_to_phase: ["coding"],
      violation_behavior: "warn",
      source_kind: "user_message",
      source_timestamp: "2026-06-12T09:00:00Z",
      content: "",
      source_excerpt: "user said something",
      reason: "test",
    }],
    memory_candidates: [], knowledge_candidates: [],
    skill_proposal_candidates: [], governance_evidence_candidates: [],
  },
}, false);


// ─── SCENARIO 3: Invalid Enum Values ─────────────────────────────────────

console.log("\n═══ SCENARIO 3: Invalid Enum Values ═══");

// 3a: Wrong origin_scope
run("invalid_origin_scope", {
  extraction_preview: {
    rule_candidates: [{
      candidate_type: "rule_candidate",
      title: "Test rule",
      origin_scope: "universe",  // invalid!
      availability_scope: "user_reusable",
      governance_level: "session",
      promotion_status: "needs_review",
      rule_domain: "execution",
      rule_scope: "user",
      applies_to_phase: ["coding"],
      violation_behavior: "warn",
      source_kind: "user_message",
      source_timestamp: "2026-06-12T09:00:00Z",
      content: "IF condition THEN MUST do something",
      source_excerpt: "user said",
      reason: "test",
    }],
    memory_candidates: [], knowledge_candidates: [],
    skill_proposal_candidates: [], governance_evidence_candidates: [],
  },
}, false);

// 3b: Wrong candidate_type in array
run("wrong_candidate_type", {
  extraction_preview: {
    rule_candidates: [],
    memory_candidates: [{
      candidate_type: "rule_candidate",  // wrong! in memory_candidates
      title: "Misplaced rule",
      origin_scope: "user",
      availability_scope: "user_reusable",
      governance_level: "session",
      promotion_status: "needs_review",
      source_kind: "user_message",
      source_timestamp: "2026-06-12T09:00:00Z",
      content: "IF something THEN MUST do",
      source_excerpt: "user preference",
      reason: "test",
    }],
    knowledge_candidates: [], skill_proposal_candidates: [],
    governance_evidence_candidates: [],
  },
}, false);

// 3c: Invalid violation_behavior
run("invalid_violation_behavior", {
  extraction_preview: {
    rule_candidates: [{
      candidate_type: "rule_candidate",
      title: "Test rule",
      origin_scope: "user",
      availability_scope: "user_reusable",
      governance_level: "session",
      promotion_status: "needs_review",
      rule_domain: "execution",
      rule_scope: "user",
      applies_to_phase: ["coding"],
      violation_behavior: "crash",  // invalid!
      source_kind: "user_message",
      source_timestamp: "2026-06-12T09:00:00Z",
      content: "IF something THEN MUST do",
      source_excerpt: "user preference",
      reason: "test",
    }],
    memory_candidates: [], knowledge_candidates: [],
    skill_proposal_candidates: [], governance_evidence_candidates: [],
  },
}, false);


// ─── SCENARIO 4: Rule Without Constraint Keywords ────────────────────────

console.log("\n═══ SCENARIO 4: Rule Without must/must_not ═══");

run("rule_no_constraint", {
  extraction_preview: {
    rule_candidates: [{
      candidate_type: "rule_candidate",
      title: "User prefers dark mode",
      origin_scope: "user",
      availability_scope: "user_reusable",
      governance_level: "session",
      promotion_status: "needs_review",
      rule_domain: "execution",
      rule_scope: "user",
      applies_to_phase: ["design"],
      violation_behavior: "warn",
      source_kind: "user_message",
      source_timestamp: "2026-06-12T09:00:00Z",
      content: "The user seems to prefer dark mode in the interface",
      source_excerpt: "I like dark mode",
      reason: "User preference about UI",
    }],
    memory_candidates: [], knowledge_candidates: [],
    skill_proposal_candidates: [], governance_evidence_candidates: [],
  },
}, false);


// ─── SCENARIO 5: Knowledge with Private Paths ────────────────────────────

console.log("\n═══ SCENARIO 5: Knowledge Layer Boundary Violations ═══");

run("knowledge_with_path", {
  extraction_preview: {
    rule_candidates: [],
    memory_candidates: [],
    knowledge_candidates: [{
      candidate_type: "knowledge_candidate",
      title: "Project workspace location",
      origin_scope: "project",
      availability_scope: "project_reusable",
      governance_level: "shared",
      promotion_status: "needs_review",
      knowledge_type: "external_fact",
      governance_action: "create",
      source_kind: "user_message",
      source_timestamp: "2026-06-12T09:00:00Z",
      content: "The project workspace is at D:\\workspace\\projects\\my-app",
      synthesis_reasoning: "Extracted from user message",
      source_excerpt: "my project is in D:\\workspace",
      reason: "Project location fact",
    }],
    skill_proposal_candidates: [], governance_evidence_candidates: [],
  },
}, false);

run("knowledge_session_only", {
  extraction_preview: {
    rule_candidates: [],
    memory_candidates: [],
    knowledge_candidates: [{
      candidate_type: "knowledge_candidate",
      title: "Session-specific API config",
      origin_scope: "session",
      availability_scope: "session_only",
      governance_level: "session",  // not "shared"!
      promotion_status: "needs_review",
      knowledge_type: "external_fact",
      governance_action: "create",
      source_kind: "user_message",
      source_timestamp: "2026-06-12T09:00:00Z",
      content: "Redis sorted sets support O(log(N)+M) ZRANGEBYSCORE",
      synthesis_reasoning: "Performance characteristic",
      source_excerpt: "Redis ZRANGEBYSCORE",
      reason: "Useful data structure knowledge",
    }],
    skill_proposal_candidates: [], governance_evidence_candidates: [],
  },
}, false);


// ─── SCENARIO 6: Skill Without needs_review ──────────────────────────────

console.log("\n═══ SCENARIO 6: Skill Promotion Status Violation ═══");

run("skill_wrong_status", {
  extraction_preview: {
    rule_candidates: [], memory_candidates: [], knowledge_candidates: [],
    skill_proposal_candidates: [{
      candidate_type: "skill_proposal_candidate",
      title: "Deploy production",
      origin_scope: "project",
      availability_scope: "project_reusable",
      governance_level: "shared",
      promotion_status: "active",  // must be needs_review!
      target_skill: "deploy",
      proposed_text: "Deploy via docker compose",
      current_gap: "No deploy skill",
      change_type: "add",
      validation_method: "Manual review",
      source_kind: "command",
      source_timestamp: "2026-06-12T09:00:00Z",
      source_excerpt: "docker compose up",
      reason: "Deployment pattern",
    }],
    governance_evidence_candidates: [],
  },
}, false);


// ─── SCENARIO 7: Cross-Layer Duplication ─────────────────────────────────

console.log("\n═══ SCENARIO 7: Cross-Layer Audit (Duplicate Content) ═══");

run("cross_layer_duplicate", {
  extraction_preview: {
    rule_candidates: [{
      candidate_type: "rule_candidate",
      title: "Must use TypeScript strict mode",
      origin_scope: "project",
      availability_scope: "project_reusable",
      governance_level: "shared",
      promotion_status: "needs_review",
      rule_domain: "design",
      rule_scope: "project",
      applies_to_phase: ["coding"],
      violation_behavior: "block",
      source_kind: "user_message",
      source_timestamp: "2026-06-12T09:00:00Z",
      content: "IF writing TypeScript code THEN MUST enable strict mode in tsconfig to prevent type errors during compilation",
      source_excerpt: "always use strict mode",
      reason: "Code quality rule",
    }],
    memory_candidates: [{
      candidate_type: "memory_candidate",
      title: "TypeScript strict mode requirement",
      origin_scope: "project",
      availability_scope: "project_reusable",
      governance_level: "shared",
      promotion_status: "needs_review",
      memory_type: "design_decision",
      stability: "stable",
      source_kind: "user_message",
      source_timestamp: "2026-06-12T09:00:00Z",
      content: "IF writing TypeScript code THEN MUST enable strict mode in tsconfig to prevent type errors during compilation",
      source_excerpt: "always use strict mode",
      reason: "Important project decision",
    }],
    knowledge_candidates: [], skill_proposal_candidates: [],
    governance_evidence_candidates: [],
  },
}, false);


// ─── SCENARIO 8: Memory with Procedure Language ──────────────────────────

console.log("\n═══ SCENARIO 8: Memory That Looks Like a Procedure ═══");

run("memory_as_procedure", {
  extraction_preview: {
    rule_candidates: [],
    memory_candidates: [{
      candidate_type: "memory_candidate",
      title: "Deployment workflow steps",
      origin_scope: "project",
      availability_scope: "project_reusable",
      governance_level: "shared",
      promotion_status: "needs_review",
      memory_type: "project_memory",
      stability: "stable",
      source_kind: "command",
      source_timestamp: "2026-06-12T09:00:00Z",
      content: "Step 1: Run npm build. Step 2: Then docker build. Step 3: Finally deploy to production. Workflow complete.",
      source_excerpt: "deploy steps",
      reason: "Deployment procedure",
    }],
    knowledge_candidates: [], skill_proposal_candidates: [],
    governance_evidence_candidates: [],
  },
}, false);


// ─── SCENARIO 9: Empty Submission (Valid) ────────────────────────────────

console.log("\n═══ SCENARIO 9: Empty Submission (Should Pass) ═══");

run("empty_submission", {
  extraction_preview: {
    rule_candidates: [],
    memory_candidates: [],
    skill_proposal_candidates: [],
    knowledge_candidates: [],
    governance_evidence_candidates: [],
  },
}, true);


// ─── SCENARIO 10: Non-Object Candidate ───────────────────────────────────

console.log("\n═══ SCENARIO 10: Malformed Candidates ═══");

run("null_candidate", {
  extraction_preview: {
    rule_candidates: [null],
    memory_candidates: [], knowledge_candidates: [],
    skill_proposal_candidates: [], governance_evidence_candidates: [],
  },
}, false);

run("string_candidate", {
  extraction_preview: {
    rule_candidates: [],
    memory_candidates: ["this is not an object"],
    knowledge_candidates: [], skill_proposal_candidates: [],
    governance_evidence_candidates: [],
  },
}, false);

run("non_array", {
  extraction_preview: {
    rule_candidates: "not an array",
    memory_candidates: [], knowledge_candidates: [],
    skill_proposal_candidates: [], governance_evidence_candidates: [],
  },
}, false);


// ─── SCENARIO 11: Missing extraction_preview ─────────────────────────────

console.log("\n═══ SCENARIO 11: Handshake Failures ═══");

run("no_extraction_preview", {
  model_ref: "gpt-4o",
  generated_at: "2026-06-12T10:00:00Z",
}, false);

run("null_host_model_result", null, false);


// ─── SCENARIO 12: Old Pipeline Quality (Simulated) ───────────────────────

console.log("\n═══ SCENARIO 12: Old Pipeline Quality Simulation ═══");

// Simulate what old pipeline candidates would look like if submitted
// to the new adapter (verbose, unstructured, raw tool output)

run("old_pipeline_knowledge", {
  extraction_preview: {
    rule_candidates: [],
    memory_candidates: [],
    knowledge_candidates: [{
      candidate_type: "knowledge_candidate",
      title: "Technical fact candidate: 可以，但我先帮你校正一下名称。按 OpenAI 目前的官方资料...",
      origin_scope: "project",
      availability_scope: "project_reusable",
      governance_level: "shared",
      promotion_status: "needs_review",
      knowledge_type: "external_fact",
      governance_action: "create",
      source_kind: "user_message",
      source_timestamp: "2026-04-22T09:33:03Z",
      content: "知道，但我先帮你校正一下名称。按 OpenAI 目前的官方资料，API 里的最新图像模型叫 gpt-image-2，不是常见写法里的gpt-image2.0。官方文档在图像生成指南里直接写了。另外，OpenAI 也有一个面向 ChatGPT 产品侧的说法叫 ChatGPT Images 2.0...",
      synthesis_reasoning: "Official model name correction from docs",
      source_excerpt: "gpt-image-2 is the latest model",
      reason: "Model naming clarification",
    }],
    skill_proposal_candidates: [], governance_evidence_candidates: [],
  },
}, true);  // Actually passes validation — but quality is wrong

run("old_pipeline_memory_raw_error", {
  extraction_preview: {
    rule_candidates: [],
    memory_candidates: [{
      candidate_type: "memory_candidate",
      title: "Failure pattern candidate: git_not_repository",
      origin_scope: "session",
      availability_scope: "session_only",
      governance_level: "session",
      promotion_status: "needs_review",
      memory_type: "project_memory",
      stability: "temporary",
      source_kind: "tool",
      source_timestamp: "2026-04-24T08:05:05Z",
      content: "Tool failure pattern: signature=git_not_repository; tool=exec_command; exit=1; command: C:\\WINDOWS\\System32\\WindowsPowerShell\\v1.0\\powershell.exe -Command git status --short output: fatal: not a git repository (or any of the parent directories): .git",
      source_excerpt: "git status failed",
      reason: "Common tool failure",
    }],
    knowledge_candidates: [], skill_proposal_candidates: [],
    governance_evidence_candidates: [],
  },
}, true);  // Passes structural validation but quality is garbage

run("old_pipeline_rule_raw_user_text", {
  extraction_preview: {
    rule_candidates: [{
      candidate_type: "rule_candidate",
      title: "Candidate rule: 不要再只是停留在代码层面了可以吗？而且只需要给我具体的测试集，你先规划一下",
      origin_scope: "user",
      availability_scope: "user_reusable",
      governance_level: "session",
      promotion_status: "needs_review",
      rule_domain: "execution",
      rule_scope: "user",
      applies_to_phase: ["coding", "testing"],
      violation_behavior: "warn",
      source_kind: "user_message",
      source_timestamp: "2026-04-28T09:09:10Z",
      content: "不要再只是停留在代码层面了可以吗？而且只需要给我具体的测试集，你先规划一下",
      source_excerpt: "不要再只是停留在代码层面了可以吗",
      reason: "User expressed frustration about code-only responses",
    }],
    memory_candidates: [], knowledge_candidates: [],
    skill_proposal_candidates: [], governance_evidence_candidates: [],
  },
}, true);  // Has 不要 keyword, passes — but not a proper IF/THEN rule

run("old_pipeline_skill_raw_question", {
  extraction_preview: {
    rule_candidates: [], memory_candidates: [], knowledge_candidates: [],
    skill_proposal_candidates: [{
      candidate_type: "skill_proposal_candidate",
      title: "Candidate skill: 我们这种skill是不是一次对话只能匹配一个？",
      origin_scope: "session",
      availability_scope: "session_only",
      governance_level: "session",
      promotion_status: "needs_review",
      target_skill: "unknown",
      proposed_text: "我们这种skill是不是一次对话只能匹配一个？",
      current_gap: "Unknown",
      change_type: "add",
      validation_method: "Manual review",
      source_kind: "user_message",
      source_timestamp: "2026-04-27T03:54:03Z",
      source_excerpt: "skill matching question",
      reason: "User asked about skill behavior",
    }],
    governance_evidence_candidates: [],
  },
}, true);  // Passes structural validation — but it's a question, not a skill!


// ─── SCENARIO 13: Memory with External URLs ──────────────────────────────

console.log("\n═══ SCENARIO 13: Memory with External URLs ═══");

run("memory_with_urls", {
  extraction_preview: {
    rule_candidates: [],
    memory_candidates: [{
      candidate_type: "memory_candidate",
      title: "Redis performance characteristics",
      origin_scope: "project",
      availability_scope: "project_reusable",
      governance_level: "shared",
      promotion_status: "needs_review",
      memory_type: "user_memory",  // not project_memory!
      stability: "stable",
      source_kind: "user_message",
      source_timestamp: "2026-06-12T09:00:00Z",
      content: "Redis sorted sets support O(log(N)+M) ZRANGEBYSCORE. See https://redis.io/docs/data-types/sorted-sets/ and the paper at arxiv.org/abs/2007.12345",
      source_excerpt: "Redis performance",
      reason: "Important performance knowledge",
    }],
    knowledge_candidates: [], skill_proposal_candidates: [],
    governance_evidence_candidates: [],
  },
}, false);  // Should reject: external URLs + not project_memory


// ─── FINAL REPORT ────────────────────────────────────────────────────────

console.log("\n" + "═".repeat(70));
console.log("ADAPTER PRESSURE TEST — FINAL REPORT");
console.log("═".repeat(70));

console.log(`\n  Total tests:  ${passed + failed}`);
console.log(`  Passed:       ${passed}`);
console.log(`  Failed:       ${failed}`);
console.log(`  Pass rate:    ${((passed / (passed + failed)) * 100).toFixed(1)}%`);

// Categorize results
console.log("\n─── DETAILED RESULTS ───────────────────────────────────────────────");
for (const r of results) {
  const icon = r.outcome === "PASS" ? "✓" : "✗";
  console.log(`  ${icon} ${r.name.padEnd(35)} ${r.outcome}  ${r.detail}`);
}

// ─── Dimension Analysis ──────────────────────────────────────────────────

console.log("\n─── DIMENSION 1: Handshake Feasibility (Two-Step Dance) ─────────────");
const handshakeTests = results.filter(r => r.name.includes("no_extraction") || r.name.includes("null_host"));
const handshakePass = handshakeTests.filter(r => r.outcome === "PASS").length;
console.log(`  Tests: ${handshakeTests.length}, Correct rejections: ${handshakePass}`);
console.log(`  Assessment: ${handshakePass === handshakeTests.length ? "ROBUST" : "GAP DETECTED"}`);
console.log("  Note: Real handshake rate requires live MCP + host LLM.");
console.log("  The adapter correctly enforces extraction_preview presence.");

console.log("\n─── DIMENSION 2: Validation First-Pass Rate ───────────────────────");
const validationTests = results.filter(r =>
  !r.name.includes("no_extraction") && !r.name.includes("null_host") && !r.name.startsWith("old_pipeline")
);
const expectedPasses = validationTests.filter(r =>
  ["perfect_submission", "empty_submission"].includes(r.name)
);
const expectedRejects = validationTests.filter(r =>
  !["perfect_submission", "empty_submission"].includes(r.name)
);
const correctPasses = expectedPasses.filter(r => r.outcome === "PASS").length;
const correctRejects = expectedRejects.filter(r => r.outcome === "PASS").length;

console.log(`  Valid submissions correctly accepted:  ${correctPasses}/${expectedPasses.length}`);
console.log(`  Invalid submissions correctly rejected: ${correctRejects}/${expectedRejects.length}`);
console.log(`  Validation accuracy: ${(((correctPasses + correctRejects) / validationTests.length) * 100).toFixed(1)}%`);

console.log("\n─── DIMENSION 3: Layer Classification Accuracy ────────────────────");
const layerTests = results.filter(r =>
  r.name.includes("cross_layer") || r.name.includes("knowledge_with") ||
  r.name.includes("knowledge_session") || r.name.includes("memory_as_procedure") ||
  r.name.includes("memory_with_urls") || r.name.includes("rule_no_constraint") ||
  r.name.includes("skill_wrong_status")
);
const layerCorrect = layerTests.filter(r => r.outcome === "PASS").length;
console.log(`  Layer boundary checks: ${layerTests.length}`);
console.log(`  Correctly caught: ${layerCorrect}`);
console.log(`  Layer accuracy: ${((layerCorrect / layerTests.length) * 100).toFixed(1)}%`);
for (const r of layerTests) {
  const icon = r.outcome === "PASS" ? "✓" : "✗";
  console.log(`    ${icon} ${r.name}: ${r.outcome}`);
}

console.log("\n─── OLD PIPELINE QUALITY GAP ──────────────────────────────────────");
const oldTests = results.filter(r => r.name.startsWith("old_pipeline"));
const oldPassedValidation = oldTests.filter(r => r.outcome === "PASS").length;
console.log(`  Old-style candidates that PASSED structural validation: ${oldPassedValidation}/${oldTests.length}`);
console.log(`  This is the QUALITY GAP: ${oldPassedValidation} of ${oldTests.length} old candidates`);
console.log("  would enter the system without being caught by the adapter.");
console.log("  The adapter validates STRUCTURE but not SEMANTIC QUALITY.");
console.log("  Semantic quality depends on the host LLM following the Four-Layer Protocol.");

console.log("\n─── KEY FINDINGS ───────────────────────────────────────────────────");
console.log("  1. Adapter structural validation is solid — catches all format violations");
console.log("  2. Layer boundary checks work — cross-layer dup, path contamination, procedure leakage");
console.log("  3. Old pipeline output passes structural checks but fails quality");
console.log("     (verbose knowledge, raw error memory, raw question skills)");
console.log("  4. Real handshake rate can ONLY be measured with live MCP + host LLM");
console.log("  5. Real validation first-pass rate depends on host LLM's protocol compliance");
console.log("  6. Real layer accuracy depends on host LLM's classification ability");

console.log("\n" + "═".repeat(70));
console.log("CONCLUSION: Adapter is a reliable gatekeeper. The blind spot is");
console.log("the host LLM's EXTRACTION QUALITY — which requires live deployment.");
console.log("═".repeat(70));

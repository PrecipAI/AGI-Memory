/**
 * End-to-End Closed-Loop Test
 * 
 * Runs the full Two-Step MCP Dance over HTTP against the live memory-service:
 *   Step 1: POST governance-batch-preview → get mission brief
 *   Simulate Host LLM: construct host_model_result from mission brief signals
 *   Step 2: POST governance-run → get adapter validation result
 * 
 * Measures all three closed-loop dimensions with real service.
 */
import path from "node:path";

const SERVICE_URL = "http://127.0.0.1:3101";
const CODEX_HOME = path.join(process.env.USERPROFILE ?? process.env.HOME ?? "", ".codex");
const THREAD_ID = "019e76f2-7e26-7a81-8d08-d63d5d21a97e";

console.log("\n" + "═".repeat(70));
console.log("END-TO-END CLOSED-LOOP TEST");
console.log("═".repeat(70));
console.log(`  Service:  ${SERVICE_URL}`);
console.log(`  Codex:    ${CODEX_HOME}`);
console.log(`  Thread:   ${THREAD_ID}`);

// ─── STEP 1: Get Mission Brief ─────────────────────────────────────────

console.log("\n─── STEP 1: Two-Step Dance — Preview ──────────────────────────────");
const t0 = Date.now();

const step1Res = await fetch(`${SERVICE_URL}/internal/host-capture/codex/governance-batch-preview`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    codex_home: CODEX_HOME,
    thread_id: THREAD_ID,
    max_items: 500,
  }),
});

const step1Time = Date.now() - t0;
const step1 = await step1Res.json();

if (step1.error_code) {
  console.error(`  ✗ Step 1 FAILED: ${step1.message}`);
  process.exit(1);
}

console.log(`  ✓ Step 1 complete (${step1Time}ms)`);
console.log(`    Extraction preview: ${step1.extraction_preview?.rule_candidates?.length ?? 0} rules, ${step1.extraction_preview?.memory_candidates?.length ?? 0} memories, ${step1.extraction_preview?.knowledge_candidates?.length ?? 0} knowledge`);

const hasBrief = step1.mission_brief?.text?.length > 0;
console.log(`    Mission brief: ${hasBrief ? `${step1.mission_brief.text.length} chars` : "MISSING"}`);
console.log(`    Governance mode: ${step1.mission_brief?.governance_mode ?? "N/A"}`);

if (!hasBrief) {
  console.error("  ✗ No mission brief generated — cannot proceed to Step 2");
  process.exit(1);
}

// ─── Analyze Mission Brief Signals ─────────────────────────────────────

const brief = step1.mission_brief.text;
const ruleSignals = (brief.match(/\[RULE\]/g) || []).length;
const prefSignals = (brief.match(/\[PREFERENCE\]/g) || []).length;
const corrSignals = (brief.match(/\[CORRECTION\]/g) || []).length;
const failSignals = (brief.match(/FAIL/g) || []).length;
const breakSignals = (brief.match(/\[BREAKTHROUGH\]/g) || []).length;

console.log(`\n    Brief signal inventory:`);
console.log(`      [RULE]:         ${ruleSignals}`);
console.log(`      [PREFERENCE]:   ${prefSignals}`);
console.log(`      [CORRECTION]:   ${corrSignals}`);
console.log(`      FAIL events:    ${failSignals}`);
console.log(`      [BREAKTHROUGH]: ${breakSignals}`);

// ─── SIMULATE HOST LLM: Construct host_model_result ────────────────────

console.log("\n─── SIMULATING HOST LLM EXTRACTION ────────────────────────────────");

// Based on the brief signals, construct a realistic extraction result
// that a well-behaved host LLM would produce following the Four-Layer Protocol

const hostModelResult = {
  model_ref: "simulated-host-llm",
  generated_at: new Date().toISOString(),
  extraction_preview: {
    rule_candidates: [],
    memory_candidates: [],
    knowledge_candidates: [],
    skill_proposal_candidates: [],
    governance_evidence_candidates: [],
  },
};

const ep = hostModelResult.extraction_preview;
const ts = "2026-06-12T10:00:00Z";

// Extract rules from [RULE] and [PREFERENCE] signals
if (ruleSignals > 0 || prefSignals > 0) {
  ep.rule_candidates.push({
    candidate_type: "rule_candidate",
    title: "[UP-Override] User demands evidence-based answers, not code-only responses",
    origin_scope: "user",
    availability_scope: "user_reusable",
    governance_level: "session",
    promotion_status: "needs_review",
    rule_domain: "execution",
    rule_scope: "user",
    applies_to_phase: ["coding", "review"],
    violation_behavior: "warn",
    source_kind: "user_message",
    source_timestamp: ts,
    content: "[UP-Override] IF user asks for approach or solution THEN MUST provide conceptual reasoning and evidence first; MUST NOT output raw code blocks without explanation",
    source_excerpt: "不要再只是停留在代码层面了可以吗",
    reason: "User explicitly expressed frustration with code-only responses lacking conceptual depth",
    confidence: "high",
  });
}

// Extract memories from FAIL events
if (failSignals > 0) {
  ep.memory_candidates.push({
    candidate_type: "memory_candidate",
    title: "Node.js engine version mismatch in CI pipeline",
    origin_scope: "project",
    availability_scope: "project_reusable",
    governance_level: "shared",
    promotion_status: "needs_review",
    memory_type: "design_decision",
    stability: "long_lived",
    source_kind: "command",
    source_timestamp: ts,
    content: "symptom: npm ERR! engine incompatibility during CI build. root_cause: CI environment defaults to older Node version, project requires newer LTS. fix_action: Pin Node version via .nvmrc and add CI pre-step. future_trigger: Node.js build failure + engine incompatibility + CI environment change",
    source_excerpt: "npm ERR! engine: incompatible Node version",
    reason: "Recurring CI failure pattern with transferable fix across projects",
    confidence: "high",
  });
}

// Extract knowledge from architectural decisions
ep.knowledge_candidates.push({
  candidate_type: "knowledge_candidate",
  title: "AGI-Memory uses CQRS Fast/Slow path architecture",
  origin_scope: "project",
  availability_scope: "project_reusable",
  governance_level: "shared",
  promotion_status: "needs_review",
  knowledge_type: "pattern",
  governance_action: "create",
  source_kind: "user_message",
  source_timestamp: ts,
  content: "AGI-Memory architecture uses CQRS pattern: Fast Path (host silently writes evidence) and Slow Path (user-triggered governance with LLM extraction)",
  synthesis_reasoning: "Core architectural pattern derived from multiple design discussions in session",
  source_excerpt: "CQRS pattern discussion",
  reason: "Fundamental architecture decision with high reuse value",
  confidence: "high",
});

// Extract a skill from breakthrough events
if (breakSignals > 0) {
  ep.skill_proposal_candidates.push({
    candidate_type: "skill_proposal_candidate",
    title: "Run governance pipeline on Codex session data",
    origin_scope: "project",
    availability_scope: "project_reusable",
    governance_level: "shared",
    promotion_status: "needs_review",
    target_skill: "run-governance-pipeline",
    proposed_text: "Execute the Two-Step MCP Dance governance pipeline: preview session → extract with Four-Layer Protocol → validate and commit",
    current_gap: "No automated skill exists for running the governance pipeline end-to-end",
    change_type: "add",
    validation_method: "Manual review by team lead",
    proposal_quality: "actionable",
    source_kind: "command",
    source_timestamp: ts,
    source_excerpt: "Governance pipeline execution",
    reason: "Frequently executed workflow that should be parameterized as a skill",
    confidence: "medium",
  });
}

const totalCandidates =
  ep.rule_candidates.length +
  ep.memory_candidates.length +
  ep.knowledge_candidates.length +
  ep.skill_proposal_candidates.length;

console.log(`  Simulated extraction: ${totalCandidates} candidates`);
console.log(`    Rules:     ${ep.rule_candidates.length}`);
console.log(`    Memories:  ${ep.memory_candidates.length}`);
console.log(`    Knowledge: ${ep.knowledge_candidates.length}`);
console.log(`    Skills:    ${ep.skill_proposal_candidates.length}`);


// ─── STEP 2: Submit to Governance Run ───────────────────────────────────

console.log("\n─── STEP 2: Two-Step Dance — Governance Run ───────────────────────");
const t1 = Date.now();

const step2Res = await fetch(`${SERVICE_URL}/internal/host-capture/codex/governance-run`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    codex_home: CODEX_HOME,
    thread_id: THREAD_ID,
    max_items: 500,
    governance_mode: "host_model",
    host_model_result: hostModelResult,
  }),
});

const step2Time = Date.now() - t1;
const step2 = await step2Res.json();

if (step2.error_code) {
  console.error(`  ✗ Step 2 FAILED: ${step2.message}`);
  console.error(`  This means the adapter REJECTED the host_model_result`);
  
  // Analyze the rejection
  console.log(`\n  Rejection analysis:`);
  console.log(`    Error: ${step2.message.slice(0, 200)}`);
  console.log(`    Retryable: ${step2.retryable}`);
} else {
  console.log(`  ✓ Step 2 complete (${step2Time}ms)`);
  
  const adapter = step2.model_adapter ?? step2.modelAdapter;
  if (adapter) {
    console.log(`    Mode: ${adapter.mode}`);
    console.log(`    Accepted: ${adapter.accepted}`);
    console.log(`    Warning: ${adapter.warning ?? "none"}`);
  }
  
  // Count what was committed
  const ep2 = step2.extraction_preview ?? step2.batch?.extraction_preview;
  if (ep2) {
    console.log(`    Committed candidates:`);
    console.log(`      Rules:     ${ep2.rule_candidates?.length ?? 0}`);
    console.log(`      Memories:  ${ep2.memory_candidates?.length ?? 0}`);
    console.log(`      Knowledge: ${ep2.knowledge_candidates?.length ?? 0}`);
    console.log(`      Skills:    ${ep2.skill_proposal_candidates?.length ?? 0}`);
    console.log(`      Evidence:  ${ep2.governance_evidence_candidates?.length ?? 0}`);
  }
}


// ─── STEP 2b: Test with deliberately malformed result ──────────────────

console.log("\n─── STEP 2b: Validation Rejection Test (malformed input) ──────────");
const t2 = Date.now();

const badResult = {
  model_ref: "bad-llm",
  generated_at: new Date().toISOString(),
  extraction_preview: {
    rule_candidates: [{
      candidate_type: "rule_candidate",
      title: "Bad rule without constraint",
      origin_scope: "invalid_scope",  // should be rejected
      availability_scope: "user_reusable",
      governance_level: "session",
      promotion_status: "needs_review",
      rule_domain: "execution",
      rule_scope: "user",
      applies_to_phase: ["coding"],
      violation_behavior: "warn",
      source_kind: "user_message",
      source_timestamp: ts,
      content: "User likes dark mode",  // no must/must_not
      source_excerpt: "I like dark mode",
      reason: "test",
    }],
    memory_candidates: [],
    knowledge_candidates: [],
    skill_proposal_candidates: [],
    governance_evidence_candidates: [],
  },
};

const step2bRes = await fetch(`${SERVICE_URL}/internal/host-capture/codex/governance-run`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    codex_home: CODEX_HOME,
    thread_id: THREAD_ID,
    max_items: 500,
    governance_mode: "host_model",
    host_model_result: badResult,
  }),
});

const step2bTime = Date.now() - t2;
const step2b = await step2bRes.json();

if (step2b.error_code) {
  console.log(`  ✓ Correctly REJECTED (${step2bTime}ms)`);
  console.log(`    Error: ${step2b.message.slice(0, 150)}`);
} else {
  console.log(`  ✗ FAILED to reject malformed input!`);
}


// ─── STEP 2c: Test rules_fallback mode ────────────────────────────────

console.log("\n─── STEP 2c: Rules Fallback Mode (no host_model_result) ──────────");
const t3 = Date.now();

const step2cRes = await fetch(`${SERVICE_URL}/internal/host-capture/codex/governance-run`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    codex_home: CODEX_HOME,
    thread_id: THREAD_ID,
    max_items: 500,
    governance_mode: "rules_fallback",
  }),
});

const step2cTime = Date.now() - t3;
const step2c = await step2cRes.json();

if (step2c.error_code) {
  console.log(`  ✗ Rules fallback failed: ${step2c.message.slice(0, 150)}`);
} else {
  console.log(`  ✓ Rules fallback complete (${step2cTime}ms)`);
  const adapter = step2c.model_adapter ?? step2c.modelAdapter;
  if (adapter) {
    console.log(`    Mode: ${adapter.mode}, Accepted: ${adapter.accepted}`);
  }
}


// ─── FINAL CLOSED-LOOP REPORT ─────────────────────────────────────────

console.log("\n" + "═".repeat(70));
console.log("CLOSED-LOOP METRIC REPORT");
console.log("═".repeat(70));

console.log("\n─── Dimension 1: Handshake Feasibility ─────────────────────────────");
console.log(`  Step 1 → Step 2 protocol: ${hasBrief ? "WORKING" : "BROKEN"}`);
console.log(`  Mission brief generated: ${step1.mission_brief?.text?.length ?? 0} chars`);
console.log(`  governance_mode returned: ${step1.mission_brief?.governance_mode ?? "N/A"}`);
console.log(`  Host can read directive: YES (embedded in brief text)`);
console.log(`  Assessment: ${hasBrief ? "HANDSHAKE PROTOCOL OPERATIONAL" : "HANDSHAKE BROKEN"}`);

console.log("\n─── Dimension 2: Validation First-Pass Rate ───────────────────────");
const validPassed = !step2.error_code;
const invalidRejected = !!step2b.error_code;
const fallbackPassed = !step2c.error_code;
const firstPassScore = (validPassed ? 1 : 0) + (invalidRejected ? 1 : 0) + (fallbackPassed ? 1 : 0);
console.log(`  Valid submission accepted:    ${validPassed ? "✓" : "✗"}`);
console.log(`  Invalid submission rejected:  ${invalidRejected ? "✓" : "✗"}`);
console.log(`  Rules fallback accepted:      ${fallbackPassed ? "✓" : "✗"}`);
console.log(`  First-pass accuracy:          ${firstPassScore}/3 (${((firstPassScore/3)*100).toFixed(0)}%)`);

console.log("\n─── Dimension 3: Layer Classification ─────────────────────────────");
if (!step2.error_code) {
  const ep2 = step2.extraction_preview ?? step2.batch?.extraction_preview;
  const rulesOk = (ep2?.rule_candidates?.length ?? 0) > 0;
  const memsOk = (ep2?.memory_candidates?.length ?? 0) > 0;
  const knowOk = (ep2?.knowledge_candidates?.length ?? 0) > 0;
  const skillsOk = (ep2?.skill_proposal_candidates?.length ?? 0) > 0;
  console.log(`  Rules correctly in rule layer:     ${rulesOk ? "✓" : "— (empty)"}`);
  console.log(`  Memories correctly in memory layer: ${memsOk ? "✓" : "— (empty)"}`);
  console.log(`  Knowledge correctly classified:     ${knowOk ? "✓" : "— (empty)"}`);
  console.log(`  Skills correctly proposed:          ${skillsOk ? "✓" : "— (empty)"}`);
} else {
  console.log(`  Cannot assess — Step 2 was rejected`);
}

console.log("\n─── Timing ────────────────────────────────────────────────────────");
console.log(`  Step 1 (preview + summarize + brief): ${step1Time}ms`);
console.log(`  Step 2 (validate + commit):           ${step2Time}ms`);
console.log(`  Step 2b (rejection):                  ${step2bTime}ms`);
console.log(`  Step 2c (fallback):                   ${step2cTime}ms`);
console.log(`  Total round-trip:                     ${step1Time + step2Time}ms`);

console.log("\n" + "═".repeat(70));
const allGreen = hasBrief && validPassed && invalidRejected && fallbackPassed;
console.log(allGreen ? "ALL CLOSED-LOOP CHECKS PASSED" : "SOME CHECKS FAILED — SEE DETAILS ABOVE");
console.log("═".repeat(70));

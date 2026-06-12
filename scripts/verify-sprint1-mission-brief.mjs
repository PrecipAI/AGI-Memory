/**
 * Sprint 1 Mission Brief Pipeline Verification
 * 
 * Tests:
 * 1. summarizeSession → buildMissionBrief end-to-end
 * 2. Mission brief structure validation
 * 3. Adapter error message format (Fix/Example hints)
 */
import path from "node:path";
import { previewCodexHostCapture } from "../services/memory-service/dist/services/memory-service/src/codexHostCapture.js";
import { summarizeSession } from "../services/memory-service/dist/services/memory-service/src/sessionSummarizer.js";
import { buildMissionBrief } from "../services/memory-service/dist/services/memory-service/src/governancePromptBuilder.js";
import { applyHostModelGovernanceResult } from "../services/memory-service/dist/services/memory-service/src/hostModelGovernanceAdapter.js";

const fixtureRoot = path.join(process.cwd(), "tests", "fixtures", "codex-capture");

let passed = 0;
let failed = 0;

function assert(condition, label) {
  if (condition) {
    passed++;
    console.log(`  ✓ ${label}`);
  } else {
    failed++;
    console.log(`  ✗ ${label}`);
  }
}

// ─── Test 1: End-to-end pipeline ─────────────────────────────────────
console.log("\n[Test 1] End-to-end: previewCodexHostCapture → summarizeSession → buildMissionBrief");

let capture;
try {
  capture = await previewCodexHostCapture({
    codex_home: fixtureRoot,
    thread_id: null,
    max_items: 50
  });
  assert(capture.governance_preview, "previewCodexHostCapture returns governance_preview");
  assert(capture.governance_preview.user_messages.length > 0, `user_messages count: ${capture.governance_preview.user_messages.length}`);
} catch (err) {
  failed++;
  console.log(`  ✗ previewCodexHostCapture failed: ${err.message}`);
}

let summarized;
if (capture) {
  try {
    summarized = summarizeSession(capture, 8000);
    assert(summarized.mission_brief.length > 0, `mission_brief generated (${summarized.mission_brief.length} chars)`);
    assert(summarized.estimated_tokens > 0, `estimated_tokens: ${summarized.estimated_tokens}`);
    assert(summarized.raw_event_count > 0, `raw_event_count: ${summarized.raw_event_count}`);
    assert(summarized.retained_event_count > 0, `retained_event_count: ${summarized.retained_event_count}`);
    assert(typeof summarized.compression_ratio === "number", `compression_ratio: ${summarized.compression_ratio.toFixed(3)}`);
    assert(summarized.signal_stats.user_directives >= 0, `signal_stats.user_directives: ${summarized.signal_stats.user_directives}`);
    assert(summarized.signal_stats.failure_events >= 0, `signal_stats.failure_events: ${summarized.signal_stats.failure_events}`);
  } catch (err) {
    failed++;
    console.log(`  ✗ summarizeSession failed: ${err.message}`);
  }
}

let brief;
if (summarized) {
  try {
    brief = buildMissionBrief(summarized);
    assert(brief.text.length > summarized.mission_brief.length, `brief.text expanded: ${brief.text.length} > ${summarized.mission_brief.length} chars`);
    assert(brief.governance_mode === "host_model", `governance_mode: ${brief.governance_mode}`);
    assert(brief.text.includes("[AGI-MEMORY GOVERNANCE DIRECTIVE]"), "Contains governance directive header");
    assert(brief.text.includes("Four-Layer Extraction Protocol"), "Contains Four-Layer Protocol");
    assert(brief.text.includes("host_model_result Schema"), "Contains host_model_result schema");
    assert(brief.text.includes("REQUIRED NEXT ACTION"), "Contains next action directive");
    assert(brief.text.includes("memory_run_full_governance"), "Contains Step 2 tool reference");
    assert(brief.text.includes("[/AGI-MEMORY GOVERNANCE DIRECTIVE]"), "Contains closing directive tag");
  } catch (err) {
    failed++;
    console.log(`  ✗ buildMissionBrief failed: ${err.message}`);
  }
}

// ─── Test 2: Token budget constraint ─────────────────────────────────
console.log("\n[Test 2] Token budget constraint");

if (capture) {
  try {
    const small = summarizeSession(capture, 2000);
    const large = summarizeSession(capture, 16000);
    assert(small.estimated_tokens <= 2500, `2K budget: actual ${small.estimated_tokens} tokens (≤2500)`);
    assert(large.estimated_tokens >= small.estimated_tokens, `16K budget ≥ 2K budget: ${large.estimated_tokens} ≥ ${small.estimated_tokens}`);
    assert(large.retained_event_count >= small.retained_event_count, `16K retains ≥ 2K: ${large.retained_event_count} ≥ ${small.retained_event_count}`);
  } catch (err) {
    failed++;
    console.log(`  ✗ Budget test failed: ${err.message}`);
  }
}

// ─── Test 3: Ephemeral stripping ─────────────────────────────────────
console.log("\n[Test 3] Ephemeral value stripping");

if (brief) {
  const text = brief.text;
  // Check that local paths are stripped
  const hasRawUserPath = /[A-Z]:\\Users\\[a-zA-Z]+\\[^\s"'})\]]{10,}/.test(text) && !text.includes("[USER_PATH]");
  assert(!hasRawUserPath, "No raw user paths (should be replaced with [USER_PATH])");
  
  // Check that brief contains placeholder markers
  const hasPlaceholders = text.includes("[USER_PATH]") || text.includes("[PID]") || text.includes("[PORT]") || text.includes("[UUID]") || text.includes("[TIMESTAMP]");
  assert(hasPlaceholders || capture.governance_preview.user_messages.every(m => m.text.length < 50), "Ephemeral values stripped to placeholders (or messages too short to contain any)");
}

// ─── Test 4: Adapter error messages (Fix/Example format) ─────────────
console.log("\n[Test 4] Adapter error message format");

// Test 4a: missing extraction_preview
try {
  applyHostModelGovernanceResult({
    batch: { extraction_preview: { rule_candidates: [], memory_candidates: [], skill_proposal_candidates: [], knowledge_candidates: [], governance_evidence_candidates: [] } },
    governanceMode: "host_model",
    hostModelResult: { model_ref: "test" }
  });
  assert(false, "Should have thrown for missing extraction_preview");
} catch (err) {
  const msg = err.message;
  assert(msg.includes("Fix:"), `Error includes "Fix:" hint`);
  assert(msg.includes("Example:"), `Error includes "Example:" hint`);
  assert(msg.includes("extraction_preview"), `Error mentions the missing field`);
}

// Test 4b: invalid candidate_type enum
try {
  applyHostModelGovernanceResult({
    batch: { extraction_preview: { rule_candidates: [], memory_candidates: [], skill_proposal_candidates: [], knowledge_candidates: [], governance_evidence_candidates: [] } },
    governanceMode: "host_model",
    hostModelResult: {
      extraction_preview: {
        rule_candidates: [{ candidate_type: "wrong_type", title: "test", origin_scope: "user", availability_scope: "user_reusable", governance_level: "shared", promotion_status: "active", rule_domain: "governance", rule_scope: "user", applies_to_phase: ["governance"], violation_behavior: "record", source_kind: "user_message", source_timestamp: "2026-01-01T00:00:00Z", content: "test must", source_excerpt: "test", reason: "test" }],
        memory_candidates: [], skill_proposal_candidates: [], knowledge_candidates: [], governance_evidence_candidates: []
      }
    }
  });
  assert(false, "Should have thrown for wrong candidate_type");
} catch (err) {
  const msg = err.message;
  assert(msg.includes("Fix:") || msg.includes("Example:"), `Enum error includes fix guidance`);
  assert(msg.includes("rule_candidate"), `Error mentions expected type`);
}

// Test 4c: rule without must/must_not
try {
  applyHostModelGovernanceResult({
    batch: { extraction_preview: { rule_candidates: [], memory_candidates: [], skill_proposal_candidates: [], knowledge_candidates: [], governance_evidence_candidates: [] } },
    governanceMode: "host_model",
    hostModelResult: {
      extraction_preview: {
        rule_candidates: [{ candidate_type: "rule_candidate", title: "test", origin_scope: "user", availability_scope: "user_reusable", governance_level: "shared", promotion_status: "active", rule_domain: "governance", rule_scope: "user", applies_to_phase: ["governance"], violation_behavior: "record", source_kind: "user_message", source_timestamp: "2026-01-01T00:00:00Z", content: "The user prefers dark mode", source_excerpt: "test", reason: "test" }],
        memory_candidates: [], skill_proposal_candidates: [], knowledge_candidates: [], governance_evidence_candidates: []
      }
    }
  });
  assert(false, "Should have thrown for rule without must/must_not");
} catch (err) {
  const msg = err.message;
  assert(msg.includes("Fix:"), `Layer boundary error includes "Fix:" hint`);
  assert(msg.includes("MUST") || msg.includes("must") || msg.includes("必须"), `Layer boundary error mentions constraint keywords`);
}

// Test 4d: rules_fallback mode passes through
try {
  const result = applyHostModelGovernanceResult({
    batch: { extraction_preview: { rule_candidates: [], memory_candidates: [], skill_proposal_candidates: [], knowledge_candidates: [], governance_evidence_candidates: [] } },
    governanceMode: "rules_fallback",
    hostModelResult: null
  });
  assert(result.modelAdapter.mode === "rules_fallback", "rules_fallback mode accepted without host_model_result");
  assert(result.modelAdapter.accepted === true, "rules_fallback mode accepted=true");
} catch (err) {
  assert(false, `rules_fallback should not throw: ${err.message}`);
}

// ─── Summary ─────────────────────────────────────────────────────────
console.log(`\n${"=".repeat(60)}`);
console.log(`Sprint 1 Verification: ${passed} passed, ${failed} failed`);
console.log(`${"=".repeat(60)}`);

if (brief) {
  console.log(`\nMission brief preview (${brief.text.length} chars, ~${summarized.estimated_tokens} tokens):`);
  console.log("─".repeat(60));
  // Print first 2000 chars
  console.log(brief.text.slice(0, 2000));
  if (brief.text.length > 2000) {
    console.log(`\n... (${brief.text.length - 2000} more chars)`);
  }
}

process.exit(failed > 0 ? 1 : 0);

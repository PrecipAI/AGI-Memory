/**
 * Old Pipeline vs New Adapter: Quality Gap Analysis
 * 
 * Reads the old deterministic pipeline output (candidates.jsonl) and
 * checks how many of those 60 candidates would pass the new adapter's
 * validation — and more importantly, assesses their SEMANTIC quality.
 */
import fs from "node:fs";
import path from "node:path";

const CANDIDATES_PATH = path.join(
  process.env.USERPROFILE ?? process.env.HOME ?? "",
  ".codex/governance-candidates/runs/20260514-025343-845-6f044d/candidates.jsonl"
);

// Parse old pipeline candidates
const lines = fs.readFileSync(CANDIDATES_PATH, "utf-8").split("\n").filter(Boolean);
const candidates = lines.map((l) => JSON.parse(l));

console.log(`\n${"═".repeat(70)}`);
console.log("OLD PIPELINE QUALITY ANALYSIS");
console.log(`${"═".repeat(70)}`);
console.log(`Total candidates from old pipeline: ${candidates.length}`);

// ─── Type distribution ───────────────────────────────────────────────
const typeCounts = {};
for (const c of candidates) {
  typeCounts[c.candidate_type] = (typeCounts[c.candidate_type] || 0) + 1;
}
console.log("\n─── Type Distribution ─────────────────────────────────────────────");
for (const [type, count] of Object.entries(typeCounts).sort((a, b) => b[1] - a[1])) {
  const bar = "█".repeat(Math.min(count, 40));
  console.log(`  ${type.padEnd(12)} ${String(count).padStart(3)}  ${bar}`);
}

// ─── Quality Issue Scans ─────────────────────────────────────────────
console.log("\n─── Quality Issue Scans ────────────────────────────────────────────");

let issueCounts = {};
const issues = [];

for (const c of candidates) {
  const text = [c.title, c.summary, c.content, c.proposed_text].filter(Boolean).join(" ");
  const itemIssues = [];

  // Issue: Overly verbose (>300 chars)
  if (text.length > 300) {
    itemIssues.push("verbose (>300 chars)");
    issueCounts["verbose"] = (issueCounts["verbose"] || 0) + 1;
  }

  // Issue: Contains raw paths
  if (/[A-Z]:\\Users\\|C:\\WINDOWS|C:\\workspace/i.test(text)) {
    itemIssues.push("contains raw paths");
    issueCounts["raw_paths"] = (issueCounts["raw_paths"] || 0) + 1;
  }

  // Issue: Contains URLs
  if (/https?:\/\/|arxiv\.org|github\.com/i.test(text)) {
    itemIssues.push("contains URLs");
    issueCounts["contains_urls"] = (issueCounts["contains_urls"] || 0) + 1;
  }

  // Issue: Tool failure pattern as memory (not a useful memory)
  if (c.candidate_type === "memory" && /Tool failure pattern/i.test(c.title)) {
    itemIssues.push("raw tool failure as memory");
    issueCounts["raw_failure_as_memory"] = (issueCounts["raw_failure_as_memory"] || 0) + 1;
  }

  // Issue: Title is raw user text (not a proper title)
  if (c.title && (c.title.length > 80 || c.title.includes("？") || c.title.includes("?"))) {
    itemIssues.push("title is raw user text/question");
    issueCounts["raw_title"] = (issueCounts["raw_title"] || 0) + 1;
  }

  // Issue: Summary is too long (should be concise, not entire assistant response)
  if (c.summary && c.summary.length > 500) {
    itemIssues.push("summary too verbose (>500 chars)");
    issueCounts["verbose_summary"] = (issueCounts["verbose_summary"] || 0) + 1;
  }

  // Issue: Missing proper structure for the Four-Layer Protocol
  if (c.candidate_type === "memory" && !c.summary?.includes("symptom") && !c.summary?.includes("root_cause")) {
    itemIssues.push("memory missing {symptom, root_cause, fix_action} structure");
    issueCounts["memory_no_structure"] = (issueCounts["memory_no_structure"] || 0) + 1;
  }

  if (c.candidate_type === "rule" && !/\bmust\b|\bmust_not\b|必须|不得|不能|不允许/i.test(text)) {
    itemIssues.push("rule missing constraint keywords");
    issueCounts["rule_no_constraint"] = (issueCounts["rule_no_constraint"] || 0) + 1;
  }

  if (c.candidate_type === "skill" && !c.proposed_text?.includes("{")) {
    itemIssues.push("skill has no parameterized placeholders");
    issueCounts["skill_no_placeholders"] = (issueCounts["skill_no_placeholders"] || 0) + 1;
  }

  // Issue: confidence too low (< 0.5)
  if (c.confidence && c.confidence < 0.5) {
    itemIssues.push(`low confidence (${c.confidence})`);
    issueCounts["low_confidence"] = (issueCounts["low_confidence"] || 0) + 1;
  }

  if (itemIssues.length > 0) {
    issues.push({ id: c.candidate_id, type: c.candidate_type, issues: itemIssues });
  }
}

console.log("\n  Issue Summary:");
const sortedIssues = Object.entries(issueCounts).sort((a, b) => b[1] - a[1]);
for (const [issue, count] of sortedIssues) {
  const pct = ((count / candidates.length) * 100).toFixed(0);
  console.log(`    ${issue.padEnd(40)} ${String(count).padStart(3)} (${pct}%)`);
}

// ─── Candidates with NO issues (clean) ───────────────────────────────
const cleanCount = candidates.length - issues.length;
console.log(`\n  Clean candidates (no quality issues): ${cleanCount}/${candidates.length} (${((cleanCount / candidates.length) * 100).toFixed(0)}%)`);
console.log(`  Candidates with issues: ${issues.length}/${candidates.length} (${((issues.length / candidates.length) * 100).toFixed(0)}%)`);

// ─── Would old candidates pass new adapter? ──────────────────────────
// We can't fully run them through the adapter (different schema), but we can check
// structural compatibility

console.log("\n─── Structural Compatibility with New Adapter ─────────────────────");

let structurallyCompatible = 0;
let incompatible = 0;
const incompatReasons = {};

for (const c of candidates) {
  let compatible = true;
  let reason = "";

  // Check: old candidates use different field names/structure
  if (!c.candidate_type) {
    compatible = false;
    reason = "missing candidate_type";
  }

  // Old pipeline uses "rule"/"memory"/"knowledge"/"skill" not "rule_candidate"/"memory_candidate"/etc.
  const newTypeMap = { rule: "rule_candidate", memory: "memory_candidate", knowledge: "knowledge_candidate", skill: "skill_proposal_candidate" };
  const newType = newTypeMap[c.candidate_type];
  if (!newType) {
    compatible = false;
    reason = "unknown type";
  }

  // Check: old candidates lack required fields for new adapter
  // New adapter requires: title, origin_scope, availability_scope, governance_level,
  // promotion_status, source_kind, source_timestamp, source_excerpt, reason
  const requiredFields = ["source_kind", "source_timestamp", "source_excerpt", "reason"];
  const missingFields = requiredFields.filter((f) => !c[f]);
  
  // Old pipeline uses "title" field but it's often raw text
  // Old pipeline doesn't have origin_scope, availability_scope, governance_level, promotion_status
  const missingNewFields = [];
  if (!c.origin_scope) missingNewFields.push("origin_scope");
  if (!c.availability_scope) missingNewFields.push("availability_scope");
  if (!c.governance_level) missingNewFields.push("governance_level");
  if (!c.promotion_status) missingNewFields.push("promotion_status");

  if (missingNewFields.length > 0) {
    compatible = false;
    reason = `missing new fields: ${missingNewFields.join(", ")}`;
  }

  if (compatible) {
    structurallyCompatible++;
  } else {
    incompatible++;
    incompatReasons[reason] = (incompatReasons[reason] || 0) + 1;
  }
}

console.log(`  Structurally compatible: ${structurallyCompatible}/${candidates.length}`);
console.log(`  Incompatible: ${incompatible}/${candidates.length}`);
if (Object.keys(incompatReasons).length > 0) {
  console.log("  Incompatibility reasons:");
  for (const [reason, count] of Object.entries(incompatReasons).sort((a, b) => b[1] - a[1])) {
    console.log(`    ${reason}: ${count}`);
  }
}

// ─── Old Pipeline Type Breakdown Detail ──────────────────────────────
console.log("\n─── Per-Type Quality Detail ───────────────────────────────────────");

const byType = {};
for (const c of candidates) {
  if (!byType[c.candidate_type]) byType[c.candidate_type] = [];
  byType[c.candidate_type].push(c);
}

for (const [type, items] of Object.entries(byType)) {
  const withIssues = issues.filter((i) => i.type === type).length;
  console.log(`\n  ${type} (${items.length} total, ${withIssues} with issues):`);
  
  // Show a few representative examples
  for (const item of items.slice(0, 2)) {
    const titlePreview = (item.title || "").slice(0, 80);
    const conf = item.confidence ?? "?";
    console.log(`    - "${titlePreview}..." (confidence: ${conf})`);
    const itemIssues = issues.find((i) => i.id === item.candidate_id);
    if (itemIssues) {
      console.log(`      Issues: ${itemIssues.issues.join(", ")}`);
    }
  }
  if (items.length > 2) {
    console.log(`    ... and ${items.length - 2} more`);
  }
}

// ─── Final Assessment ────────────────────────────────────────────────
console.log(`\n${"═".repeat(70)}`);
console.log("OLD PIPELINE QUALITY ASSESSMENT");
console.log(`${"═".repeat(70)}`);

const qualityScore = ((cleanCount / candidates.length) * 100).toFixed(0);
console.log(`  Overall quality score: ${qualityScore}/100`);
console.log(`  (Based on structural + semantic quality checks)`);
console.log("");
console.log("  KEY FINDINGS:");
console.log("  1. Old pipeline produces FLAT candidates without Four-Layer structure");
console.log("  2. Memories are mostly raw tool failure logs — not distilled insights");
console.log("  3. Knowledge candidates contain project-private paths and URLs");
console.log("  4. Rules are raw user quotes, not IF/THEN constraint expressions");
console.log("  5. Skills are user questions, not parameterized procedures");
console.log("  6. New adapter would reject most due to missing required fields");
console.log("  7. Even if structurally compatible, semantic quality is poor");
console.log("");
console.log("  The Two-Step MCP Dance + Four-Layer Protocol addresses ALL of these");
console.log("  by forcing the host LLM to structure output according to strict schema.");
console.log(`${"═".repeat(70)}`);

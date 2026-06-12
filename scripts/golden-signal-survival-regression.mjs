/**
 * Golden-50 + Broken-Stress-12 Signal Survival Regression
 *
 * For each golden case:
 *   1. Construct a mock CodexCapturePreviewResponse with the input as user_message
 *   2. Run summarizeSession → buildMissionBrief
 *   3. Extract "survival keywords" from the input
 *   4. Check what fraction of keywords survive in the mission brief
 *
 * Output: per-case pass/fail + aggregate survival rate + diagnostic for failures
 */
import { readFileSync } from "node:fs";
import { summarizeSession } from "../services/memory-service/dist/services/memory-service/src/sessionSummarizer.js";
import { buildMissionBrief } from "../services/memory-service/dist/services/memory-service/src/governancePromptBuilder.js";

// ─── Helpers ───────────────────────────────────────────────────────────

const STOP_WORDS = new Set([
  "的", "了", "是", "在", "我", "有", "和", "就", "不", "人", "都", "一",
  "一个", "上", "也", "很", "到", "说", "要", "去", "你", "会", "着",
  "没有", "看", "好", "自己", "这", "他", "她", "它", "们", "那", "被",
  "从", "把", "又", "对", "还", "吗", "吧", "呢", "啊", "哦", "嗯",
  "可以", "什么", "怎么", "为什么", "这个", "那个", "因为", "所以",
  "但是", "如果", "虽然", "而且", "或者", "以及", "不过", "只是",
  "已经", "之前", "之后", "应该", "需要", "可能", "比较", "一些",
  "不是", "没有", "不要", "不能", "不会",
  "the", "a", "an", "is", "are", "was", "were", "be", "been",
  "has", "have", "had", "do", "does", "did", "will", "would",
  "could", "should", "may", "might", "can", "shall", "to", "of",
  "in", "for", "on", "with", "at", "by", "from", "as", "into",
  "and", "or", "but", "if", "not", "no", "so", "yet", "it",
  "this", "that", "these", "those", "we", "us", "our", "you",
]);

/**
 * Extract meaningful keyword phrases from text.
 * Strategy: split on punctuation/spaces, keep segments >= 2 chars,
 * filter out pure stop words, return unique phrases.
 */
function extractKeywords(text) {
  // Split on common delimiters while keeping Chinese phrases intact
  const raw = text
    .split(/[，,。！？；：、\s]+/)
    .map(s => s.trim())
    .filter(s => s.length >= 2);

  const keywords = new Set();
  for (const phrase of raw) {
    // Skip if it's purely a stop word
    if (STOP_WORDS.has(phrase)) continue;
    keywords.add(phrase);

    // Also extract sub-phrases for Chinese text (sliding window of 2-4 chars)
    if (/[\u4e00-\u9fff]/.test(phrase) && phrase.length > 4) {
      for (let len = 3; len <= Math.min(phrase.length, 6); len++) {
        for (let i = 0; i <= phrase.length - len; i++) {
          const sub = phrase.slice(i, i + len);
          if (!STOP_WORDS.has(sub)) {
            keywords.add(sub);
          }
        }
      }
    }
  }
  return [...keywords];
}

/**
 * Build a mock CodexCapturePreviewResponse from a golden case input.
 */
function buildMockCapture(input, caseId) {
  const ts = "2026-06-12T10:00:00.000Z";
  return {
    host: "codex",
    codex_home: "/mock/codex",
    host_home: "/mock/home",
    thread_id: `test-${caseId}`,
    thread_name: `Test: ${caseId}`,
    session_file: "/mock/session.jsonl",
    updated_at: ts,
    totals: {
      raw_event_count: 1,
      message_count: 1,
      user_message_count: 1,
      assistant_message_count: 0,
      commentary_count: 0,
      command_event_count: 0,
      tool_call_count: 0,
      mcp_call_count: 0,
    },
    governance_preview: {
      user_messages: [{ timestamp: ts, role: "user", text: input }],
      corrections: [],
      preferences: [],
      decisions: [],
      commands: [],
      tool_calls: [],
      mcp_calls: [],
      workspace_paths: [],
      readiness: {
        has_user_intent: true,
        has_execution_trace: false,
        has_tool_trace: false,
        has_corrections: false,
        quality: "medium",
        warnings: [],
      },
    },
  };
}

/**
 * Check keyword survival: returns { survived, total, rate, missing[] }
 */
function checkSurvival(keywords, briefText) {
  const normalizedBrief = briefText.toLowerCase();
  const results = keywords.map(kw => {
    const found = normalizedBrief.includes(kw.toLowerCase());
    return { keyword: kw, found };
  });
  const survived = results.filter(r => r.found).length;
  return {
    survived,
    total: keywords.length,
    rate: keywords.length > 0 ? survived / keywords.length : 1,
    missing: results.filter(r => !r.found).map(r => r.keyword),
  };
}

// ─── Main ──────────────────────────────────────────────────────────────

const datasets = [
  { name: "golden-50", file: "tests/governance-quality/golden-50.v1.json" },
  { name: "broken-stress-12", file: "tests/governance-quality/broken-stress-12.v1.json" },
];

let totalCases = 0;
let totalPassed = 0;
let totalFailed = 0;
let totalSkipped = 0;
const SURVIVAL_THRESHOLD = 0.4; // at least 40% of keywords must survive
const allResults = [];

for (const ds of datasets) {
  console.log(`\n${"═".repeat(70)}`);
  console.log(`Dataset: ${ds.name}`);
  console.log(`${"═".repeat(70)}`);

  const data = JSON.parse(readFileSync(ds.file, "utf-8"));

  for (const testCase of data.cases) {
    totalCases++;
    const { id, category, input, expected } = testCase;

    // Skip "discard" cases — these SHOULD be dropped by the pipeline
    if (expected.layer === "discard") {
      totalSkipped++;
      console.log(`  ⊘ ${id} [${category}] → SKIP (expected discard)`);
      allResults.push({ id, category, status: "skipped", reason: "expected discard" });
      continue;
    }

    // Build mock capture and run pipeline
    const capture = buildMockCapture(input, id);
    let brief;
    try {
      const summarized = summarizeSession(capture, 8000);
      brief = buildMissionBrief(summarized);
    } catch (err) {
      totalFailed++;
      console.log(`  ✗ ${id} [${category}] → PIPELINE ERROR: ${err.message}`);
      allResults.push({ id, category, status: "error", error: err.message });
      continue;
    }

    // Extract keywords from input and check survival
    const keywords = extractKeywords(input);
    const survival = checkSurvival(keywords, brief.text);

    // Also check: is the input text present at all?
    const inputPresent = brief.text.includes(input.slice(0, Math.min(input.length, 30)));

    const passed = survival.rate >= SURVIVAL_THRESHOLD;

    if (passed) {
      totalPassed++;
      console.log(
        `  ✓ ${id} [${category}] → survival ${(survival.rate * 100).toFixed(0)}% ` +
        `(${survival.survived}/${survival.total}) | input_present=${inputPresent}`
      );
    } else {
      totalFailed++;
      console.log(
        `  ✗ ${id} [${category}] → survival ${(survival.rate * 100).toFixed(0)}% ` +
        `(${survival.survived}/${survival.total}) | input_present=${inputPresent}`
      );
      console.log(`      Input: "${input.slice(0, 80)}${input.length > 80 ? "..." : ""}"`);
      console.log(`      Missing: ${survival.missing.slice(0, 5).join(", ")}`);
    }

    allResults.push({
      id,
      category,
      status: passed ? "pass" : "fail",
      survivalRate: survival.rate,
      survived: survival.survived,
      total: survival.total,
      missing: survival.missing.slice(0, 5),
      inputPresent,
      inputLength: input.length,
    });
  }
}

// ─── Summary ───────────────────────────────────────────────────────────

console.log(`\n${"═".repeat(70)}`);
console.log("SUMMARY");
console.log(`${"═".repeat(70)}`);
console.log(`Total cases:   ${totalCases}`);
console.log(`Passed:        ${totalPassed} (${((totalPassed / (totalCases - totalSkipped)) * 100).toFixed(1)}%)`);
console.log(`Failed:        ${totalFailed}`);
console.log(`Skipped:       ${totalSkipped} (discard cases)`);
console.log(`Threshold:     ${(SURVIVAL_THRESHOLD * 100).toFixed(0)}% keyword survival`);

// Per-category breakdown
const categories = {};
for (const r of allResults) {
  if (r.status === "skipped") continue;
  if (!categories[r.category]) categories[r.category] = { pass: 0, fail: 0, total: 0, avgRate: 0 };
  categories[r.category].total++;
  if (r.status === "pass") categories[r.category].pass++;
  else categories[r.category].fail++;
  categories[r.category].avgRate += (r.survivalRate ?? 0);
}

console.log(`\nPer-category breakdown:`);
for (const [cat, stats] of Object.entries(categories).sort((a, b) => a[0].localeCompare(b[0]))) {
  const avg = ((stats.avgRate / stats.total) * 100).toFixed(0);
  console.log(`  ${cat.padEnd(22)} ${stats.pass}/${stats.total} passed (avg survival: ${avg}%)`);
}

// Show the worst failures
const failures = allResults.filter(r => r.status === "fail").sort((a, b) => (a.survivalRate ?? 0) - (b.survivalRate ?? 0));
if (failures.length > 0) {
  console.log(`\nWorst failures (bottom 5):`);
  for (const f of failures.slice(0, 5)) {
    console.log(`  ${f.id}: ${(f.survivalRate * 100).toFixed(0)}% survival, missing: ${f.missing.join(", ")}`);
  }
}

console.log(`\n${"═".repeat(70)}`);
const exitCode = totalFailed > 0 ? 1 : 0;
process.exit(exitCode);

/**
 * Live Observation: Real Codex Session
 * 
 * Bypasses HTTP layer, calls previewCodexHostCapture → summarizeSession → buildMissionBrief
 * directly on the user's real Codex data.
 * 
 * Target: thread 019e76f2 (AI 网关与压缩方案, 27K lines, 291MB)
 */
import path from "node:path";
import { previewCodexHostCapture } from "../services/memory-service/dist/services/memory-service/src/codexHostCapture.js";
import { summarizeSession } from "../services/memory-service/dist/services/memory-service/src/sessionSummarizer.js";
import { buildMissionBrief } from "../services/memory-service/dist/services/memory-service/src/governancePromptBuilder.js";

const CODEX_HOME = path.join(process.env.USERPROFILE ?? process.env.HOME ?? "", ".codex");
const THREAD_ID = "019e76f2-7e26-7a81-8d08-d63d5d21a97e";
const TOKEN_BUDGET = 8000;

console.log(`\n╔══════════════════════════════════════════════════════════╗`);
console.log(`║  LIVE OBSERVATION: Real Codex Session                   ║`);
console.log(`╠══════════════════════════════════════════════════════════╣`);
console.log(`║  Codex home: ${CODEX_HOME.padEnd(43)} ║`);
console.log(`║  Thread: ${THREAD_ID.padEnd(45)} ║`);
console.log(`║  Token budget: ${String(TOKEN_BUDGET).padEnd(41)} ║`);
console.log(`╚══════════════════════════════════════════════════════════╝`);

// ─── Step 1: Raw capture ───────────────────────────────────────────────

console.log("\n[1/5] Running previewCodexHostCapture on real 291MB session...");
const t0 = Date.now();

let capture;
try {
  capture = await previewCodexHostCapture({
    codex_home: CODEX_HOME,
    thread_id: THREAD_ID,
    max_items: 500,
  });
} catch (err) {
  console.error(`  ✗ Capture failed: ${err.message}`);
  process.exit(1);
}

const captureTime = ((Date.now() - t0) / 1000).toFixed(1);
const gp = capture.governance_preview;

console.log(`  ✓ Capture complete (${captureTime}s)`);
console.log(`    Raw events: ${capture.totals.raw_event_count}`);
console.log(`    User messages: ${gp.user_messages.length}`);
console.log(`    Corrections: ${gp.corrections.length}`);
console.log(`    Preferences: ${gp.preferences.length}`);
console.log(`    Decisions: ${gp.decisions.length}`);
console.log(`    Commands: ${gp.commands.length} (success: ${gp.commands.filter(c => c.status === "success").length}, failure: ${gp.commands.filter(c => c.status === "failure").length})`);
console.log(`    Tool calls: ${gp.tool_calls.length}`);
console.log(`    MCP calls: ${gp.mcp_calls.length}`);
console.log(`    Workspace paths: ${gp.workspace_paths.length}`);

// ─── Step 2: Summarize ─────────────────────────────────────────────────

console.log("\n[2/5] Running summarizeSession (signal scoring + compression)...");
const t1 = Date.now();

let summarized;
try {
  summarized = summarizeSession(capture, TOKEN_BUDGET);
} catch (err) {
  console.error(`  ✗ Summarize failed: ${err.message}`);
  process.exit(1);
}

const summarizeTime = ((Date.now() - t1) / 1000).toFixed(1);
console.log(`  ✓ Summarize complete (${summarizeTime}s)`);
console.log(`    Retained events: ${summarized.retained_event_count} / ${summarized.raw_event_count}`);
console.log(`    Compression ratio: ${(summarized.compression_ratio * 100).toFixed(1)}%`);
console.log(`    Estimated tokens: ${summarized.estimated_tokens} / ${TOKEN_BUDGET}`);
console.log(`    Budget utilization: ${((summarized.estimated_tokens / TOKEN_BUDGET) * 100).toFixed(1)}%`);
console.log(`    Signal breakdown:`);
console.log(`      User directives: ${summarized.signal_stats.user_directives}`);
console.log(`      Failure events:  ${summarized.signal_stats.failure_events}`);
console.log(`      Breakthroughs:   ${summarized.signal_stats.breakthrough_events}`);
console.log(`      Success meta:    ${summarized.signal_stats.success_metadata}`);

// ─── Step 3: Build mission brief ───────────────────────────────────────

console.log("\n[3/5] Building mission brief...");
const brief = buildMissionBrief(summarized);

console.log(`  ✓ Mission brief: ${brief.text.length} chars (~${Math.ceil(brief.text.length / 3.5)} tokens)`);
console.log(`    governance_mode: ${brief.governance_mode}`);

// ─── Step 4: Analyze signal density ────────────────────────────────────

console.log("\n[4/5] Analyzing mission brief composition...");

const lines = brief.text.split("\n");
const contentLines = lines.filter(l => l.trim().length > 0);

// Section analysis
const sections = {};
let currentSection = "header";
let sectionLines = 0;
for (const line of lines) {
  if (line.startsWith("### ")) {
    sections[currentSection] = sectionLines;
    currentSection = line.replace("### ", "").split(" (")[0].trim();
    sectionLines = 0;
  } else if (line.startsWith("## ") && !line.startsWith("## ⚡")) {
    sections[currentSection] = sectionLines;
    currentSection = line.replace("## ", "").trim();
    sectionLines = 0;
  } else if (line.trim().length > 0) {
    sectionLines++;
  }
}
sections[currentSection] = sectionLines;

console.log(`  Section breakdown:`);
for (const [name, count] of Object.entries(sections)) {
  if (count > 0) {
    const bar = "█".repeat(Math.min(count, 40));
    console.log(`    ${name.padEnd(38)} ${String(count).padStart(4)} lines  ${bar}`);
  }
}

// Signal type counts in the brief
const ruleTagged = (brief.text.match(/\[RULE\]/g) || []).length;
const prefTagged = (brief.text.match(/\[PREFERENCE\]/g) || []).length;
const corrTagged = (brief.text.match(/\[CORRECTION\]/g) || []).length;
const ctxTagged = (brief.text.match(/\[CONTEXT\]/g) || []).length;
const failTagged = (brief.text.match(/FAIL/g) || []).length;
const decisionTagged = (brief.text.match(/\[DECISION\]/g) || []).length;
const breakthroughTagged = (brief.text.match(/\[BREAKTHROUGH\]/g) || []).length;

console.log(`\n  Signal tags in brief:`);
console.log(`    [RULE]:          ${ruleTagged}`);
console.log(`    [PREFERENCE]:    ${prefTagged}`);
console.log(`    [CORRECTION]:    ${corrTagged}`);
console.log(`    [DECISION]:      ${decisionTagged}`);
console.log(`    [BREAKTHROUGH]:  ${breakthroughTagged}`);
console.log(`    [CONTEXT]:       ${ctxTagged}`);
console.log(`    FAIL events:     ${failTagged}`);

// High-value vs low-value line counts
const highValueLines = lines.filter(l => /\[RULE\]|\[PREFERENCE\]|\[CORRECTION\]|\[BREAKTHROUGH\]|FAIL/.test(l)).length;
const lowValueLines = lines.filter(l => /\[CMD OK\]|\[TOOL OK\]|\[MCP OK\]/.test(l)).length;
const protocolLines = lines.filter(l => /Four-Layer|host_model_result|REQUIRED NEXT ACTION|Quality Gate/.test(l)).length;

console.log(`\n  Value composition:`);
console.log(`    High-value signals: ${highValueLines} lines`);
console.log(`    Low-value metadata: ${lowValueLines} lines`);
console.log(`    Protocol overhead:  ${protocolLines} lines`);
const signalPct = contentLines.length > 0 ? ((highValueLines / contentLines.length) * 100).toFixed(1) : "0";
console.log(`    Signal density:     ${signalPct}%`);

// ─── Step 5: Suspicious noise scan ────────────────────────────────────

console.log("\n[5/5] Scanning for suspicious high-score noise...");

const SUSPICIOUS_PATTERNS = [
  { pattern: /\[RULE\].*(?:Error|error|ENOENT|EADDRINUSE|TypeError|SyntaxError|timeout|refused)/gi, label: "Error messages tagged as [RULE]" },
  { pattern: /\[PREFERENCE\].*(?:npm|node|docker|git|tsc|exit=|ERR!)/gi, label: "Tool output tagged as [PREFERENCE]" },
  { pattern: /\[CORRECTION\].*(?:stack trace|at Object|node:internal)/gi, label: "Stack traces tagged as [CORRECTION]" },
  { pattern: /\[RULE\].*(?:localhost|127\.0\.0\.1|0\.0\.0\.0)/gi, label: "Localhost refs tagged as [RULE]" },
];

let suspiciousCount = 0;
for (const { pattern, label } of SUSPICIOUS_PATTERNS) {
  const matches = brief.text.match(pattern);
  if (matches && matches.length > 0) {
    suspiciousCount += matches.length;
    console.log(`  ⚠ ${label}: ${matches.length} instances`);
    for (const m of matches.slice(0, 3)) {
      console.log(`    "${m.slice(0, 100)}..."`);
    }
  }
}

if (suspiciousCount === 0) {
  console.log(`  ✓ No suspicious high-score noise detected`);
} else {
  console.log(`\n  Total suspicious: ${suspiciousCount} / ${contentLines.length} content lines (${((suspiciousCount / contentLines.length) * 100).toFixed(1)}%)`);
}

// Ephemeral stripping check
const pathLeaks = (brief.text.match(/[A-Z]:\\Users\\[a-zA-Z_-]+\\[^\s"'})\]]{10,}/g) || []);
const ipLeaks = (brief.text.match(/\b\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}(?::\d+)?\b/g) || []);
const uuidLeaks = (brief.text.match(/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi) || []);
const secretLeaks = (brief.text.match(/sk[-_][a-zA-Z0-9]{16,}/gi) || []);

const totalLeaks = pathLeaks.length + ipLeaks.length + uuidLeaks.length + secretLeaks.length;

console.log(`\n  Ephemeral leaks:`);
if (pathLeaks.length > 0) console.log(`    User paths: ${pathLeaks.length}`);
if (ipLeaks.length > 0) console.log(`    IP addresses: ${ipLeaks.length}`);
if (uuidLeaks.length > 0) console.log(`    UUIDs: ${uuidLeaks.length}`);
if (secretLeaks.length > 0) console.log(`    API keys: ${secretLeaks.length}`);
if (totalLeaks === 0) console.log(`    ✓ No leaks`);

// Placeholder usage
const placeholders = {};
for (const ph of ["[USER_PATH]", "[IP]", "[UUID]", "[SECRET_KEY]", "[TIMESTAMP]", "[PID]", "[PORT]"]) {
  const count = (brief.text.match(new RegExp(ph.replace(/[[\]]/g, "\\$&"), "g")) || []).length;
  if (count > 0) placeholders[ph] = count;
}
if (Object.keys(placeholders).length > 0) {
  console.log(`  Placeholders in use: ${Object.entries(placeholders).map(([k, v]) => `${k}=${v}`).join(", ")}`);
}

// ─── Final Report ──────────────────────────────────────────────────────

console.log(`\n${"═".repeat(60)}`);
console.log("LIVE OBSERVATION REPORT — Real Codex Session");
console.log(`Thread: "总结 AI 网关与压缩方案" (27K events, 291MB)`);
console.log(`${"═".repeat(60)}`);

const tokenEst = Math.ceil(brief.text.length / 3.5);
const budgetPct = ((tokenEst / TOKEN_BUDGET) * 100).toFixed(1);
const signalHealth = parseFloat(signalPct) > 40 ? "HEALTHY" : parseFloat(signalPct) > 20 ? "ACCEPTABLE" : "CONCERNING";
const noiseHealth = suspiciousCount === 0 ? "CLEAN" : suspiciousCount < 5 ? "MILD" : "CONTAMINATED";
const leakHealth = totalLeaks === 0 ? "SEALED" : `LEAKING (${totalLeaks})`;

console.log(`  Token usage:      ${tokenEst} / ${TOKEN_BUDGET} (${budgetPct}%)`);
console.log(`  Compression:      ${summarized.raw_event_count} → ${summarized.retained_event_count} events (${(summarized.compression_ratio * 100).toFixed(1)}%)`);
console.log(`  Signal quality:   ${signalHealth} (${signalPct}% high-value)`);
console.log(`  Noise level:      ${noiseHealth} (${suspiciousCount} suspicious)`);
console.log(`  Ephemeral seal:   ${leakHealth}`);
console.log(`  Protocol embed:   ${brief.text.includes("Four-Layer") ? "PRESENT" : "MISSING"}`);

const overall = (
  (parseFloat(signalPct) > 30 ? 30 : parseFloat(signalPct)) +
  (suspiciousCount === 0 ? 25 : Math.max(0, 25 - suspiciousCount * 3)) +
  (totalLeaks === 0 ? 25 : Math.max(0, 25 - totalLeaks * 3)) +
  (brief.text.includes("Four-Layer") ? 20 : 0)
).toFixed(0);

console.log(`\n  OVERALL SCORE:    ${overall}/100`);
console.log(`${"═".repeat(60)}`);

// Print first 3000 chars of actual mission brief
console.log(`\n─── MISSION BRIEF (first 3000 chars) ───────────────────────`);
console.log(brief.text.slice(0, 3000));
if (brief.text.length > 3000) {
  console.log(`\n... (${brief.text.length - 3000} more chars, total ${brief.text.length} chars)`);
}

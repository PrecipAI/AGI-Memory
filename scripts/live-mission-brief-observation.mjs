/**
 * Live Mission Brief Observation Script
 *
 * Connects to a running memory service and captures the actual mission_brief
 * from a real Codex session. Performs automated analysis:
 *
 *   1. Token usage vs budget
 *   2. Signal density (high-score vs low-score event ratio)
 *   3. Suspicious high-score noise detection
 *   4. Ephemeral stripping effectiveness
 *   5. Four-Layer Protocol embedding check
 *
 * Usage:
 *   node scripts/live-mission-brief-observation.mjs [--port 3000] [--codex-home ~/.codex] [--thread-id <uuid>]
 */

// ─── CLI args ──────────────────────────────────────────────────────────

const args = process.argv.slice(2);
function getArg(name, defaultValue) {
  const idx = args.indexOf(`--${name}`);
  if (idx >= 0 && args[idx + 1]) return args[idx + 1];
  return defaultValue;
}

const PORT = getArg("port", "3000");
const CODEX_HOME = getArg("codex-home", null);
const THREAD_ID = getArg("thread-id", null);
const SERVICE_URL = `http://127.0.0.1:${PORT}`;

console.log(`\n╔══════════════════════════════════════════════════════════╗`);
console.log(`║  AGI-Memory Live Mission Brief Observation             ║`);
console.log(`╠══════════════════════════════════════════════════════════╣`);
console.log(`║  Service: ${SERVICE_URL.padEnd(44)} ║`);
console.log(`║  Codex home: ${(CODEX_HOME ?? "auto-detect").padEnd(43)} ║`);
console.log(`║  Thread: ${(THREAD_ID ?? "latest").padEnd(45)} ║`);
console.log(`╚══════════════════════════════════════════════════════════╝`);

// ─── Step 1: Call preview endpoint ─────────────────────────────────────

console.log("\n[1/5] Calling governance-batch-preview endpoint...");

let response;
try {
  response = await fetch(`${SERVICE_URL}/internal/host-capture/codex/governance-batch-preview`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      codex_home: CODEX_HOME,
      thread_id: THREAD_ID,
      max_items: 200,
    }),
  });
} catch (err) {
  console.error(`  ✗ Cannot reach memory service at ${SERVICE_URL}`);
  console.error(`    ${err.message}`);
  console.error(`\n  Fix: Start the memory service first:`);
  console.error(`    cd services/memory-service && npm start`);
  process.exit(1);
}

if (!response.ok) {
  const errorBody = await response.text();
  console.error(`  ✗ HTTP ${response.status}: ${errorBody.slice(0, 200)}`);
  process.exit(1);
}

const result = await response.json();
console.log(`  ✓ Response received (${JSON.stringify(result).length} bytes)`);

// ─── Step 2: Extract mission brief ─────────────────────────────────────

console.log("\n[2/5] Extracting mission brief...");

const missionBrief = result.mission_brief;
if (!missionBrief) {
  console.error("  ✗ No mission_brief in response. Sprint 1 pipeline not wired?");
  console.error("    Response keys:", Object.keys(result).join(", "));
  process.exit(1);
}

console.log(`  ✓ Mission brief found`);
console.log(`    governance_mode: ${missionBrief.governance_mode}`);
console.log(`    text length: ${missionBrief.text.length} chars`);
console.log(`    estimated tokens: ~${Math.ceil(missionBrief.text.length / 3.5)}`);

// ─── Step 3: Analyze signal density ────────────────────────────────────

console.log("\n[3/5] Analyzing signal density...");

const briefText = missionBrief.text;
const lines = briefText.split("\n");

// Count section sizes
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
  } else {
    sectionLines++;
  }
}
sections[currentSection] = sectionLines;

console.log(`  Section breakdown:`);
for (const [name, count] of Object.entries(sections)) {
  if (count > 0) {
    const bar = "█".repeat(Math.min(count, 40));
    console.log(`    ${name.padEnd(35)} ${String(count).padStart(4)} lines  ${bar}`);
  }
}

// Count signal-bearing vs noise lines
const userDirectiveLines = lines.filter(l => l.startsWith("- [") && l.includes("[RULE]") || l.includes("[PREFERENCE]") || l.includes("[CORRECTION]")).length;
const failureLines = lines.filter(l => l.includes("FAIL") || l.includes("exit=")).length;
const successMetaLines = lines.filter(l => l.includes("[CMD OK]") || l.includes("[TOOL OK]") || l.includes("[MCP OK]")).length;
const protocolLines = lines.filter(l => l.includes("Four-Layer") || l.includes("host_model_result") || l.includes("REQUIRED NEXT ACTION")).length;
const totalContentLines = lines.filter(l => l.trim().length > 0).length;

const signalLines = userDirectiveLines + failureLines;
const noiseLines = successMetaLines;
const overheadLines = protocolLines + (totalContentLines - signalLines - noiseLines - protocolLines);

console.log(`\n  Signal composition:`);
console.log(`    User directives/rules:     ${userDirectiveLines} lines (HIGH extraction value)`);
console.log(`    Failure events:           ${failureLines} lines (MEDIUM extraction value)`);
console.log(`    Success metadata:         ${noiseLines} lines (LOW extraction value)`);
console.log(`    Protocol/schema overhead:  ${protocolLines} lines (instruction to host LLM)`);
console.log(`    Other:                    ${overheadLines} lines`);

const signalPct = totalContentLines > 0 ? ((signalLines / totalContentLines) * 100).toFixed(1) : "0";
const noisePct = totalContentLines > 0 ? ((noiseLines / totalContentLines) * 100).toFixed(1) : "0";
console.log(`\n  Signal-to-noise: ${signalPct}% high-value / ${noisePct}% low-value`);

// ─── Step 4: Check for suspicious high-score noise ────────────────────

console.log("\n[4/5] Scanning for suspicious high-score noise...");

// Look for patterns that might fool the scoring system
const SUSPICIOUS_PATTERNS = [
  { pattern: /\[RULE\].*(?:Error|error|fail|FAIL|timeout)/g, label: "Error logs tagged as [RULE]" },
  { pattern: /\[PREFERENCE\].*(?:npm|node|docker|git|tsc)/gi, label: "Tool output tagged as [PREFERENCE]" },
  { pattern: /\[CORRECTION\].*(?:ENOENT|EADDRINUSE|TypeError|SyntaxError)/gi, label: "Stack traces tagged as [CORRECTION]" },
];

let suspiciousCount = 0;
for (const { pattern, label } of SUSPICIOUS_PATTERNS) {
  const matches = briefText.match(pattern);
  if (matches && matches.length > 0) {
    suspiciousCount += matches.length;
    console.log(`  ⚠ ${label}: ${matches.length} instances`);
    for (const m of matches.slice(0, 2)) {
      console.log(`    "${m.slice(0, 80)}..."`);
    }
  }
}

if (suspiciousCount === 0) {
  console.log(`  ✓ No suspicious high-score noise detected`);
} else {
  console.log(`\n  Total suspicious lines: ${suspiciousCount} / ${totalContentLines} (${((suspiciousCount / totalContentLines) * 100).toFixed(1)}%)`);
  console.log(`  ⚠ These may crowd out genuine signals in budget-constrained scenarios`);
}

// ─── Step 5: Ephemeral stripping check ─────────────────────────────────

console.log("\n[5/5] Checking ephemeral value stripping...");

const EPHEMERAL_CHECKS = [
  { regex: /[A-Z]:\\Users\\[a-zA-Z_-]+\\[^\s"'})\]]{5,}/g, label: "Raw user paths", placeholder: "[USER_PATH]" },
  { regex: /\b\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}(?::\d+)?\b/g, label: "Raw IP addresses", placeholder: "[IP]" },
  { regex: /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi, label: "Raw UUIDs", placeholder: "[UUID]" },
  { regex: /sk[-_][a-zA-Z0-9]{16,}/gi, label: "Raw API keys", placeholder: "[SECRET_KEY]" },
  { regex: /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z/g, label: "Raw ISO timestamps", placeholder: "[TIMESTAMP]" },
];

let ephemeralLeaked = 0;
for (const { regex, label, placeholder } of EPHEMERAL_CHECKS) {
  const matches = briefText.match(regex);
  if (matches && matches.length > 0) {
    ephemeralLeaked += matches.length;
    console.log(`  ⚠ ${label}: ${matches.length} leaked (should be ${placeholder})`);
    for (const m of matches.slice(0, 2)) {
      console.log(`    "${m}"`);
    }
  }
}

// Check that placeholders are being used
const placeholderCounts = {};
for (const ph of ["[USER_PATH]", "[IP]", "[UUID]", "[SECRET_KEY]", "[TIMESTAMP]", "[PID]", "[PORT]"]) {
  const count = (briefText.match(new RegExp(ph.replace(/[[\]]/g, "\\$&"), "g")) || []).length;
  if (count > 0) placeholderCounts[ph] = count;
}

if (Object.keys(placeholderCounts).length > 0) {
  console.log(`  Placeholders in use:`);
  for (const [ph, count] of Object.entries(placeholderCounts)) {
    console.log(`    ${ph}: ${count} occurrences`);
  }
}

if (ephemeralLeaked === 0) {
  console.log(`  ✓ No ephemeral value leaks detected`);
}

// ─── Final Report ──────────────────────────────────────────────────────

console.log(`\n${"═".repeat(60)}`);
console.log("LIVE OBSERVATION REPORT");
console.log(`${"═".repeat(60)}`);

const tokenEstimate = Math.ceil(briefText.length / 3.5);
const budgetPct = ((tokenEstimate / 8000) * 100).toFixed(1);
const signalHealth = parseFloat(signalPct) > 40 ? "HEALTHY" : parseFloat(signalPct) > 20 ? "ACCEPTABLE" : "CONCERNING";
const noiseHealth = suspiciousCount === 0 ? "CLEAN" : suspiciousCount < 5 ? "MILD" : "CONTAMINATED";
const ephemeralHealth = ephemeralLeaked === 0 ? "SEALED" : `LEAKING (${ephemeralLeaked} instances)`;

console.log(`  Token usage:      ${tokenEstimate} / 8000 (${budgetPct}%)`);
console.log(`  Signal quality:   ${signalHealth} (${signalPct}% high-value content)`);
console.log(`  Noise level:      ${noiseHealth} (${suspiciousCount} suspicious lines)`);
console.log(`  Ephemeral seal:   ${ephemeralHealth}`);
console.log(`  Protocol embed:   ${protocolLines > 0 ? "PRESENT" : "MISSING"}`);

const overallScore = (
  (parseFloat(signalPct) > 30 ? 30 : parseFloat(signalPct)) +
  (suspiciousCount === 0 ? 25 : Math.max(0, 25 - suspiciousCount * 5)) +
  (ephemeralLeaked === 0 ? 25 : Math.max(0, 25 - ephemeralLeaked * 5)) +
  (protocolLines > 0 ? 20 : 0)
).toFixed(0);

console.log(`\n  OVERALL SCORE:    ${overallScore}/100`);
console.log(`${"═".repeat(60)}`);

if (parseFloat(overallScore) >= 70) {
  console.log(`\n  ✓ Mission brief is ready for host LLM consumption.`);
  console.log(`    The Two-Step MCP Dance Step 1 output is well-formed.`);
} else {
  console.log(`\n  ⚠ Mission brief has issues that may affect extraction quality.`);
  console.log(`    Review the flagged items above before proceeding to Step 2.`);
}

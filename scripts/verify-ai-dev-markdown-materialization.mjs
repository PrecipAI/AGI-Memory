import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

const rootDir = process.cwd();
const ingestCasesPath = path.join(rootDir, "tests", "knowledge-benchmark", "ai-dev-ingest-cases.v1.json");
const reportPath = path.join(rootDir, "tests", "knowledge-benchmark", "ai-dev-materialize-report.json");
const failuresPath = path.join(rootDir, "tests", "knowledge-benchmark", "ai-dev-materialize-failures.v1.json");

function countMatches(input, pattern) {
  return (String(input).match(pattern) ?? []).length;
}

const USELESS_MARKDOWN_LINE_PATTERNS = [
  /^#{1,6}\s*(navigation menu|folders and files|history|forks|languages|license|citation|references|contributors|community|contact information|repository files navigation)\s*$/i,
  /^(navigation menu|folders and files|history|forks|languages|license|citation|references|contributors|community|contact information|repository files navigation)$/i,
  /^(source url:\s*)?https:\/\/github\.com\/[^/\s]+\/[^/\s]+\/?$/i,
  /^source url:\s*https:\/\/github\.com\/[^/\s]+\/[^/\s]+\/?$/i,
  /^code open more actions menu$/i,
  /^name name last commit message$/i,
  /^search syntax tips/i,
  /^we read every piece of feedback/i,
  /^use saved searches to filter your results more quickly/i,
  /^to see all available qualifiers/i,
  /^you can.t perform that action at this time\.?$/i,
  /^there was an error while loading\.?$/i,
  /^no releases published$/i,
  /^apache-2\.0 license$/i,
  /^mit license$/i,
  /^install(ation)?$/i,
  /^from pypi$/i,
  /^using pip:?$/i,
  /^pull the source code from github$/i,
  /^pip install\b/i,
  /^uv pip install\b/i,
  /^git clone\b/i,
  /^brew install\b/i,
  /^npm install\b/i,
  /^pnpm install\b/i,
  /^docker (run|compose|pull)\b/i,
  /^if you find (this|our) (work|project|repository) (helpful|useful)/i,
  /^please (cite|consider cite|give us a star|star us)/i,
  /^all thanks to our contributors/i,
  /^we welcome contributions/i,
  /^welcome to join our community/i,
  /^join (our|us)/i,
  /^ask questions, showcase workflows/i,
  /^special thanks/i,
  /^特别感谢/,
  /^核心贡献者$/,
  /^致谢$/,
  /^贡献者[:：]?$/i
];

function isUselessMarkdownLine(line) {
  const visible = line.replace(/^#{1,6}\s+/, "").trim();
  if (!visible) {
    return false;
  }
  if (USELESS_MARKDOWN_LINE_PATTERNS.some((pattern) => pattern.test(visible) || pattern.test(line.trim()))) {
    return true;
  }
  if (/^[`>]*\s*(pip install|git clone|npm install|pnpm install|docker run|docker compose|curl -)/i.test(visible)) {
    return true;
  }
  if (/^[-*]\s*(star|fork|license|contributors?|community|contact|join|thanks|citation)\b/i.test(visible)) {
    return true;
  }
  return false;
}

function qualityForStrict(markdown) {
  const lines = markdown.split(/\r?\n/);
  const contentLines = lines
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .filter((line) => !/^#{1,6}\s+/.test(line))
    .filter((line) => !/^source url:/i.test(line))
    .filter((line) => !/^[-*]\s*(source|url|authors?|published|doi|arxiv):/i.test(line));
  return {
    char_count: markdown.length,
    heading_count: countMatches(markdown, /^#{1,6}\s+\S/gm),
    empty_heading_count: countMatches(markdown, /^#{1,6}\s*$/gm),
    mojibake_marker_count: countMatches(markdown, /[\u9225\u95B3\u9471\uFFFD]/g),
    nav_noise_line_count: lines.filter((line) =>
      /^(edit this page|was this page helpful|skip to main content|documentation index)$/i.test(line.trim())
    ).length,
    useless_line_count: lines.filter((line) => isUselessMarkdownLine(line)).length,
    useful_body_char_count: contentLines.join("\n").length,
    substantive_line_count: contentLines.filter((line) => line.length >= 80).length
  };
}

function qualityFor(markdown) {
  const lines = markdown.split(/\r?\n/);
  return {
    char_count: markdown.length,
    heading_count: countMatches(markdown, /^#{1,6}\s+\S/gm),
    empty_heading_count: countMatches(markdown, /^#{1,6}\s*$/gm),
    mojibake_marker_count: countMatches(markdown, /鈥|锛|绋|涓|鑱|�/g),
    nav_noise_line_count: lines.filter((line) =>
      /^(edit this page|was this page helpful|skip to main content|documentation index)$/i.test(line.trim())
    ).length
  };
}

function relevanceFor(item) {
  const matched = item.markdown_quality?.relevance_matched_signals ?? [];
  return {
    relevance_signal_count: item.markdown_quality?.relevance_signal_count ?? matched.length,
    relevance_matched_signals: matched
  };
}

const ingestCases = JSON.parse(await readFile(ingestCasesPath, "utf8"));
const report = JSON.parse(await readFile(reportPath, "utf8"));
const failures = JSON.parse(await readFile(failuresPath, "utf8"));

assert.ok(Array.isArray(ingestCases), "ingest cases must be an array");
assert.ok(ingestCases.length > 0, "expected at least one materialized source");
assert.equal(report.success, ingestCases.length, "report success count must match ingest cases");
assert.equal(report.failure, failures.items.length, "report failure count must match quarantined failures");

const qualityRows = [];
for (const item of ingestCases) {
  assert.equal(item.source_type, "markdown_file", `source_type must be markdown_file for ${item.id}`);
  assert.ok(item.file_path, `file_path missing for ${item.id}`);
  assert.ok(item.markdown_quality, `markdown_quality missing for ${item.id}`);
  const markdown = await readFile(item.file_path, "utf8");
  const quality = qualityForStrict(markdown);
  assert.ok(quality.char_count >= 120, `markdown too short for ${item.id}`);
  assert.ok(quality.heading_count >= 1, `expected headings for ${item.id}`);
  assert.equal(quality.empty_heading_count, 0, `empty headings found for ${item.id}`);
  assert.equal(quality.mojibake_marker_count, 0, `mojibake markers found for ${item.id}`);
  assert.equal(quality.nav_noise_line_count, 0, `navigation noise lines found for ${item.id}`);
  assert.equal(quality.useless_line_count, 0, `useless markdown lines found for ${item.id}`);
  assert.ok(quality.useful_body_char_count >= 900, `useful markdown body too short for ${item.id}`);
  assert.ok(quality.substantive_line_count >= 3, `too few substantive lines for ${item.id}`);
  const relevance = relevanceFor(item);
  qualityRows.push({
    id: item.id,
    file_path: item.file_path,
    governance_flags: item.governance_flags ?? [],
    ...quality,
    ...relevance
  });
}

console.log(
  JSON.stringify(
    {
      ok: true,
      materialized_count: ingestCases.length,
      quarantined_failure_count: failures.items.length,
      report_total: report.total,
      report_success: report.success,
      report_failure: report.failure,
      quality_rows: qualityRows
    },
    null,
    2
  )
);

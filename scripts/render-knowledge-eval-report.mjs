import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

const rootDir = process.cwd();
const reportJsonPath =
  process.argv[2] ??
  path.join(rootDir, "tests", "knowledge-benchmark", "reports", "ai-real-eval-report.json");
const ingestCasesPath =
  process.argv[3] ??
  path.join(rootDir, "tests", "knowledge-benchmark", "ai-real-ingest-cases.v1.json");
const retrievalCasesPath =
  process.argv[4] ??
  path.join(rootDir, "tests", "knowledge-benchmark", "ai-real-retrieval-benchmark.v1.json");
const outputPath =
  process.argv[5] ??
  path.join(rootDir, "tests", "knowledge-benchmark", "reports", "ai-real-eval-report.md");

const report = JSON.parse(await readFile(reportJsonPath, "utf8"));
const ingestCases = JSON.parse(await readFile(ingestCasesPath, "utf8"));
const retrievalCases = JSON.parse(await readFile(retrievalCasesPath, "utf8"));

const ingestById = new Map((report.ingest_results ?? []).map((item) => [item.id, item]));
const retrievalById = new Map((report.retrieval_results ?? []).map((item) => [item.id, item]));
const vectorEngines = report.summary.vector_engines ?? [];
const vectorEngineNote = vectorEngines.some((item) => String(item).startsWith("milvus:"))
  ? "- 注意：当前 vector 后端已经使用 Milvus + HTTP embedding service；如果后续出现 fallback，需要先检查 embedding service、Milvus 服务和 `MILVUS_ADDRESS`。"
  : "- 注意：当前 vector 后端仍是 fallback 或 baseline，不是最终 Milvus 正式向量召回。";
const milvusConclusion = vectorEngines.some((item) => String(item).startsWith("milvus:"))
  ? "- Milvus 口径：本轮 retrieval trace 已确认使用 Milvus + HTTP embedding service，正式向量后端链路已打通。"
  : "- Milvus 口径：代码已接 Milvus SDK 和 HTTP embedding service；如果 `vector_engine` 仍显示 fallback，说明当前环境没有可用 Milvus 或 embedding 服务。";
const unfinishedLine = vectorEngines.some((item) => String(item).startsWith("milvus:"))
  ? "- 未完成：跨来源图治理、中文审查层、图搜索召回、结构化导航召回、三路横向对比、Hit@1 优化。"
  : "- 未完成：可运行 Milvus endpoint 验证、跨来源图治理、中文审查层、图搜索召回、结构化导航召回、三路横向对比。";

const lines = [
  "# AI 知识库真实评测报告",
  "",
  `生成时间：${report.generated_at}`,
  "",
  "## 1. 本次评测口径",
  "",
  `- Benchmark：${report.benchmark_name}`,
  `- Tenant：${report.tenant_id}`,
  `- Scope：${report.scope}`,
  `- 语料数量：${report.corpus_size}`,
  `- 召回问题数量：${report.retrieval_case_count}`,
  "- 测试目标：验证真实 AI 方向资料从导入、Markdown 标准化、原文保存、section/evidence 生成，到 BM25 + vector + RRF 普通召回链路是否可运行。",
  vectorEngineNote,
  "",
  "## 2. 核心指标",
  "",
  "| 指标 | 结果 | 含义 |",
  "| --- | ---: | --- |",
  `| 导入成功率 | ${formatPercent(report.summary.ingest_success_rate)} | 真实资料能否成功进入知识库 |`,
  `| Hit@1 | ${formatPercent(report.summary.retrieve_hit_at_1)} | 第 1 条结果是否命中预期文档 |`,
  `| Hit@3 | ${formatPercent(report.summary.retrieve_hit_at_3)} | 前 3 条是否命中预期文档 |`,
  `| Hit@5 | ${formatPercent(report.summary.retrieve_hit_at_5)} | 前 5 条是否命中预期文档 |`,
  `| 必要术语通过率 | ${formatPercent(report.summary.must_have_pass_rate)} | 返回 evidence/fact 是否包含 must-have 关键词 |`,
  `| 导入 P50 | ${report.summary.ingest_p50_latency_ms} ms | 单篇导入中位延迟 |`,
  `| 导入 P95 | ${report.summary.ingest_p95_latency_ms} ms | 单篇导入高位延迟 |`,
  `| 召回 P50 | ${report.summary.retrieve_p50_latency_ms} ms | 单次召回中位延迟 |`,
  `| 召回 P95 | ${report.summary.retrieve_p95_latency_ms} ms | 单次召回高位延迟 |`,
  `| 向量引擎 | ${escapeCell((report.summary.vector_engines ?? []).join(", ") || "N/A")} | 本轮 retrieval trace 中实际使用的 vector backend |`,
  "",
  "## 3. 导入测试集与结果",
  "",
  "| ID | 主题 | 标题 | 来源类型 | 导入状态 | Section | Candidate | Fact | Converter |",
  "| --- | --- | --- | --- | ---: | ---: | ---: | ---: | --- |",
  ...ingestCases.map((item) => {
    const result = ingestById.get(item.id) ?? {};
    return toRow([
      item.id,
      item.theme,
      item.title,
      item.source_kind,
      result.status_code ?? "N/A",
      result.section_count ?? 0,
      result.candidate_count ?? 0,
      result.created_fact_count ?? 0,
      result.converter ?? "N/A"
    ]);
  }),
  "",
  "## 4. 召回测试集与结果",
  "",
  "| ID | 主题 | 意图 | Hit@1 | Hit@3 | Hit@5 | 必要术语 | 延迟 | 向量引擎 | 首条返回 |",
  "| --- | --- | --- | ---: | ---: | ---: | ---: | ---: | --- | --- |",
  ...retrievalCases.map((item) => {
    const result = retrievalById.get(item.id) ?? {};
    const firstTitle = Array.isArray(result.returned_document_titles) ? result.returned_document_titles[0] : "";
    return toRow([
      item.id,
      item.theme,
      item.intent_type,
      boolMark(result.hit_at_1),
      boolMark(result.hit_at_3),
      boolMark(result.hit_at_5),
      boolMark(result.must_have_passed),
      `${result.latency_ms ?? "N/A"} ms`,
      result.vector_engine ?? "N/A",
      firstTitle || "N/A"
    ]);
  }),
  "",
  "## 5. 失败与边界项",
  "",
  ...buildFailureLines(retrievalCases, retrievalById),
  "",
  "## 6. 边界检查",
  "",
  "| 检查项 | 结果 | 说明 |",
  "| --- | ---: | --- |",
  ...(report.boundary_checks ?? []).map((item) => {
    const detail =
      item.id === "markitdown_file_adapter"
        ? `converter=${item.markdown_converter ?? "N/A"}; markdown_ref=${item.markdown_content_ref ?? "N/A"}`
        : item.id === "duplicate_ingest_same_source_uri"
          ? `first=${item.first_document_id}; second=${item.second_document_id}`
          : `status=${item.status_code ?? "N/A"}`;
    return toRow([item.id, boolMark(item.ok), detail]);
  }),
  "",
  "## 7. Console 检查",
  "",
  "| 检查项 | 结果 | 说明 |",
  "| --- | ---: | --- |",
  toRow(["overview API", report.console_checks?.overview_status_code ?? "N/A", "Ops Console overview 接口状态"]),
  toRow(["documents API", report.console_checks?.documents_status_code ?? "N/A", "Ops Console documents 接口状态"]),
  toRow(["graph facts API", report.console_checks?.graph_facts_status_code ?? "N/A", "Ops Console graph facts 接口状态"]),
  toRow(["scope document_count", report.console_checks?.document_count ?? "N/A", "当前 single-tenant scope 的总文档数，不等于本轮 benchmark 文档数"]),
  "",
  "## 8. 当前结论",
  "",
  "- 已打通：真实资料导入、Markdown 标准化、原文入库和落盘、section/evidence 生成、MarkItDown 文件 adapter、BM25 + vector + RRF 普通召回、Ops Console smoke。",
  milvusConclusion,
  unfinishedLine,
  "- 当前普通召回可以作为第一版 baseline，但还不能宣称最终知识图谱召回已经打通。"
];

await mkdir(path.dirname(outputPath), { recursive: true });
await writeFile(outputPath, `${lines.join("\n")}\n`, "utf8");
process.stdout.write(`${outputPath}\n`);

function formatPercent(value) {
  return `${Math.round(Number(value ?? 0) * 1000) / 10}%`;
}

function boolMark(value) {
  return value ? "通过" : "未通过";
}

function toRow(values) {
  return `| ${values.map(escapeCell).join(" | ")} |`;
}

function escapeCell(value) {
  return String(value ?? "").replace(/\|/g, "\\|").replace(/\r?\n/g, " ");
}

function buildFailureLines(cases, results) {
  const failed = cases
    .map((item) => ({ item, result: results.get(item.id) }))
    .filter(({ result }) => result && (!result.hit_at_5 || !result.must_have_passed));

  if (failed.length === 0) {
    return ["- 本次没有 Hit@5 或必要术语失败项。"];
  }

  return failed.map(({ item, result }) => {
    const returned = Array.isArray(result.returned_document_titles)
      ? result.returned_document_titles.slice(0, 5).join(" / ")
      : "N/A";
    return `- ${item.id}：Hit@5=${boolMark(result.hit_at_5)}，必要术语=${boolMark(result.must_have_passed)}。预期=${item.expected_document_titles.join(" / ")}；前 5 返回=${returned}。`;
  });
}

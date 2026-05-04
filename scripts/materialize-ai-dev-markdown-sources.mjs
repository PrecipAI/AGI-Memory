import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

const rootDir = process.cwd();
const candidatesPath = path.join(rootDir, "tests", "knowledge-benchmark", "ai-dev-source-candidates.v1.json");
const ingestCasesPath = path.join(rootDir, "tests", "knowledge-benchmark", "ai-dev-ingest-cases.v1.json");
const defaultOutputRoot = process.env.KNOWLEDGE_SOURCE_ROOT || "D:\\workspace\\outputs\\knowledge-sources";
const outputRoot = process.env.AI_DEV_MARKDOWN_OUTPUT_ROOT || path.join(defaultOutputRoot, "ai-dev");
const limitArg = process.argv.find((arg) => arg.startsWith("--limit="));
const limit = limitArg ? Number(limitArg.split("=")[1]) : Number.POSITIVE_INFINITY;

function safePathPart(input) {
  return String(input).replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 90) || "source";
}

function decodeHtmlEntities(input) {
  return String(input)
    .replace(/&nbsp;/g, " ")
    .replace(/&#160;/g, " ")
    .replace(/&ZeroWidthSpace;/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, "\"")
    .replace(/&#39;/g, "'")
    .replace(/&#x27;/gi, "'")
    .replace(/&#8203;/g, "")
    .replace(/&#x200b;/gi, "");
}

function cleanBlock(input) {
  return decodeHtmlEntities(input)
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+\n/g, "\n")
    .replace(/\n\s+/g, "\n")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function extractTitle(html, fallback) {
  const ogTitle = /<meta\s+property=["']og:title["']\s+content=["']([^"']+)["']/i.exec(html)?.[1];
  const title = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1];
  return cleanBlock(ogTitle || title || fallback);
}

function htmlToMarkdown(html) {
  const bodyMatch = /<body[^>]*>([\s\S]*?)<\/body>/i.exec(html);
  const body = bodyMatch ? bodyMatch[1] : html;
  const converted = body
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
    .replace(/<svg[\s\S]*?<\/svg>/gi, " ")
    .replace(/<nav[\s\S]*?<\/nav>/gi, " ")
    .replace(/<footer[\s\S]*?<\/footer>/gi, " ")
    .replace(/<aside[\s\S]*?<\/aside>/gi, " ")
    .replace(/<h1[^>]*>([\s\S]*?)<\/h1>/gi, "\n# $1\n")
    .replace(/<h2[^>]*>([\s\S]*?)<\/h2>/gi, "\n## $1\n")
    .replace(/<h3[^>]*>([\s\S]*?)<\/h3>/gi, "\n### $1\n")
    .replace(/<h4[^>]*>([\s\S]*?)<\/h4>/gi, "\n#### $1\n")
    .replace(/<li[^>]*>([\s\S]*?)<\/li>/gi, "\n- $1")
    .replace(/<\/(p|div|section|article|tr)>/gi, "\n\n")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, " ");

  const lines = cleanBlock(converted)
    .split(/\n+/)
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter(Boolean);
  const result = [];
  const seen = new Set();
  const noisePatterns = [
    /^skip to main content$/i,
    /^docs by .* home page$/i,
    /^documentation index$/i,
    /^join us /i,
    /^buy tickets/i,
    /^additional resources$/i,
    /^get help$/i,
    /^documentation index$/i,
    /^fetch the complete documentation index/i,
    /^use this file to discover/i,
    /^conceptual overviews$/i,
    /^langchain academy$/i,
    /^learn more$/i,
    /^edit this page$/i,
    /^edit this page on github/i,
    /^was this page helpful\??$/i,
    /^previous$/i,
    /^next$/i,
    /^on this page$/i
  ];
  for (const line of lines) {
    const visibleLine = line.replace(/[\u200B-\u200D\uFEFF]/g, "").trim();
    if (/^#{1,6}\s*$/.test(visibleLine)) {
      continue;
    }
    if (/^#{1,6}\s+documentation index$/i.test(visibleLine)) {
      continue;
    }
    const normalized = line.toLowerCase();
    if (noisePatterns.some((pattern) => pattern.test(visibleLine.replace(/^#{1,6}\s+/, "")))) {
      continue;
    }
    if (normalized.length < 18 && !visibleLine.startsWith("#") && !visibleLine.startsWith("- ")) {
      continue;
    }
    if (seen.has(normalized)) {
      continue;
    }
    seen.add(normalized);
    result.push(visibleLine);
  }
  const firstHeadingIndex = result.findIndex((line) => /^#{1,3}\s+/.test(line));
  const contentLines = firstHeadingIndex > 0 ? result.slice(firstHeadingIndex) : result;
  return contentLines.join("\n\n");
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
  /^yarn add\b/i,
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

const USELESS_MARKDOWN_BLOCK_HEADING_PATTERNS = [
  /^(citation|references|contributors|community|contact information|license|history|forks|languages|navigation menu|folders and files|repository files navigation)$/i,
  /^(安装|部署|快速开始)$/i
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

function stripUselessMarkdown(markdown) {
  const removed = [];
  const output = [];
  let skipBlock = false;
  let skipHeading = "";
  for (const [index, rawLine] of String(markdown).split("\n").entries()) {
    const line = rawLine.trimEnd();
    const heading = /^#{1,6}\s+(.+)$/.exec(line)?.[1]?.trim();
    if (heading) {
      skipBlock = USELESS_MARKDOWN_BLOCK_HEADING_PATTERNS.some((pattern) => pattern.test(heading));
      skipHeading = skipBlock ? heading : "";
      if (skipBlock) {
        removed.push({ line: index + 1, reason: "useless_heading_block", text: line.slice(0, 180) });
        continue;
      }
    } else if (skipBlock) {
      if (line.trim().length === 0) {
        continue;
      }
      removed.push({ line: index + 1, reason: `under_useless_heading:${skipHeading}`, text: line.slice(0, 180) });
      continue;
    }

    if (isUselessMarkdownLine(line)) {
      removed.push({ line: index + 1, reason: "useless_line", text: line.slice(0, 180) });
      continue;
    }
    output.push(line);
  }

  return {
    markdown: output.join("\n").replace(/\n{3,}/g, "\n\n").trim(),
    removed
  };
}

function normalizeMarkdown(markdown) {
  const lines = String(markdown)
    .replace(/\r\n/g, "\n")
    .replace(/[\u200B-\u200D\uFEFF]/g, "")
    .split("\n");
  const output = [];
  let previousHeading = "";
  for (const line of lines) {
    const trimmed = line.trimEnd();
    if (/^#{1,6}\s*$/.test(trimmed)) {
      continue;
    }
    if (/^#{1,6}\s+documentation index$/i.test(trimmed)) {
      continue;
    }
    if (/^#{1,2}\s+(.+)$/.test(trimmed)) {
      const headingText = trimmed.replace(/^#{1,6}\s+/, "").trim().toLowerCase();
      if (headingText === previousHeading) {
        continue;
      }
      previousHeading = headingText;
    }
    output.push(trimmed);
  }
  return stripUselessMarkdown(output.join("\n").replace(/\n{3,}/g, "\n\n").trim()).markdown;
}

function countMatches(input, pattern) {
  return (String(input).match(pattern) ?? []).length;
}

function analyzeMarkdownQuality(markdown) {
  const navNoiseLines = String(markdown)
    .split("\n")
    .filter((line) => /^(edit this page|was this page helpful|skip to main content|documentation index)$/i.test(line.trim()));
  return {
    char_count: markdown.length,
    heading_count: countMatches(markdown, /^#{1,6}\s+\S/gm),
    empty_heading_count: countMatches(markdown, /^#{1,6}\s*$/gm),
    mojibake_marker_count: countMatches(markdown, /鈥|锛|绋|涓|鑱|�/g),
    nav_noise_marker_count: navNoiseLines.length
  };
}

function analyzeMarkdownQualityStrict(markdown) {
  const lines = String(markdown).split("\n");
  const stripped = stripUselessMarkdown(markdown);
  const contentLines = lines
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .filter((line) => !/^#{1,6}\s+/.test(line))
    .filter((line) => !/^source url:/i.test(line))
    .filter((line) => !/^[-*]\s*(source|url|authors?|published|doi|arxiv):/i.test(line));
  const navNoiseLines = lines.filter((line) =>
    /^(edit this page|was this page helpful|skip to main content|documentation index)$/i.test(line.trim())
  );
  const uselessLines = lines.filter((line) => isUselessMarkdownLine(line));
  return {
    char_count: markdown.length,
    heading_count: countMatches(markdown, /^#{1,6}\s+\S/gm),
    empty_heading_count: countMatches(markdown, /^#{1,6}\s*$/gm),
    mojibake_marker_count: countMatches(markdown, /[\u9225\u95B3\u9471\uFFFD]/g),
    nav_noise_marker_count: navNoiseLines.length,
    useless_line_count: uselessLines.length,
    stripped_noise_line_count: stripped.removed.length,
    useful_body_char_count: contentLines.join("\n").length,
    substantive_line_count: contentLines.filter((line) => line.length >= 80).length
  };
}

const TOPIC_RELEVANCE_PATTERNS = {
  agent_memory: [
    /\b(agentic\s+memory|agent\s+memory|memory\s+system|long[-\s]?term\s+memory|persistent\s+memory)\b/i,
    /\bmem0\b|\bzep\b|\blangmem\b|\bletta\b/i,
    /智能体记忆|长期记忆|记忆系统|记忆管理|记忆治理/
  ],
  agent_framework: [
    /\b(agent|agents|multi-agent|agentic|workflow|tool\s+calling|function\s+calling)\b/i,
    /\bautogen\b|\bcrewai\b|\bpydantic\s+ai\b|\bagno\b|\bsemantic\s+kernel\b|\bqwen-agent\b|\bagentscope\b/i,
    /智能体|多智能体|工作流|工具调用|函数调用|应用构建/
  ],
  rag: [
    /\b(retrieval[-\s]?augmented\s+generation|rag|retriever|retrieval|rerank|reranker|hybrid\s+search|bm25|rrf|embedding|vector\s+search|query\s+engine|graphrag|node\s+parser|chunk|chunking|splitter)\b/i,
    /检索增强|检索增强生成|向量检索|混合检索|召回|重排|知识库问答|知识库|嵌入|切分|分块|图检索|切块/
  ],
  eval_harness: [
    /\b(eval|evaluation|benchmark|bench|harness|swe-bench|gaia|inspect\s+ai|promptfoo|deepeval|ragas)\b/i,
    /评测|评价|基准|测试集|测试框架|验证集/
  ],
  harness_engineering: [
    /\b(harness\s+engineering|agent\s+harness|ai\s+engineering\s+harness|swe-bench|benchmark|reliability)\b/i,
    /harness|测试脚手架|工程验证|可靠性|基准测试/
  ],
  mcp_tool_use: [
    /\b(model\s+context\s+protocol|mcp|tool\s+use|tools|resources|prompts|json-rpc)\b/i,
    /模型上下文协议|工具|资源|提示词|协议|客户端|服务器/
  ],
  knowledge_graph: [
    /\b(knowledge\s+graph|graph\s+rag|graphrag|ontology|entity|relation|graph\s+search|persistence|checkpoint|thread|stateful)\b/i,
    /知识图谱|图谱|实体|关系|本体|图检索|持久化|检查点|状态/
  ],
  observability: [
    /\b(observability|trace|tracing|telemetry|otel|opentelemetry|langfuse|phoenix|monitoring)\b/i,
    /可观测|追踪|监控|遥测|日志|指标/
  ],
  security: [
    /\b(security|prompt\s+injection|red\s+team|owasp|llm\s+risk|jailbreak|guardrail)\b/i,
    /安全|提示注入|红队|越狱|风险|防护/
  ],
  tool_use: [
    /\b(tool\s+use|tool\s+calling|function\s+calling|function-call|tools|agent\s+tool)\b/i,
    /工具调用|函数调用|工具使用|外部工具/
  ],
  vector_database: [
    /\b(vector\s+database|vector\s+search|hybrid\s+search|dense\s+vector|sparse\s+vector|weaviate|pinecone|qdrant|milvus|embedding)\b/i,
    /向量数据库|向量检索|混合检索|稠密向量|稀疏向量|嵌入/
  ],
  lexical_retrieval: [
    /\b(bm25|lexical\s+retrieval|similarity|elasticsearch|inverted\s+index|term\s+frequency)\b/i,
    /词法检索|倒排索引|相似度|词频/
  ],
  hybrid_retrieval: [
    /\b(hybrid\s+search|reciprocal\s+rank\s+fusion|rrf|bm25|vector\s+search|rank\s+fusion)\b/i,
    /混合检索|融合排序|向量检索|召回融合/
  ]
};

function analyzeTopicRelevance(markdown, signals) {
  const matched = [...new Set(signals)].filter((signal) => {
    const patterns = TOPIC_RELEVANCE_PATTERNS[signal] ?? [];
    return patterns.some((pattern) => pattern.test(markdown));
  });
  return {
    relevance_signal_count: matched.length,
    relevance_matched_signals: matched
  };
}

function assertMarkdownQualityStrict(quality) {
  if (quality.mojibake_marker_count > 0) {
    throw new Error(`markdown contains mojibake markers: ${quality.mojibake_marker_count}`);
  }
  if (quality.nav_noise_marker_count > 0) {
    throw new Error(`markdown contains navigation noise lines: ${quality.nav_noise_marker_count}`);
  }
  if (quality.useless_line_count > 0) {
    throw new Error(`markdown contains useless knowledge lines: ${quality.useless_line_count}`);
  }
  if (quality.useful_body_char_count < 900) {
    throw new Error(`markdown useful body too short: ${quality.useful_body_char_count}`);
  }
  if (quality.substantive_line_count < 3) {
    throw new Error(`markdown has too few substantive lines: ${quality.substantive_line_count}`);
  }
}

function materializeArxiv(html, candidate) {
  const title = extractTitle(html, candidate.title).replace(/^\[[^\]]+\]\s*/, "");
  const abstract = cleanBlock(
    /<blockquote[^>]*class=["'][^"']*abstract[^"']*["'][^>]*>\s*<span[^>]*>Abstract:\s*<\/span>\s*([\s\S]*?)<\/blockquote>/i.exec(html)?.[1] || ""
  );
  const authors = [...html.matchAll(/<meta\s+name=["']citation_author["']\s+content=["']([^"']+)["']/gi)].map((match) => cleanBlock(match[1]));
  const arxivId = /arxiv\.org\/abs\/([^/?#]+)/i.exec(candidate.url)?.[1] ?? "";
  return [
    `# ${title}`,
    "",
    "## Metadata",
    "",
    "- Source: arXiv",
    arxivId ? `- arXiv: ${arxivId}` : null,
    `- URL: ${candidate.url}`,
    authors.length > 0 ? `- Authors: ${authors.join(", ")}` : null,
    "",
    "## Abstract",
    "",
    abstract || "No abstract extracted.",
    "",
    "## Source Note",
    "",
    "This Markdown was generated from arXiv metadata and abstract. Full PDF conversion can be attached later if needed."
  ].filter((item) => item !== null).join("\n").trim();
}

async function fetchText(url) {
  const response = await fetch(url, {
    headers: {
      "user-agent": "SuperAgentSystem markdown materializer/1.0"
    },
    signal: AbortSignal.timeout(Number(process.env.AI_DEV_FETCH_TIMEOUT_MS || 20_000))
  });
  if (!response.ok) {
    throw new Error(`fetch failed: ${response.status}`);
  }
  const bytes = Buffer.from(await response.arrayBuffer());
  const contentType = response.headers.get("content-type") ?? "";
  const charset = /charset=([^;]+)/i.exec(contentType)?.[1]?.trim().toLowerCase();
  if (charset && charset !== "utf-8" && charset !== "utf8") {
    try {
      return new TextDecoder(charset).decode(bytes);
    } catch {
      return new TextDecoder("utf-8", { fatal: false }).decode(bytes);
    }
  }
  return new TextDecoder("utf-8", { fatal: false }).decode(bytes);
}

async function materialize(candidate) {
  const html = await fetchText(candidate.url);
  const title = extractTitle(html, candidate.title);
  const markdownBody = normalizeMarkdown(
    /^https?:\/\/arxiv\.org\/abs\//i.test(candidate.url)
      ? materializeArxiv(html, candidate)
      : [`# ${title}`, "", `Source URL: ${candidate.url}`, "", htmlToMarkdown(html)].join("\n").trim()
  );
  if (markdownBody.length < 120) {
    throw new Error("extracted markdown too short");
  }
  const quality = analyzeMarkdownQualityStrict(markdownBody);
  const expectedSignals = [...new Set([candidate.topic_hint, candidate.source_type].filter(Boolean))];
  const relevance = analyzeTopicRelevance(markdownBody, expectedSignals);
  assertMarkdownQualityStrict(quality);

  const sourceDir = path.join(outputRoot, `${safePathPart(candidate.id)}-${safePathPart(candidate.title)}`);
  await mkdir(sourceDir, { recursive: true });
  const markdownPath = path.join(sourceDir, "source.md");
  await writeFile(markdownPath, `${markdownBody}\n`, "utf8");

  return {
    id: `ingest-${candidate.id}`,
    source_candidate_id: candidate.id,
    theme: candidate.topic_hint,
    title: candidate.title,
    source_kind: candidate.source_type,
    url: candidate.url,
    file_path: markdownPath,
    memory_domain: "knowledge",
    source_type: "markdown_file",
    sectioning_mode: "markdown",
    language: candidate.language,
    markdown_converter: /^https?:\/\/arxiv\.org\/abs\//i.test(candidate.url) ? "arxiv-metadata-to-markdown-v1" : "html-to-markdown-clean-v1",
    markdown_quality: {
      ...quality,
      ...relevance
    },
    expected_signals: expectedSignals,
    governance_flags: relevance.relevance_signal_count === 0
      ? [`topic_relevance_missing:${expectedSignals.join(",")}`]
      : []
  };
}

const candidates = JSON.parse(await readFile(candidatesPath, "utf8")).candidates.slice(0, limit);
const ingestCases = [];
const failures = [];

for (const candidate of candidates) {
  try {
    ingestCases.push(await materialize(candidate));
  } catch (error) {
    failures.push({
      id: candidate.id,
      title: candidate.title,
      url: candidate.url,
      language: candidate.language,
      source_type: candidate.source_type,
      topic_hint: candidate.topic_hint,
      error: error instanceof Error ? error.message : String(error)
    });
  }
}

await writeFile(ingestCasesPath, `${JSON.stringify(ingestCases, null, 2)}\n`, "utf8");
await writeFile(
  path.join(rootDir, "tests", "knowledge-benchmark", "ai-dev-materialize-failures.v1.json"),
  `${JSON.stringify({ generated_at: new Date().toISOString(), items: failures }, null, 2)}\n`,
  "utf8"
);
await writeFile(
  path.join(rootDir, "tests", "knowledge-benchmark", "ai-dev-materialize-report.json"),
  `${JSON.stringify(
    {
      generated_at: new Date().toISOString(),
      total: candidates.length,
      success: ingestCases.length,
      failure: failures.length,
      output_root: outputRoot,
      quality_summary: {
        markdown_total_chars: ingestCases.reduce((sum, item) => sum + item.markdown_quality.char_count, 0),
        markdown_total_headings: ingestCases.reduce((sum, item) => sum + item.markdown_quality.heading_count, 0),
        mojibake_marker_count: ingestCases.reduce((sum, item) => sum + item.markdown_quality.mojibake_marker_count, 0),
        nav_noise_marker_count: ingestCases.reduce((sum, item) => sum + item.markdown_quality.nav_noise_marker_count, 0),
        useless_line_count: ingestCases.reduce((sum, item) => sum + item.markdown_quality.useless_line_count, 0),
        stripped_noise_line_count: ingestCases.reduce((sum, item) => sum + item.markdown_quality.stripped_noise_line_count, 0),
        useful_body_total_chars: ingestCases.reduce((sum, item) => sum + item.markdown_quality.useful_body_char_count, 0),
        substantive_line_count: ingestCases.reduce((sum, item) => sum + item.markdown_quality.substantive_line_count, 0),
        relevance_signal_count: ingestCases.reduce((sum, item) => sum + item.markdown_quality.relevance_signal_count, 0),
        topic_relevance_missing_count: ingestCases.filter((item) => item.governance_flags?.some((flag) => flag.startsWith("topic_relevance_missing:"))).length
      },
      failures
    },
    null,
    2
  )}\n`,
  "utf8"
);

process.stdout.write(JSON.stringify({ ok: true, total: candidates.length, success: ingestCases.length, failure: failures.length, output: ingestCasesPath }, null, 2));

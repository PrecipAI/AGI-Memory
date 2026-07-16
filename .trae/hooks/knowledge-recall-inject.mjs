#!/usr/bin/env node
import { randomUUID } from "node:crypto";

const MEMORY_SERVICE_URL =
  process.env.MEMORY_SERVICE_URL || "http://localhost:3101";
const TENANT_ID = process.env.MEMORY_TENANT_ID || "tenant-local";
const SCOPE = process.env.MEMORY_SCOPE || "memory.validation";
const DEBUG = process.env.HOOK_DEBUG;

// 认知类关键词：触发 Knowledge 召回
// 含这些词的 prompt 可能需要项目合成的认知（limitation/pattern/synthesis）
const COGNITIVE_KEYWORDS = [
  "区别", "差异", "对比", "为什么", "为啥", "本质", "原理", "机制",
  "怎么做", "如何", "是什么", "是什么意思", "架构", "设计", "选型",
  "方案", "思路", "关系", "联系", "优缺点", "tradeoff", "权衡",
  "不支持", "能不能", "行不行", "有没有", "为什么不", "为啥不",
];

// 纯代码修改关键词：跳过 Knowledge 召回
// 这些是明确的代码操作指令，Knowledge 层的认知对它们没用
const CODE_ACTION_KEYWORDS = [
  "改这个", "修复这个", "实现这个", "写一个", "写个", "添加一个",
  "删除这个", "重构这个", "创建一个", "更新这个", "编辑这个",
  "改下", "改一下", "修下", "修一下", "写下", "写一下",
  "run ", "npm ", "git ", "docker ", "node ",
];

// 判断是否应该触发 Knowledge 召回
function shouldRun(prompt) {
  if (!prompt || prompt.length < 5) return false;

  const lower = prompt.toLowerCase();

  // 1. 纯代码修改指令 → 跳过
  //    "改下这个函数" "修复 bug" "写个测试" 这类不需要 Knowledge
  if (CODE_ACTION_KEYWORDS.some((kw) => lower.includes(kw))) {
    // 但如果同时含认知关键词，仍然触发（"为什么这个函数报错"）
    if (!COGNITIVE_KEYWORDS.some((kw) => prompt.includes(kw))) {
      return false;
    }
  }

  // 2. 含认知关键词 → 触发
  if (COGNITIVE_KEYWORDS.some((kw) => prompt.includes(kw))) {
    return true;
  }

  // 3. 含项目专属名词 → 触发（这些是 Knowledge 层覆盖的核心领域）
  const DOMAIN_KEYWORDS = [
    "TRAE", "trae", "AGI", "agi", "Memory", "memory", "Knowledge",
    "knowledge", "Skill", "skill", "Rule", "rule", "hook", "MCP", "mcp",
    "治理", "governance", "召回", "retrieve", "门控", "gate",
  ];
  if (DOMAIN_KEYWORDS.some((kw) => prompt.includes(kw))) {
    return true;
  }

  // 4. 其他情况 → 跳过（保守策略，避免无效消耗）
  return false;
}

async function readStdin() {
  let input = '';
  for await (const chunk of process.stdin) { input += chunk; }
  if (input.charCodeAt(0) === 0xfeff) { input = input.slice(1); }
  return input;
}

async function retrieveKnowledge(query) {
  const body = {
    task_request_id: randomUUID(),
    query,
    fingerprint_status: 'matched_or_na',
    top_k: 5,
    include_factual: false,
    include_procedural: false,
  };
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);
  try {
    const response = await fetch(
      new URL('/internal/knowledge/retrieve', MEMORY_SERVICE_URL),
      {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-tenant-id': TENANT_ID,
          'x-scope': SCOPE,
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      },
    );
    if (!response.ok) {
      if (DEBUG) process.stderr.write('[hook] API ' + response.status + '\n');
      return [];
    }
    const result = (await response.json()) ?? {};
    const items = Array.isArray(result.derived_knowledge) ? result.derived_knowledge : [];
    return items;
  } catch (e) {
    if (DEBUG) process.stderr.write('[hook] fetch error: ' + e.message + '\n');
    return [];
  } finally {
    clearTimeout(timeout);
  }
}

function formatKnowledge(items) {
  if (!items.length) return '';
  const lines = [
    '=== Knowledge layer recall (auto-injected) ===',
    '',
  ];
  for (const item of items) {
    lines.push('[' + (item.title ?? 'unnamed') + ']');
    lines.push('type: ' + (item.knowledge_type ?? 'unknown'));
    lines.push('content: ' + (item.content ?? ''));
    lines.push('');
  }
  return lines.join('\n');
}

async function main() {
  try {
    const input = await readStdin();
    const trimmed = input.trim();
    if (DEBUG) process.stderr.write('[hook] input len=' + trimmed.length + '\n');
    if (!trimmed) process.exit(0);
    let context;
    try { context = JSON.parse(trimmed); } catch (e) {
      if (DEBUG) process.stderr.write('[hook] JSON fail: ' + e.message + '\n');
      process.exit(0);
    }
    const prompt = context?.prompt ?? '';
    if (DEBUG) process.stderr.write('[hook] prompt=' + prompt.substring(0, 80) + '\n');
    if (!prompt || prompt.length < 3) process.exit(0);
    if (!shouldRun(prompt)) {
      if (DEBUG) process.stderr.write('[hook] skipped by shouldRun\n');
      process.exit(0);
    }
    const items = await retrieveKnowledge(prompt);
    if (DEBUG) process.stderr.write('[hook] items=' + items.length + '\n');
    const text = formatKnowledge(items);
    if (DEBUG) process.stderr.write('[hook] text len=' + text.length + '\n');
    if (text) process.stdout.write(text);
    process.exit(0);
  } catch (e) {
    if (DEBUG) process.stderr.write('[hook] error: ' + e.message + '\n');
    process.exit(0);
  }
}

main();

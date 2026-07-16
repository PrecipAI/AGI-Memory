#!/usr/bin/env node
import { randomUUID } from 'node:crypto';

const MEMORY_SERVICE_URL = process.env.MEMORY_SERVICE_URL || 'http://localhost:3101';
const TENANT_ID = process.env.MEMORY_TENANT_ID || 'tenant-local';
const SCOPE = process.env.MEMORY_SCOPE || 'memory.validation';
const DEBUG = process.env.HOOK_DEBUG;

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

/**
 * MCP memory_retrieve_context 集成 Knowledge 层召回测试
 *
 * 验证 memory_retrieve_context MCP 工具调用后，
 * derived_knowledge 字段出现在返回结果里。
 *
 * 使用 mock fetch，不依赖真实 memory-service。
 */

import assert from "node:assert/strict";

console.log("=== MCP Knowledge 集成测试 ===\n");

// ─── 1. retrieveKnowledge 方法单元测试（mock fetch） ─────────────────

console.log("=== 1. retrieveKnowledge 方法单元测试 ===");

// 模拟 fetch 成功响应
const mockSuccessResponse = {
  ok: true,
  status: 200,
  text: async () =>
    JSON.stringify({
      bundle_id: "test-bundle-id",
      query: "TRAE Rule 软约束",
      derived_knowledge: [
        {
          id: "k-001",
          title: "TRAE Work Rule 软约束",
          knowledge_type: "limitation",
          confidence_score: 0.9,
          content: "TRAE Work Rule 本质是文本注入，没有强制执行",
        },
        {
          id: "k-002",
          title: "TRAE Work 不支持 hook",
          knowledge_type: "limitation",
          confidence_score: 0.9,
          content: "TRAE Work 不支持 .trae/hooks.json",
        },
      ],
    }),
  json: async () => ({
    bundle_id: "test-bundle-id",
    query: "TRAE Rule 软约束",
    derived_knowledge: [
      {
        id: "k-001",
        title: "TRAE Work Rule 软约束",
        knowledge_type: "limitation",
        confidence_score: 0.9,
        content: "TRAE Work Rule 本质是文本注入，没有强制执行",
      },
      {
        id: "k-002",
        title: "TRAE Work 不支持 hook",
        knowledge_type: "limitation",
        confidence_score: 0.9,
        content: "TRAE Work 不支持 .trae/hooks.json",
      },
    ],
  }),
};

// 模拟 fetch 失败响应
const mockFailResponse = {
  ok: false,
  status: 500,
  text: async () => "Internal Server Error",
};

// 模拟 fetch 网络异常
const mockNetworkError = new Error("fetch failed");

// 测试 1.1: 成功召回 derived_knowledge
{
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => mockSuccessResponse;

  // 动态 import 避免编译依赖
  const { MemoryEngineAdapter } = await import(
    "../../services/memory-mcp-server/dist/services/memory-mcp-server/src/engineAdapter.js"
  );
  const adapter = new MemoryEngineAdapter({
    tenantId: "test-tenant",
    scope: "test-scope",
    memoryServiceUrl: "http://localhost:3101",
  });

  const result = await adapter.retrieveKnowledge({
    task_request_id: "00000000-0000-0000-0000-000000000001",
    query: "TRAE Rule 软约束",
    fingerprint_status: "matched_or_na",
    top_k: 10,
    include_factual: false,
    include_procedural: false,
  });

  assert.ok(
    Array.isArray(result.derived_knowledge),
    "derived_knowledge 应该是数组",
  );
  assert.equal(result.derived_knowledge.length, 2, "应该召回 2 条 knowledge");
  assert.equal(
    result.derived_knowledge[0].title,
    "TRAE Work Rule 软约束",
    "第一条 title 正确",
  );
  console.log("  ✓ 成功召回 derived_knowledge（2 条）");

  globalThis.fetch = originalFetch;
}

// 测试 1.2: fetch 失败时返回空数组（不抛异常）
{
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => mockFailResponse;

  const { MemoryEngineAdapter } = await import(
    "../../services/memory-mcp-server/dist/services/memory-mcp-server/src/engineAdapter.js"
  );
  const adapter = new MemoryEngineAdapter({
    tenantId: "test-tenant",
    scope: "test-scope",
    memoryServiceUrl: "http://localhost:3101",
  });

  const result = await adapter.retrieveKnowledge({
    task_request_id: "00000000-0000-0000-0000-000000000002",
    query: "测试查询",
    top_k: 5,
  });

  assert.ok(
    Array.isArray(result.derived_knowledge),
    "失败时 derived_knowledge 仍应该是数组",
  );
  assert.equal(result.derived_knowledge.length, 0, "失败时返回空数组");
  console.log("  ✓ fetch 失败时返回空数组（不抛异常）");

  globalThis.fetch = originalFetch;
}

// 测试 1.3: 网络异常时返回空数组（不抛异常）
{
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => {
    throw mockNetworkError;
  };

  const { MemoryEngineAdapter } = await import(
    "../../services/memory-mcp-server/dist/services/memory-mcp-server/src/engineAdapter.js"
  );
  const adapter = new MemoryEngineAdapter({
    tenantId: "test-tenant",
    scope: "test-scope",
    memoryServiceUrl: "http://localhost:3101",
  });

  const result = await adapter.retrieveKnowledge({
    task_request_id: "00000000-0000-0000-0000-000000000003",
    query: "测试查询",
    top_k: 5,
  });

  assert.equal(result.derived_knowledge.length, 0, "网络异常时返回空数组");
  console.log("  ✓ 网络异常时返回空数组（不抛异常）");

  globalThis.fetch = originalFetch;
}

// 测试 1.4: derived_knowledge 字段缺失时返回空数组
{
  const mockMissingFieldResponse = {
    ok: true,
    status: 200,
    text: async () => JSON.stringify({ bundle_id: "test", query: "test" }),
    json: async () => ({ bundle_id: "test", query: "test" }),
  };
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => mockMissingFieldResponse;

  const { MemoryEngineAdapter } = await import(
    "../../services/memory-mcp-server/dist/services/memory-mcp-server/src/engineAdapter.js"
  );
  const adapter = new MemoryEngineAdapter({
    tenantId: "test-tenant",
    scope: "test-scope",
    memoryServiceUrl: "http://localhost:3101",
  });

  const result = await adapter.retrieveKnowledge({
    task_request_id: "00000000-0000-0000-0000-000000000004",
    query: "测试查询",
    top_k: 5,
  });

  assert.equal(result.derived_knowledge.length, 0, "字段缺失时返回空数组");
  console.log("  ✓ derived_knowledge 字段缺失时返回空数组");

  globalThis.fetch = originalFetch;
}

// 测试 1.5: 请求体包含正确的参数
{
  let capturedBody = null;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, options) => {
    capturedBody = JSON.parse(options.body);
    return mockSuccessResponse;
  };

  const { MemoryEngineAdapter } = await import(
    "../../services/memory-mcp-server/dist/services/memory-mcp-server/src/engineAdapter.js"
  );
  const adapter = new MemoryEngineAdapter({
    tenantId: "test-tenant",
    scope: "test-scope",
    memoryServiceUrl: "http://localhost:3101",
  });

  await adapter.retrieveKnowledge({
    task_request_id: "00000000-0000-0000-0000-000000000005",
    query: "TRAE hook 机制",
    fingerprint: "local-dev-v1",
    fingerprint_status: "matched",
    top_k: 10,
    include_factual: false,
    include_procedural: false,
  });

  assert.equal(
    capturedBody.task_request_id,
    "00000000-0000-0000-0000-000000000005",
    "task_request_id 传递正确",
  );
  assert.equal(capturedBody.query, "TRAE hook 机制", "query 传递正确");
  assert.equal(capturedBody.fingerprint, "local-dev-v1", "fingerprint 传递正确");
  assert.equal(
    capturedBody.fingerprint_status,
    "matched",
    "fingerprint_status 传递正确",
  );
  assert.equal(capturedBody.top_k, 10, "top_k 传递正确");
  assert.equal(
    capturedBody.include_procedural,
    false,
    "include_procedural=false 传递正确",
  );
  console.log("  ✓ 请求体参数传递正确");

  globalThis.fetch = originalFetch;
}

console.log("\n=== 所有测试通过 ===");

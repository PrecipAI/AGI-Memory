import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { buildMemoryServiceApp } from "../services/memory-service/dist/services/memory-service/src/app.js";

const root = process.cwd();
const promptSpecPath = path.join(root, "docs", "specs", "knowledge-platform", "39-governance-prompt-architecture.md");
const skillPath = "C:\\Users\\Administrator\\.codex\\skills\\memory-governance-guidelines\\SKILL.md";

const promptSpec = fs.readFileSync(promptSpecPath, "utf8");
const skill = fs.readFileSync(skillPath, "utf8");

for (const required of [
  "Rule Governance Prompt",
  "Skill Governance Prompt",
  "Knowledge Governance Prompt",
  "Memory Governance Prompt",
  "Cross-layer Audit",
  "Human Approval / Apply Gate",
  "失败/成功执行路径默认抽成 memory",
  "由点及面",
  "通用依赖接入原则",
  "health/preflight"
]) {
  assert.ok(promptSpec.includes(required) || required === "失败/成功执行路径默认抽成 memory", `prompt spec should include ${required}`);
}
assert.ok(promptSpec.includes("不得把失败/成功执行路径默认抽成 memory"), "prompt spec must block failure/success path -> memory by default");
assert.ok(skill.includes("四层治理 Prompt"), "memory-governance skill must include four-layer prompt guidance");
assert.ok(skill.includes("失败模式和成功路径默认先作为治理证据"), "skill must route failure/success paths away from memory by default");
assert.ok(skill.includes("由点及面"), "skill must require generalizing incidents into reusable patterns");
assert.ok(skill.includes("health/preflight"), "skill must require dependency preflight before external calls");

const app = buildMemoryServiceApp();
const fixtureRoot = path.join(root, "tests", "fixtures", "codex-capture");
const threadId = "019df330-e9df-7ef3-90bc-7c403ef1741e";

try {
  const previewResponse = await app.inject({
    method: "POST",
    url: "/internal/host-capture/codex/preview",
    payload: {
      codex_home: fixtureRoot,
      thread_id: threadId,
      max_items: 8
    }
  });
  assert.equal(previewResponse.statusCode, 200);
  const firstUserMessage = previewResponse.json().governance_preview.user_messages[0];
  assert.ok(firstUserMessage);

  const base = {
    origin_scope: "project",
    availability_scope: "project_reusable",
    governance_level: "shared",
    promotion_status: "active",
    source_kind: "user_message",
    source_timestamp: firstUserMessage.timestamp,
    source_excerpt: firstUserMessage.text,
    confidence: "high"
  };

  const invalidKnowledgeResponse = await app.inject({
    method: "POST",
    url: "/internal/host-capture/codex/governance-run",
    payload: {
      codex_home: fixtureRoot,
      thread_id: threadId,
      max_items: 8,
      governance_mode: "host_model",
      host_model_result: {
        model_ref: "governance-contract:test",
        extraction_preview: {
          knowledge_candidates: [
            {
              ...base,
              candidate_type: "knowledge_candidate",
              title: "Invalid project knowledge",
              content: "SuperAgentSystem 项目路径是 D:\\workspace\\projects\\SuperAgentSystem-main。",
              knowledge_type: "external_fact",
              governance_action: "create",
              synthesis_reasoning: "This is intentionally invalid because project-local context is not knowledge.",
              recall_state: "active",
              reason: "Should be rejected by cross-layer audit."
            }
          ]
        }
      }
    }
  });
  assert.equal(invalidKnowledgeResponse.statusCode, 400, invalidKnowledgeResponse.body);
  assert.match(invalidKnowledgeResponse.body, /knowledge_candidate/);

  const invalidRuleResponse = await app.inject({
    method: "POST",
    url: "/internal/host-capture/codex/governance-run",
    payload: {
      codex_home: fixtureRoot,
      thread_id: threadId,
      max_items: 8,
      governance_mode: "host_model",
      host_model_result: {
        model_ref: "governance-contract:test",
        extraction_preview: {
          rule_candidates: [
            {
              ...base,
              candidate_type: "rule_candidate",
              title: "Invalid weak rule",
              content: "治理层提示词设计得更完整会比较好。",
              rule_domain: "governance",
              rule_scope: "project",
              applies_to_phase: ["governance"],
              violation_behavior: "warn",
              reason: "Should be rejected because it is not a must/must_not constraint."
            }
          ]
        }
      }
    }
  });
  assert.equal(invalidRuleResponse.statusCode, 400, invalidRuleResponse.body);
  assert.match(invalidRuleResponse.body, /rule_candidate/);

  const duplicatedLayerResponse = await app.inject({
    method: "POST",
    url: "/internal/host-capture/codex/governance-run",
    payload: {
      codex_home: fixtureRoot,
      thread_id: threadId,
      max_items: 8,
      governance_mode: "host_model",
      host_model_result: {
        model_ref: "governance-contract:test",
        extraction_preview: {
          memory_candidates: [
            {
              ...base,
              candidate_type: "memory_candidate",
              title: "Duplicate memory",
              content: "这是一个跨层重复分类的测试内容，长度足够用于触发审计。",
              memory_type: "project_memory",
              stability: "stable",
              source_excerpt: "External source excerpt for duplicate classification audit.",
              reason: "Should be rejected because the same content is also classified as knowledge."
            }
          ],
          knowledge_candidates: [
            {
              ...base,
              candidate_type: "knowledge_candidate",
              title: "Duplicate knowledge",
              content: "这是一个跨层重复分类的测试内容，长度足够用于触发审计。",
              knowledge_type: "external_fact",
              governance_action: "create",
              synthesis_reasoning: "This intentionally duplicates memory content.",
              recall_state: "audit_only",
              source_excerpt: "External source excerpt for duplicate classification audit.",
              reason: "Should be rejected by cross-layer audit."
            }
          ]
        }
      }
    }
  });
  assert.equal(duplicatedLayerResponse.statusCode, 400, duplicatedLayerResponse.body);
  assert.match(duplicatedLayerResponse.body, /cross-layer audit/);

  const proceduralMemoryResponse = await app.inject({
    method: "POST",
    url: "/internal/host-capture/codex/governance-run",
    payload: {
      codex_home: fixtureRoot,
      thread_id: threadId,
      max_items: 8,
      governance_mode: "host_model",
      host_model_result: {
        model_ref: "governance-contract:test",
        extraction_preview: {
          memory_candidates: [
            {
              ...base,
              candidate_type: "memory_candidate",
              title: "Invalid procedural memory",
              content: "失败时应该按固定流程排查：然后运行诊断命令，最后生成可复用修复步骤。",
              memory_type: "project_memory",
              stability: "stable",
              source_excerpt: "Project governance procedure excerpt.",
              reason: "Should be rejected because reusable procedure belongs to skill proposal."
            }
          ]
        }
      }
    }
  });
  assert.equal(proceduralMemoryResponse.statusCode, 400, proceduralMemoryResponse.body);
  assert.match(proceduralMemoryResponse.body, /skill_proposal_candidate/);

  process.stdout.write(
    `${JSON.stringify(
      {
        prompt_spec: promptSpecPath,
        skill: skillPath,
        checks: [
          "four-layer prompt spec present",
          "memory-governance skill updated",
          "host_model rejects project-local knowledge",
          "host_model rejects non-enforceable rule",
          "cross-layer audit rejects duplicate layer classification",
          "cross-layer audit rejects procedural memory",
          "prompt requires point-to-pattern generalization",
          "prompt requires dependency health/preflight"
        ]
      },
      null,
      2
    )}\n`
  );
} finally {
  await app.close();
}

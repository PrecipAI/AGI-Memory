import assert from "node:assert/strict";
import path from "node:path";
import { getPool } from "../libs/db/dist/pool.js";
import { buildMemoryServiceApp } from "../services/memory-service/dist/services/memory-service/src/app.js";

const app = buildMemoryServiceApp();
const fixtureRoot = path.join(process.cwd(), "tests", "fixtures", "codex-capture");
const threadId = "019df330-e9df-7ef3-90bc-7c403ef1741e";

try {
  await getPool().query(
    "DELETE FROM host_governance_event WHERE tenant_id = $1 AND scope = $2 AND host = $3 AND thread_id = $4",
    ["tenant-local", "memory.validation", "codex", threadId]
  );

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
  const preview = previewResponse.json();
  const firstUserMessage = preview.governance_preview.user_messages[0];
  assert.ok(firstUserMessage, "fixture should contain at least one user message");

  const hostModelResult = {
    model_ref: "codex-host-model:test-double",
    generated_at: new Date("2026-05-06T00:00:00.000Z").toISOString(),
    extraction_preview: {
      rule_candidates: [
        {
          candidate_type: "rule_candidate",
          title: "Host model governance output reporting rule",
          origin_scope: "user",
          availability_scope: "user_reusable",
          governance_level: "shared",
          promotion_status: "active",
          rule_domain: "governance",
          rule_scope: "user",
          applies_to_phase: ["governance", "reporting"],
          violation_behavior: "record",
          source_kind: "user_message",
          source_timestamp: firstUserMessage.timestamp,
          content: "宿主模型治理完成后必须展示具体抽取结果，不能只返回数量。",
          source_excerpt: firstUserMessage.text,
          reason: "Host model identified a reusable governance reporting rule.",
          confidence: "high"
        }
      ],
      memory_candidates: [
        {
          candidate_type: "memory_candidate",
          title: "Host model governance contract decision",
          origin_scope: "project",
          availability_scope: "project_reusable",
          governance_level: "shared",
          promotion_status: "active",
          memory_type: "project_memory",
          stability: "long_lived",
          source_kind: "user_message",
          source_timestamp: firstUserMessage.timestamp,
          content: "治理层应优先接收 Codex、Claude Code、OpenClaw 等宿主模型生成的结构化治理结果，服务端只负责 schema 校验、增量去重、审查流和落库。",
          source_excerpt: firstUserMessage.text,
          reason: "Host model distilled the host-model-first governance integration contract.",
          confidence: "high"
        }
      ],
      skill_proposal_candidates: [
        {
          candidate_type: "skill_proposal_candidate",
          title: "Memory governance host model contract skill update",
          origin_scope: "user",
          availability_scope: "user_reusable",
          governance_level: "shared",
          promotion_status: "needs_review",
          source_kind: "user_message",
          source_timestamp: firstUserMessage.timestamp,
          target_skill: "memory-governance-guidelines",
          target_skill_path: "C:\\Users\\Administrator\\.codex\\skills\\memory-governance-guidelines\\SKILL.md",
          change_type: "update",
          current_section: "治理模型接入",
          current_text: "当前 skill 未明确宿主模型优先的治理接入方式。",
          current_gap: "如果治理层强绑定服务端模型，会破坏 Codex、Claude Code、OpenClaw 等宿主热插拔接入目标。",
          proposed_text: "治理层默认由宿主 agent 使用其当前模型生成结构化治理结果；memory-service 只负责校验、去重、审批和落库，规则 fallback 仅用于无模型测试链路。",
          proposed_patch: "*** Begin Patch\n*** Update File: SKILL.md\n@@\n+## 治理模型接入\n+\n+- 治理层默认由宿主 agent 使用其当前模型生成结构化治理结果；memory-service 只负责校验、去重、审批和落库，规则 fallback 仅用于无模型测试链路。\n*** End Patch",
          validation_method: "运行 host_model 治理时，服务端应接受结构化结果并拒绝缺少关键字段的 skill proposal。",
          rationale: "保持治理系统对 Codex、Claude Code、OpenClaw、opencode 等宿主的热插拔适配能力。",
          proposal_quality: "actionable",
          source_refs: [
            {
              source_kind: "user_message",
              source_timestamp: firstUserMessage.timestamp,
              source_excerpt: firstUserMessage.text
            }
          ],
          merged_source_count: 1,
          source_excerpt: firstUserMessage.text,
          reason: "Host model produced a concrete skill update proposal with target skill, gap, and patch.",
          confidence: "high"
        }
      ],
      knowledge_candidates: [],
      governance_evidence_candidates: [
        {
          candidate_type: "governance_evidence_candidate",
          title: "Host model governance fixture evidence",
          origin_scope: "session",
          availability_scope: "session_only",
          governance_level: "session",
          promotion_status: "candidate",
          evidence_category: "execution_step",
          source_kind: "user_message",
          source_timestamp: firstUserMessage.timestamp,
          source_excerpt: firstUserMessage.text,
          reason: "The original host thread remains session-only evidence for governance traceability.",
          confidence: "medium"
        }
      ]
    }
  };

  const runResponse = await app.inject({
    method: "POST",
    url: "/internal/host-capture/codex/governance-run",
    payload: {
      codex_home: fixtureRoot,
      thread_id: threadId,
      max_items: 8,
      governance_mode: "host_model",
      host_model_result: hostModelResult,
      task_request_id: "22222222-2222-4222-8222-222222222222"
    }
  });
  assert.equal(runResponse.statusCode, 200, runResponse.body);
  const body = runResponse.json();

  assert.equal(body.acceptance_report.governance_model.mode, "host_model");
  assert.equal(body.acceptance_report.governance_model.model_ref, "codex-host-model:test-double");
  assert.equal(body.persisted.rule_items.length, 1);
  assert.equal(body.persisted.memory_items.length, 1);
  assert.equal(body.persisted.skill_proposal_items.length, 1);
  assert.equal(body.persisted.knowledge_items.length, 0);
  assert.equal(body.persisted.rule_items[0].statement, "宿主模型治理完成后必须展示具体抽取结果，不能只返回数量。");
  assert.equal(body.persisted.memory_items[0].title, "Host model governance contract decision");
  assert.equal(body.persisted.skill_proposal_items[0].target_skill, "memory-governance-guidelines");
  assert.equal(body.persisted.skill_proposal_items[0].promotion_status, "needs_review");
  assert.ok(body.persisted.governance_evidence_bundle_id);

  const invalidResponse = await app.inject({
    method: "POST",
    url: "/internal/host-capture/codex/governance-run",
    payload: {
      codex_home: fixtureRoot,
      thread_id: threadId,
      max_items: 8,
      governance_mode: "host_model",
      host_model_result: {
        model_ref: "codex-host-model:test-double",
        extraction_preview: {
          skill_proposal_candidates: [
            {
              candidate_type: "skill_proposal_candidate",
              title: "Invalid skill proposal",
              origin_scope: "user",
              availability_scope: "user_reusable",
              governance_level: "shared",
              promotion_status: "needs_review",
              source_kind: "user_message",
              source_timestamp: firstUserMessage.timestamp,
              source_excerpt: firstUserMessage.text,
              reason: "Missing target_skill/current_gap/proposed_text must fail.",
              confidence: "high"
            }
          ]
        }
      }
    }
  });
  assert.equal(invalidResponse.statusCode, 400, invalidResponse.body);
  assert.match(invalidResponse.body, /target_skill/);

  process.stdout.write(
    `${JSON.stringify(
      {
        thread_id: body.thread_id,
        governance_model: body.acceptance_report.governance_model,
        persisted: body.persisted,
        candidate_counts: body.acceptance_report.governance_candidates
      },
      null,
      2
    )}\n`
  );
} finally {
  await app.close();
}

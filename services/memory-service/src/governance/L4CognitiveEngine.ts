/**
 * L4 认知引擎
 *
 * 治理流水线的最后一步，拥有"全局视野"：
 *   ① 上下文收集：本次 candidates + L2/L3 结果 + 已有四层资产 + 访问日志
 *   ② 假设生成：时间序列模式 / 跨层关联 / 召回异常 / 知识缺口 / 矛盾检测
 *   ③ 证据收集：从 kp_relation / memory_access_log / rule_gate_audit / 历史提案中找支持/反驳
 *   ④ 多轮推理验证：初步结论 → 矛盾检测 → 证伪尝试 → 置信度评估
 *   ⑤ 分层产出：
 *     - L4-2 模式识别 → kp_synthesized_knowledge (pending_review)
 *     - L4-3 因果推断 → kp_synthesized_knowledge (pending_review)
 *     - L4-4 策略建议 → governance_change_proposal (recorded)
 *     - L4-5 元认知 → metadata (内部参考)
 */

import { getPool } from "@super-agent/db";
import { createGovernanceChangeProposal } from "@super-agent/db";
import {
  createKnowledgeEvidence,
  createSynthesizedKnowledge,
  linkSynthesizedKnowledgeEvidence,
} from "@super-agent/db";
import { buildSynthesizedKnowledgeMetadata } from "@super-agent/contracts";
import {
  countAccessByObjectRef,
  getLastAccessTimeByObjectRef,
} from "@super-agent/db";

export interface Hypothesis {
  id: string;
  type: "time_series_pattern" | "cross_layer_correlation" | "recall_anomaly" | "knowledge_gap" | "contradiction";
  title: string;
  description: string;
  initialConfidence: number;
  evidence: Evidence[];
  finalConfidence: number;
  reasoningChain: string[];
  conclusion: string;
  layer: "pattern" | "causation" | "strategy";
  sourceIds: string[];
  sourceLayer?: string;
  /**
   * 与 sourceIds 对齐的层名数组，每个 id 标明它真实属于哪一层。
   * 跨层 hypothesis（如 cross_layer_correlation）的 sourceIds 可能含 rule.id + memory.id，
   * 此时 sourceAssetLayers=["rule","memory"]，让 L3 知道每个 id 该查哪张表，避免误判 stale。
   * 若不提供，buildSynthesizedKnowledgeMetadata 会回退到按 sourceLayer 统一标注。
   */
  sourceAssetLayers?: Array<"rule" | "memory" | "skill" | "knowledge">;
}

export interface Evidence {
  source: string;
  sourceId?: string;
  content: string;
  stance: "supports" | "refutes" | "neutral";
  weight: number;
}

export interface L4CognitiveOutput {
  hypotheses: Hypothesis[];
  synthesizedKnowledgeIds: string[];
  proposalIds: string[];
  metaCognition: Record<string, unknown>;
}

interface L4ContextAsset {
  id: string;
  layer: "rule" | "skill" | "memory" | "knowledge";
  title: string;
  content: string;
  originScope: string;
  availabilityScope: string;
}

export async function runCognitiveEngine(input: {
  tenantId: string;
  scope: string;
  traceId: string;
  newRuleIds: string[];
  newMemoryIds: string[];
  newSkillIds: string[];
  newKnowledgeIds: string[];
  l3Signals: Array<{
    entryId: string;
    layer: string;
    signalKind: string;
    signalData: Record<string, unknown>;
    title: string;
    content: string;
  }>;
  sessionSummary?: string;
  /**
   * P4 回看全批次：把本次治理批次的候选内容直接传给 L4，让 L4 在生成 synthesized
   * knowledge 时不必依赖 new*Ids 反查 DB，能看到候选阶段完整内容（包括 layer_links
   * 派生对的关联信息）。
   *
   * 不传时回退到旧行为（仅按 new*Ids 反查 assets）。
   */
  batchCandidates?: {
    rules?: Array<{ id: string; title: string; content: string }>;
    memories?: Array<{ id: string; title: string; content: string }>;
    skills?: Array<{ id: string; title: string; content: string }>;
    knowledge?: Array<{ id: string; title: string; content: string }>;
    /**
     * 本批次跨层派生关系（同源 source_timestamp 的 Rule+Memory 对）。
     * L4 识别"复合信号模式"作为更高阶合成知识候选。
     */
    layerLinks?: Array<{
      sourceId: string;
      sourceLayer: "rule" | "skill" | "knowledge" | "memory";
      targetId: string;
      targetLayer: "rule" | "skill" | "knowledge" | "memory";
      linkType: "derived_from" | "explains" | "constrains" | "provenance";
      reason?: string;
    }>;
  };
}): Promise<L4CognitiveOutput> {
  const assets = await collectContextAssets(input);
  // 反馈学习：加载历史被 Reject 的 (synthesis_type, hypothesis_type) 组合
  // 这些组合在生成假设时会被降权，避免重复产出被人工否决的假设方向
  const rejectedCombos = await loadRejectedHypothesisCombos(input);
  const hypotheses = await generateHypotheses(input, assets);
  const validatedHypotheses: Hypothesis[] = [];

  for (const hypothesis of hypotheses) {
    // 反馈学习：如果该假设类型曾被 Reject，降低初始置信度
    const comboKey = `${hypothesis.layer}:${hypothesis.type}`;
    const rejectCount = rejectedCombos.get(comboKey) ?? 0;
    if (rejectCount > 0) {
      const penalty = Math.min(rejectCount * 0.1, 0.3);
      hypothesis.initialConfidence = Math.max(0.1, hypothesis.initialConfidence - penalty);
    }
    const validated = await validateHypothesis(input, hypothesis, assets);
    if (validated.finalConfidence > 0.3) {
      validatedHypotheses.push(validated);
    }
  }

  validatedHypotheses.sort((a, b) => b.finalConfidence - a.finalConfidence);

  const synthesizedKnowledgeIds: string[] = [];
  const proposalIds: string[] = [];

  for (const h of validatedHypotheses) {
    if (h.layer === "pattern" || h.layer === "causation") {
      const skId = await persistSynthesizedKnowledge(input, h);
      if (skId) synthesizedKnowledgeIds.push(skId);
    } else if (h.layer === "strategy") {
      const pId = await persistStrategyProposal(input, h);
      if (pId) proposalIds.push(pId);
    }
  }

  const metaCognition = buildMetaCognition(validatedHypotheses);

  return {
    hypotheses: validatedHypotheses,
    synthesizedKnowledgeIds,
    proposalIds,
    metaCognition,
  };
}

async function collectContextAssets(input: {
  tenantId: string;
  scope: string;
}): Promise<L4ContextAsset[]> {
  const pool = getPool();
  const assets: L4ContextAsset[] = [];

  const rules = await pool.query(
    `SELECT id, title, statement, origin_scope, availability_scope FROM rule
     WHERE tenant_id = $1 AND scope = $2 AND status = 'active' LIMIT 100`,
    [input.tenantId, input.scope]
  );
  for (const r of rules.rows) {
    assets.push({
      id: String(r.id), layer: "rule", title: String(r.title ?? ""),
      content: String(r.statement ?? ""),
      originScope: String(r.origin_scope ?? ""), availabilityScope: String(r.availability_scope ?? ""),
    });
  }

  const memories = await pool.query(
    `SELECT id, title, content, origin_scope, availability_scope FROM memory
     WHERE tenant_id = $1 AND scope = $2 AND status = 'active' LIMIT 100`,
    [input.tenantId, input.scope]
  );
  for (const m of memories.rows) {
    assets.push({
      id: String(m.id), layer: "memory", title: String(m.title ?? ""),
      content: String(m.content ?? ""),
      originScope: String(m.origin_scope ?? ""), availabilityScope: String(m.availability_scope ?? ""),
    });
  }

  const skills = await pool.query(
    `SELECT id, title, description, origin_scope, availability_scope FROM skill
     WHERE tenant_id = $1 AND scope = $2 AND status = 'active' LIMIT 100`,
    [input.tenantId, input.scope]
  );
  for (const s of skills.rows) {
    assets.push({
      id: String(s.id), layer: "skill", title: String(s.title ?? ""),
      content: String(s.description ?? ""),
      originScope: String(s.origin_scope ?? ""), availabilityScope: String(s.availability_scope ?? ""),
    });
  }

  const knowledge = await pool.query(
    `SELECT id, title, content, knowledge_type FROM kp_synthesized_knowledge
     WHERE tenant_id = $1 AND scope = $2 AND status = 'active'
     AND lifecycle_state = 'curated' AND recall_state = 'active' LIMIT 50`,
    [input.tenantId, input.scope]
  );
  for (const k of knowledge.rows) {
    assets.push({
      id: String(k.id), layer: "knowledge", title: String(k.title ?? ""),
      content: String(k.content ?? ""),
      originScope: "knowledge", availabilityScope: "knowledge",
    });
  }

  return assets;
}

async function generateHypotheses(
  input: {
    tenantId: string;
    scope: string;
    traceId: string;
    newRuleIds: string[];
    newMemoryIds: string[];
    newSkillIds: string[];
    l3Signals: Array<{
      entryId: string;
      layer: string;
      signalKind: string;
      signalData: Record<string, unknown>;
      title: string;
      content: string;
    }>;
    batchCandidates?: {
      rules?: Array<{ id: string; title: string; content: string }>;
      memories?: Array<{ id: string; title: string; content: string }>;
      skills?: Array<{ id: string; title: string; content: string }>;
      knowledge?: Array<{ id: string; title: string; content: string }>;
      layerLinks?: Array<{
        sourceId: string;
        sourceLayer: "rule" | "skill" | "knowledge" | "memory";
        targetId: string;
        targetLayer: "rule" | "skill" | "knowledge" | "memory";
        linkType: "derived_from" | "explains" | "constrains" | "provenance";
        reason?: string;
      }>;
    };
  },
  assets: L4ContextAsset[]
): Promise<Hypothesis[]> {
  const hypotheses: Hypothesis[] = [];

  // ① 跨层关联假设：新 Rule 与已有 Memory/Skill 内容重叠
  const newRules = assets.filter((a) => a.layer === "rule" && input.newRuleIds.includes(a.id));
  const existingMemories = assets.filter((a) => a.layer === "memory" && !input.newMemoryIds.includes(a.id));
  const existingSkills = assets.filter((a) => a.layer === "skill" && !input.newSkillIds.includes(a.id));

  for (const rule of newRules) {
    const ruleKeywords = extractKeywords(rule.content);
    for (const memory of existingMemories) {
      const memKeywords = extractKeywords(memory.content);
      const overlap = ruleKeywords.filter((k) => memKeywords.includes(k));
      if (overlap.length >= 3) {
        hypotheses.push({
          id: `hypo-${rule.id}-${memory.id}`,
          type: "cross_layer_correlation",
          title: `规则"${rule.title}"与记忆"${memory.title}"存在强关联`,
          description: `新规则和已有记忆共享关键词：${overlap.join("、")}。可能暗示该领域存在系统性风险或模式。`,
          initialConfidence: 0.6,
          evidence: [],
          finalConfidence: 0,
          reasoningChain: [],
          conclusion: "",
          layer: "pattern",
          sourceIds: [rule.id, memory.id],
          sourceLayer: "rule",
          sourceAssetLayers: ["rule", "memory"],
        });
      }
    }

    for (const skill of existingSkills) {
      const skillKeywords = extractKeywords(skill.content);
      const overlap = ruleKeywords.filter((k) => skillKeywords.includes(k));
      if (overlap.length >= 3) {
        hypotheses.push({
          id: `hypo-${rule.id}-${skill.id}`,
          type: "cross_layer_correlation",
          title: `规则"${rule.title}"与技能"${skill.title}"存在执行依赖`,
          description: `新规则的关键词与已有技能高度重叠：${overlap.join("、")}。规则执行可能依赖该技能。`,
          initialConfidence: 0.65,
          evidence: [],
          finalConfidence: 0,
          reasoningChain: [],
          conclusion: "",
          layer: "pattern",
          sourceIds: [rule.id, skill.id],
          sourceLayer: "rule",
          sourceAssetLayers: ["rule", "skill"],
        });
      }
    }
  }

  // ② L3 信号驱动的假设
  for (const signal of input.l3Signals) {
    if (signal.signalKind === "FREQUENT_FAILURE") {
      const data = signal.signalData as { totalTriggers: number; failCount: number; failureRate: number };
      hypotheses.push({
        id: `hypo-fail-${signal.entryId}`,
        type: "recall_anomaly",
        title: `规则"${signal.title}"频繁失败，可能需要修改`,
        description: `该规则触发了${data.totalTriggers}次，失败率${(data.failureRate * 100).toFixed(0)}%。可能规则本身存在问题，或者执行环境发生了变化。`,
        initialConfidence: 0.7,
        evidence: [],
        finalConfidence: 0,
        reasoningChain: [],
        conclusion: "",
        layer: "strategy",
        sourceIds: [signal.entryId],
        sourceLayer: signal.layer,
        sourceAssetLayers: [signal.layer as "rule" | "memory" | "skill" | "knowledge"],
      });
    }

    if (signal.signalKind === "HIGH_DEMAND_UPGRADE") {
      const data = signal.signalData as { recallCount: number };
      hypotheses.push({
        id: `hypo-upgrade-${signal.entryId}`,
        type: "recall_anomaly",
        title: `技能"${signal.title}"高频召回，建议提升为全局级`,
        description: `该技能已被召回${data.recallCount}次，远超项目级技能的常规使用量。可能具有全局价值。`,
        initialConfidence: 0.75,
        evidence: [],
        finalConfidence: 0,
        reasoningChain: [],
        conclusion: "",
        layer: "strategy",
        sourceIds: [signal.entryId],
        sourceLayer: signal.layer,
        sourceAssetLayers: [signal.layer as "rule" | "memory" | "skill" | "knowledge"],
      });
    }

    if (signal.signalKind === "UNUSED") {
      const data = signal.signalData as { daysSinceLastRecall: number; recallCount: number };
      hypotheses.push({
        id: `hypo-unused-${signal.entryId}`,
        type: "recall_anomaly",
        title: `"${signal.title}"已${data.daysSinceLastRecall}天未被召回`,
        description: `该${signal.layer}曾经被召回${data.recallCount}次，但已${data.daysSinceLastRecall}天无访问。可能已过时或被其他条目覆盖。`,
        initialConfidence: 0.55,
        evidence: [],
        finalConfidence: 0,
        reasoningChain: [],
        conclusion: "",
        layer: "strategy",
        sourceIds: [signal.entryId],
        sourceLayer: signal.layer,
        sourceAssetLayers: [signal.layer as "rule" | "memory" | "skill" | "knowledge"],
      });
    }
  }

  // ③ 矛盾检测假设：两条 active 规则内容相似但存在否定差异
  const allRules = assets.filter((a) => a.layer === "rule");
  for (let i = 0; i < allRules.length; i++) {
    for (let j = i + 1; j < allRules.length; j++) {
      const a = allRules[i];
      const b = allRules[j];
      if (a.id === b.id) continue;
      const similarity = jaccardSimilarity(a.content, b.content);
      if (similarity > 0.5 && hasNegationDifference(a.content, b.content)) {
        hypotheses.push({
          id: `hypo-contradiction-${a.id}-${b.id}`,
          type: "contradiction",
          title: `规则"${a.title}"与"${b.title}"可能存在矛盾`,
          description: `两条规则内容相似度${(similarity * 100).toFixed(0)}%，但检测到否定/肯定差异，可能在某些场景下互相冲突。`,
          initialConfidence: 0.65,
          evidence: [],
          finalConfidence: 0,
          reasoningChain: [],
          conclusion: "",
          layer: "causation",
          sourceIds: [a.id, b.id],
          sourceLayer: "rule",
          sourceAssetLayers: ["rule", "rule"],
        });
      }
    }
  }

  // ④ 知识缺口假设：新 Memory 提到了某个概念，但知识图谱里没有
  const newMemories = assets.filter((a) => a.layer === "memory" && input.newMemoryIds.includes(a.id));
  const existingKnowledge = assets.filter((a) => a.layer === "knowledge");
  for (const mem of newMemories) {
    const memKeywords = extractKeywords(mem.content);
    const knowledgeKeywords = new Set(existingKnowledge.flatMap((k) => extractKeywords(k.content)));
    const missingKeywords = memKeywords.filter((k) => !knowledgeKeywords.has(k));
    if (missingKeywords.length >= 3) {
      hypotheses.push({
        id: `hypo-gap-${mem.id}`,
        type: "knowledge_gap",
        title: `知识图谱缺少"${missingKeywords.slice(0, 3).join("、")}"相关条目`,
        description: `新记忆提到了这些概念，但知识图谱中没有相关条目。可能存在知识盲区。`,
        initialConfidence: 0.5,
        evidence: [],
        finalConfidence: 0,
        reasoningChain: [],
        conclusion: "",
        layer: "pattern",
          sourceIds: [mem.id],
          sourceLayer: "memory",
          sourceAssetLayers: ["memory"],
        });
    }
  }

  // ⑤ P4 复合信号模式假设：基于本批次 layer_links 派生关系，识别"复合信号"模式。
  // 一条复合信号（如 PowerShell UTF-8 乱码）同时派生 Rule（硬门控）+ Memory（事实根因），
  // L4 把这种结构本身作为一个更高阶的 synthesized knowledge 候选：
  // "在 X 类场景，事实根因 + 运行时门控必须成对存在，缺失任一会重蹈覆辙"。
  const layerLinks = input.batchCandidates?.layerLinks ?? [];
  const batchRules = input.batchCandidates?.rules ?? [];
  const batchMemories = input.batchCandidates?.memories ?? [];
  for (const link of layerLinks) {
    if (link.linkType !== "derived_from") continue;
    if (link.sourceLayer !== "rule" || link.targetLayer !== "memory") continue;
    const rule = batchRules.find((r) => r.id === link.sourceId);
    const memory = batchMemories.find((m) => m.id === link.targetId);
    if (!rule || !memory) continue;
    const ruleKeywords = extractKeywords(rule.content);
    const memKeywords = extractKeywords(memory.content);
    const overlap = ruleKeywords.filter((k) => memKeywords.includes(k));
    if (overlap.length < 2) continue;
    hypotheses.push({
      id: `hypo-composite-${link.sourceId}-${link.targetId}`,
      type: "cross_layer_correlation",
      title: `复合信号模式：${rule.title} 与 ${memory.title} 同源派生`,
      description: `本批次检测到一条复合信号同时派生为 Rule（运行时门控）和 Memory（事实根因），共享关键词：${overlap.join("、")}。` +
        `这种"事实根因 + 硬门控"成对存在的模式，是认知沉淀的关键标志：缺失任一会导致同一失败模式重复发生。` +
        (link.reason ? `派生理由：${link.reason}` : ""),
      initialConfidence: 0.7,
      evidence: [],
      finalConfidence: 0,
      reasoningChain: [],
      conclusion: "",
      layer: "causation",
      sourceIds: [link.sourceId, link.targetId],
      sourceLayer: "rule",
      sourceAssetLayers: ["rule", "memory"],
    });
  }

  return hypotheses;
}

async function validateHypothesis(
  input: { tenantId: string; scope: string; traceId: string },
  hypothesis: Hypothesis,
  assets: L4ContextAsset[]
): Promise<Hypothesis> {
  const evidence: Evidence[] = [];
  const reasoningChain: string[] = [];

  // Round 1: 收集初始证据
  reasoningChain.push(`[R1] 假设初始置信度: ${(hypothesis.initialConfidence * 100).toFixed(0)}%`);

  // 从 L3 信号中找支持证据
  if (hypothesis.type === "recall_anomaly") {
    const targetId = hypothesis.sourceIds[0];
    if (targetId) {
      const counts = await countAccessByObjectRef({
        tenantId: input.tenantId,
        scope: input.scope,
        objectType: hypothesis.sourceLayer ?? "rule",
        objectRefs: [targetId],
      });
      const count = counts[targetId] ?? 0;
      if (count > 0) {
        evidence.push({
          source: "memory_access_log",
          sourceId: targetId,
          content: `该对象被访问了${count}次`,
          stance: "supports",
          weight: 0.3,
        });
      }
    }
  }

  // 从已有资产中找关联证据
  const hypoKeywords = extractKeywords(hypothesis.description);
  for (const asset of assets) {
    const assetKeywords = extractKeywords(asset.content);
    const overlap = hypoKeywords.filter((k) => assetKeywords.includes(k));
    if (overlap.length >= 2) {
      evidence.push({
        source: `${asset.layer}:${asset.title}`,
        sourceId: asset.id,
        content: `${asset.layer}层条目"${asset.title}"共享关键词：${overlap.join("、")}`,
        stance: "supports",
        weight: 0.2,
      });
    }
  }

  // contradiction 专门证据：确认两条源规则确实存在且内容相似
  if (hypothesis.type === "contradiction" && hypothesis.sourceIds.length >= 2) {
    const ruleA = assets.find((a) => a.id === hypothesis.sourceIds[0] && a.layer === "rule");
    const ruleB = assets.find((a) => a.id === hypothesis.sourceIds[1] && a.layer === "rule");
    if (ruleA && ruleB) {
      const sim = jaccardSimilarity(ruleA.content, ruleB.content);
      const hasNeg = hasNegationDifference(ruleA.content, ruleB.content);
      if (hasNeg) {
        evidence.push({
          source: "rule_pair_analysis",
          sourceId: ruleA.id,
          content: `两条规则内容相似度${(sim * 100).toFixed(0)}%，且检测到否定/肯定差异：A="${ruleA.content.slice(0, 30)}..." B="${ruleB.content.slice(0, 30)}..."`,
          stance: "supports",
          weight: 0.5,
        });
      }
      // 检查是否有门禁审计记录显示冲突（只取最近 60 天，避免历史噪声）
      const auditCount = await getPool().query(
        `SELECT COUNT(*) AS cnt FROM rule_gate_audit
         WHERE tenant_id = $1 AND scope = $2 AND rule_id IN ($3, $4)
         AND decision = 'blocked'
         AND created_at >= NOW() - INTERVAL '60 days'`,
        [input.tenantId, input.scope, ruleA.id, ruleB.id]
      );
      const blockedCount = Number(auditCount.rows[0]?.cnt ?? 0);
      if (blockedCount > 0) {
        evidence.push({
          source: "rule_gate_audit",
          sourceId: ruleA.id,
          content: `这两条规则共有${blockedCount}次被门禁拦截的记录，说明确实存在执行冲突`,
          stance: "supports",
          weight: 0.4,
        });
      }
    }
  }

  // knowledge_gap 专门证据：确认知识图谱确实缺少相关条目，且其他记忆也提到相同概念
  if (hypothesis.type === "knowledge_gap" && hypothesis.sourceIds.length >= 1) {
    const sourceMem = assets.find((a) => a.id === hypothesis.sourceIds[0] && a.layer === "memory");
    if (sourceMem) {
      const memKeywords = extractKeywords(sourceMem.content);
      // 检查其他记忆是否也提到这些关键词（说明是普遍存在的知识缺口）
      const otherMentions = assets.filter((a) =>
        a.layer === "memory" && a.id !== sourceMem.id &&
        memKeywords.some((k) => extractKeywords(a.content).includes(k))
      );
      if (otherMentions.length > 0) {
        evidence.push({
          source: "memory_cross_reference",
          sourceId: sourceMem.id,
          content: `另有${otherMentions.length}条记忆也提到相关概念（${otherMentions.slice(0, 2).map((m) => m.title).join("、")}），说明该知识缺口具有普遍性`,
          stance: "supports",
          weight: 0.4,
        });
      }
      // 检查规则层是否也提到这些关键词（说明规则执行可能缺乏知识支撑）
      const ruleMentions = assets.filter((a) =>
        a.layer === "rule" &&
        memKeywords.some((k) => extractKeywords(a.content).includes(k))
      );
      if (ruleMentions.length > 0) {
        evidence.push({
          source: "rule_dependency",
          sourceId: ruleMentions[0]?.id,
          content: `有${ruleMentions.length}条规则也涉及这些概念，但知识图谱缺少对应条目，规则执行可能缺乏知识支撑`,
          stance: "supports",
          weight: 0.3,
        });
      }
    }
  }

  reasoningChain.push(`[R1] 收集到${evidence.length}条初始证据`);

  // Round 2: 矛盾检测
  const existingSynthesis = await getPool().query(
    `SELECT id, title, content FROM kp_synthesized_knowledge
     WHERE tenant_id = $1 AND scope = $2 AND status = 'active'
     AND knowledge_type = 'synthesis' LIMIT 20`,
    [input.tenantId, input.scope]
  );

  let contradicted = false;
  for (const syn of existingSynthesis.rows) {
    const synContent = String(syn.content ?? "");
    if (hasNegationDifference(hypothesis.description, synContent) &&
        jaccardSimilarity(hypothesis.description, synContent) > 0.4) {
      evidence.push({
        source: `existing_synthesis:${syn.title}`,
        sourceId: String(syn.id),
        content: `已有合成知识"${syn.title}"与本假设存在矛盾`,
        stance: "refutes",
        weight: 0.4,
      });
      contradicted = true;
    }
  }
  reasoningChain.push(`[R2] 矛盾检测: ${contradicted ? "发现矛盾，降低置信度" : "未发现矛盾"}`);

  // Round 3: 证伪尝试
  let refutationFound = false;
  if (hypothesis.type === "cross_layer_correlation") {
    const ruleId = hypothesis.sourceIds[0];
    const otherId = hypothesis.sourceIds[1];
    if (ruleId && otherId) {
      const relationExists = await getPool().query(
        `SELECT 1 FROM kp_relation
         WHERE tenant_id = $1 AND scope = $2
         AND relation_type = 'conflicts_with'
         AND ((from_object_id = $3 AND to_object_id = $4)
           OR (from_object_id = $4 AND to_object_id = $3))
         LIMIT 1`,
        [input.tenantId, input.scope, ruleId, otherId]
      );
      if (relationExists.rows.length > 0) {
        evidence.push({
          source: "kp_relation",
          sourceId: ruleId,
          content: "已存在conflicts_with关系，可能不是关联而是冲突",
          stance: "refutes",
          weight: 0.3,
        });
        refutationFound = true;
      }
    }
  }
  reasoningChain.push(`[R3] 证伪尝试: ${refutationFound ? "找到反例" : "未找到反例"}`);

  // Round 4: 置信度评估
  const supportWeight = evidence
    .filter((e) => e.stance === "supports")
    .reduce((sum, e) => sum + e.weight, 0);
  const refuteWeight = evidence
    .filter((e) => e.stance === "refutes")
    .reduce((sum, e) => sum + e.weight, 0);

  const evidenceScore = Math.min(supportWeight, 1) - Math.min(refuteWeight, 0.8);
  const finalConfidence = Math.max(0, Math.min(1,
    hypothesis.initialConfidence * 0.5 + evidenceScore * 0.5
  ));

  reasoningChain.push(`[R4] 置信度评估: 初始=${(hypothesis.initialConfidence * 100).toFixed(0)}%, 证据得分=${evidenceScore.toFixed(2)}, 最终=${(finalConfidence * 100).toFixed(0)}%`);

  // 生成结论
  const conclusion = buildConclusion(hypothesis, evidence, finalConfidence);
  reasoningChain.push(`[结论] ${conclusion}`);

  return {
    ...hypothesis,
    evidence,
    finalConfidence,
    reasoningChain,
    conclusion,
  };
}

async function persistSynthesizedKnowledge(
  input: { tenantId: string; scope: string; traceId: string },
  hypothesis: Hypothesis
): Promise<string | null> {
  const knowledgeType = hypothesis.layer === "causation" ? "synthesis" : "pattern";

  // fix-9: memory-service 是 MCP 插件后端，不自己调 LLM
  // KnowledgeModelWorker.synthesize 已废弃（return null），本路径直接走 template_fallback
  // LLM 合成由宿主侧通过 host_model_result 通道完成，本路径只产出 audit_only 候选
  const content = `${hypothesis.title}\n\n${hypothesis.description}\n\n推理过程：\n${hypothesis.reasoningChain.join("\n")}\n\n结论：${hypothesis.conclusion}`;
  const reasoningSummary = hypothesis.reasoningChain.join(" → ");
  const confidenceScore = hypothesis.finalConfidence;
  const riskLevel: "low" | "medium" | "high" | "critical" = hypothesis.layer === "causation" ? "medium" : "low";
  const recallState: "active" | "inactive" | "audit_only" = "audit_only";
  const synthesisMethod: "llm" | "template_fallback" = "template_fallback";

  // 写入时富化 normalized_content：把假设描述、证据内容、source 关键词都拍平进去
  // 这样 retrieve 的 ILIKE 匹配能命中更多相关 term，不需要降低 minMatchCount 门槛
  // 治理侧负责产出质量（包括可检索性），检索侧策略不变，职责不越界
  const evidenceText = hypothesis.evidence.map((e) => e.content).join(" ");
  const sourceKeywords = hypothesis.sourceIds.length > 0
    ? hypothesis.sourceIds.join(" ")
    : "";
  const enrichedContent = `${content}\n\n证据：${evidenceText}\n\n关联对象：${sourceKeywords}`;
  const normalizedContent = enrichedContent.toLowerCase().replace(/\s+/g, " ").trim();

  try {
    const result = await createSynthesizedKnowledge({
      tenantId: input.tenantId,
      scope: input.scope,
      knowledgeType,
      title: hypothesis.title,
      content,
      normalizedContent,
      reasoningSummary,
      confidenceScore,
      riskLevel,
      // source_object_ids 存真正的对象 ID，供 L3 遗忘机制反查依赖是否还 active
      sourceObjectIds: hypothesis.sourceIds,
      // evidence_ids 在下方通过 kp_synthesized_knowledge_evidence 关联表建立，
      // 这里先留空数组，避免在 createSynthesizedKnowledge 阶段做 N+1 写入
      evidenceIds: [],
      // 合成知识写入即进入 curated，但 review_state=pending_review 不被召回
      // 必须人工审批为 human_approved 后才能被 retrieve 召回
      // LLM 降级时 recallState=audit_only，即使审批也不进 active recall
      lifecycleState: "curated",
      reviewState: "pending_review",
      recallState,
      // 设置 scope 字段，让 retrievalHook 的 shouldRecall 能通过
      // 合成知识默认项目级可用，审批激活后可被同项目 retrieve 召回
      originScope: "project",
      availabilityScope: "project_reusable",
      // metadata 通过共享类型构造，L3 读取时字段名一致
      metadata: {
        ...buildSynthesizedKnowledgeMetadata({
          hypothesisType: hypothesis.type,
          l4Layer: hypothesis.layer,
          initialConfidence: hypothesis.initialConfidence,
          finalConfidence: hypothesis.finalConfidence,
          evidenceCount: hypothesis.evidence.length,
          reasoningChain: hypothesis.reasoningChain,
          sourceIds: hypothesis.sourceIds,
          sourceLayer: hypothesis.sourceLayer as "rule" | "memory" | "skill" | "knowledge" | undefined,
          // 把每个 source id 真实所属的层传给 contracts，让 L3 按层分桶查不同表
          sourceAssetLayers: hypothesis.sourceAssetLayers,
        }) as Record<string, unknown>,
        synthesis_method: synthesisMethod,
      },
      traceId: input.traceId,
    });

    // 把 L4 推理过程中收集的 evidence 持久化到 kp_evidence 表，
    // 并通过 kp_synthesized_knowledge_evidence 建立关联，
    // 让知识图谱能展示 L4 → evidence 的推理依赖
    const synthId = result.id;
    const persistedEvidenceIds: string[] = [];
    for (const ev of hypothesis.evidence) {
      try {
        // evidence.source 是来源对象类型（rule/memory/skill/knowledge），
        // 用 source_uri 区分不同来源；content 是证据文本
        const sourceUri = `l4://evidence/${ev.source ?? "unknown"}/${synthId}`;
        const evidenceId = await createKnowledgeEvidence({
          tenantId: input.tenantId,
          scope: input.scope,
          memoryDomain: "knowledge",
          evidenceType: "l4_reasoning_trace",
          sourceType: ev.source ?? "l4_cognitive_engine",
          sourceUri,
          contentExcerpt: String(ev.content ?? "").slice(0, 1000),
          trustLevel: ev.stance === "supports" ? "internal_verified" : "internal_unverified",
          metadata: {
            stance: ev.stance,
            weight: ev.weight,
            l4_hypothesis_id: synthId,
            l4_layer: hypothesis.layer,
            source_object_id: ev.sourceId ?? null,
            source_layer: hypothesis.sourceLayer ?? null,
            reasoning_step: ev.content,
          },
          traceId: input.traceId,
        });
        // 建立关联：synthesized_knowledge_id → evidence_id
        // source_object_type 用 ev.source（来源层），source_object_id 用 ev.sourceId（如果有）
        await linkSynthesizedKnowledgeEvidence({
          tenantId: input.tenantId,
          scope: input.scope,
          synthesizedKnowledgeId: synthId,
          evidenceId,
          sourceObjectType: ev.source ?? "l4_cognitive_engine",
          sourceObjectId: ev.sourceId ?? synthId,
          supportRole: ev.stance === "supports" ? "supports" : "refutes",
          traceId: input.traceId,
        });
        persistedEvidenceIds.push(evidenceId);
      } catch (linkErr) {
        // 单条 evidence 关联失败不阻塞主流程，记录错误继续
        console.error("[L4] linkSynthesizedKnowledgeEvidence failed:", linkErr);
      }
    }

    // 更新合成知识的 evidence_ids 字段（让 retrieve 链路也能读到关联的 evidence id）
    if (persistedEvidenceIds.length > 0) {
      try {
        const pool = getPool();
        await pool.query(
          `UPDATE kp_synthesized_knowledge
           SET evidence_ids = $3::jsonb
           WHERE id = $1 AND tenant_id = $2 AND scope = $4`,
          [synthId, input.tenantId, JSON.stringify(persistedEvidenceIds), input.scope]
        );
      } catch (updErr) {
        console.error("[L4] update evidence_ids failed:", updErr);
      }
    }

    return synthId;
  } catch (error) {
    console.error("[L4] persistSynthesizedKnowledge failed:", error);
    return null;
  }
}

async function persistStrategyProposal(
  input: { tenantId: string; scope: string; traceId: string },
  hypothesis: Hypothesis
): Promise<string | null> {
  try {
    const proposalId = await createGovernanceChangeProposal({
      tenantId: input.tenantId,
      scope: input.scope,
      targetObjectType: "strategy",
      proposedAction: "l4_cognitive_strategy",
      proposedPayload: {
        hypothesis_id: hypothesis.id,
        hypothesis_type: hypothesis.type,
        title: hypothesis.title,
        description: hypothesis.description,
        conclusion: hypothesis.conclusion,
        confidence: hypothesis.finalConfidence,
        reasoning_chain: hypothesis.reasoningChain,
        evidence: hypothesis.evidence,
      },
      reason: `L4认知引擎：${hypothesis.conclusion}`,
      riskLevel: hypothesis.finalConfidence > 0.7 ? "medium" : "high",
      traceId: input.traceId,
      originScope: "session",
      availabilityScope: "session_only",
      promotionStatus: "needs_review",
      governanceLevel: "session",
      proposedActionType: "add",
    });
    return proposalId;
  } catch (error) {
    console.error("[L4] persistStrategyProposal failed:", error);
    return null;
  }
}

function buildMetaCognition(hypotheses: Hypothesis[]): Record<string, unknown> {
  const byType: Record<string, number> = {};
  const byLayer: Record<string, number> = {};
  let totalConfidence = 0;

  for (const h of hypotheses) {
    byType[h.type] = (byType[h.type] ?? 0) + 1;
    byLayer[h.layer] = (byLayer[h.layer] ?? 0) + 1;
    totalConfidence += h.finalConfidence;
  }

  return {
    total_hypotheses: hypotheses.length,
    by_type: byType,
    by_layer: byLayer,
    avg_confidence: hypotheses.length > 0 ? totalConfidence / hypotheses.length : 0,
    high_confidence_count: hypotheses.filter((h) => h.finalConfidence > 0.7).length,
    low_confidence_count: hypotheses.filter((h) => h.finalConfidence < 0.4).length,
  };
}

function buildConclusion(h: Hypothesis, evidence: Evidence[], confidence: number): string {
  const supports = evidence.filter((e) => e.stance === "supports").length;
  const refutes = evidence.filter((e) => e.stance === "refutes").length;
  const confPct = (confidence * 100).toFixed(0);

  if (confidence > 0.7) {
    return `${h.title}。置信度${confPct}%（支持证据${supports}条，反驳证据${refutes}条），建议采纳。`;
  } else if (confidence > 0.4) {
    return `${h.title}。置信度${confPct}%，证据不够充分，建议人工审查后决定。`;
  } else {
    return `${h.title}。置信度仅${confPct}%，证据不足或存在矛盾，暂不采纳。`;
  }
}

function extractKeywords(text: string): string[] {
  // 中文停用词表（高频功能字 + 虚词）：与 L3EvolutionScanner 保持一致
  // 之前是单字符分词 + 13 字停用词，导致"组件拆分"→"组/件/拆/分"
  // 与 L3 的 bigram + 90 字停用词不对齐，同一流水线算出不一致的关联
  const stopWords = new Set([
    // 虚词
    "的", "了", "在", "是", "和", "就", "不", "都", "一", "上", "也", "到", "要",
    "与", "或", "及", "等", "之", "其", "此", "那", "这", "被", "把", "让", "使",
    "给", "对", "由", "从", "向", "为", "以", "可", "能", "会", "需", "应", "该",
    // 高频功能字（技术文本里到处都是，无区分度）
    "用", "做", "进", "行", "完", "成", "产", "生", "生", "设", "定", "配", "置",
    "类", "型", "种", "项", "个", "条", "件", "组", "器", "端", "点", "面", "方",
    "前", "后", "中", "内", "外", "下", "同", "异", "等", "级", "层", "步", "次",
    "部", "分", "全", "整", "单", "双", "多", "少", "大", "小", "长", "短", "高",
    "低", "新", "旧", "原", "始", "初", "终", "首", "末", "本", "身", "自", "相",
    // 英文停用词
    "the", "a", "an", "is", "are", "was", "were", "be", "if", "then", "and", "or",
    "not", "but", "in", "on", "at", "to", "for", "must", "should", "may", "with",
    "use", "using", "used", "via", "per", "each", "all", "any", "some", "this", "that",
  ]);

  // 英文 token：提取 ASCII 字母+数字组成的单词
  const englishTokens = (text.match(/[a-zA-Z][a-zA-Z0-9_]{1,}/g) ?? [])
    .map((t) => t.toLowerCase())
    .filter((t) => t.length > 1 && !stopWords.has(t));

  // 中文 bigram（2字滑窗）：与 L3 对齐，替代原来的单字符分词
  const cjkText = text.replace(/[^\u4e00-\u9fff]/g, "");
  const cjkBigrams: string[] = [];
  for (let i = 0; i < cjkText.length - 1; i++) {
    const bigram = cjkText.slice(i, i + 2);
    if (stopWords.has(bigram[0]) || stopWords.has(bigram[1])) continue;
    cjkBigrams.push(bigram);
  }

  return [...englishTokens, ...cjkBigrams].slice(0, 25);
}

function jaccardSimilarity(a: string, b: string): number {
  const setA = new Set(extractKeywords(a));
  const setB = new Set(extractKeywords(b));
  if (setA.size === 0 || setB.size === 0) return 0;
  let intersection = 0;
  for (const token of setA) {
    if (setB.has(token)) intersection++;
  }
  return intersection / (setA.size + setB.size - intersection);
}

function hasNegationDifference(a: string, b: string): boolean {
  const negPattern = /禁止|不得|不能|不要|must\s*not|don't|never|不允许|不可以/gi;
  const posPattern = /必须|应当|应该|要|需要|must|should|shall|allow|permit/gi;
  const aNeg = a.match(negPattern) ?? [];
  const bNeg = b.match(negPattern) ?? [];
  const aPos = a.match(posPattern) ?? [];
  const bPos = b.match(posPattern) ?? [];
  return (aNeg.length > 0 && bPos.length > 0 && bNeg.length === 0) ||
         (bNeg.length > 0 && aPos.length > 0 && aNeg.length === 0);
}

/**
 * 反馈学习：加载历史被 Reject 的 (l4_layer, hypothesis_type) 组合
 *
 * 数据来源：kp_synthesized_knowledge 表中 review_state = 'rejected' 的记录
 * 这些记录的 metadata 里存了 l4_layer 和 hypothesis_type
 * 返回一个 Map<comboKey, rejectCount>，用于生成假设时降权
 *
 * 衰减机制：只查 rejected_at >= NOW() - INTERVAL '90 days' 的记录
 * 90 天窗口内的 Reject 才降权，之前的自动失效
 * 历史 reject（rejected_at 为 NULL）不进入窗口，等同于已衰减
 *
 * 降权策略：每次 Reject 扣 0.1 初始置信度，最多扣 0.3
 */
async function loadRejectedHypothesisCombos(input: {
  tenantId: string;
  scope: string;
}): Promise<Map<string, number>> {
  const pool = getPool();
  const result = await pool.query(
    `SELECT metadata
     FROM kp_synthesized_knowledge
     WHERE tenant_id = $1 AND scope = $2
     AND review_state = 'rejected'
     AND rejected_at >= NOW() - INTERVAL '90 days'
     AND metadata ? 'l4_layer'
     AND metadata ? 'hypothesis_type'`,
    [input.tenantId, input.scope]
  );

  const combos = new Map<string, number>();
  for (const row of result.rows) {
    const meta = row.metadata ?? {};
    const layer = typeof meta.l4_layer === "string" ? meta.l4_layer : "";
    const type = typeof meta.hypothesis_type === "string" ? meta.hypothesis_type : "";
    if (layer && type) {
      const key = `${layer}:${type}`;
      combos.set(key, (combos.get(key) ?? 0) + 1);
    }
  }
  return combos;
}

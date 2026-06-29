/**
 * 治理流水线编排器
 *
 * 将 L2 冲突检测、L3 演进扫描、L4 认知引擎串联到治理流程中：
 *
 *   候选写入前 → L2 冲突检测（过滤/合并/挂起）
 *   候选写入后 → L3 演进扫描（信号发现 + 关系构建）
 *   L3 完成后  → L4 认知引擎（假设生成 + 推理验证 + 分层产出）
 */

import { detectConflicts, type L2ConflictOutput } from "./L2ConflictDetector.js";
import { scanEvolution, type L3EvolutionOutput } from "./L3EvolutionScanner.js";
import { runCognitiveEngine, type L4CognitiveOutput } from "./L4CognitiveEngine.js";

export interface GovernancePipelineResult {
  l2Conflicts: Array<{
    candidateId: string;
    candidateTitle: string;
    layer: string;
    conflicts: L2ConflictOutput["conflicts"];
    blockingAction: L2ConflictOutput["blockingAction"];
    mergedContent: string | null;
  }>;
  l3Evolution: L3EvolutionOutput;
  l4Cognitive: L4CognitiveOutput;
  skippedByL2: string[];
  mergedByL2: Array<{ candidateId: string; mergedContent: string }>;
}

export async function runGovernancePipeline(input: {
  tenantId: string;
  scope: string;
  traceId: string;

  candidates: Array<{
    id: string;
    layer: "rule" | "memory" | "skill" | "knowledge";
    title: string;
    content: string;
  }>;

  persistedIds: {
    ruleIds: string[];
    memoryIds: string[];
    skillIds: string[];
    knowledgeIds: string[];
  };

  sessionSummary?: string;
}): Promise<GovernancePipelineResult> {
  const l2Conflicts: GovernancePipelineResult["l2Conflicts"] = [];
  const skippedByL2: string[] = [];
  const mergedByL2: Array<{ candidateId: string; mergedContent: string }> = [];

  // ── L2: 冲突检测（写入前） ──────────────────────────
  for (const candidate of input.candidates) {
    try {
      const result = await detectConflicts({
        tenantId: input.tenantId,
        scope: input.scope,
        traceId: input.traceId,
        layer: candidate.layer,
        candidateId: candidate.id,
        candidateTitle: candidate.title,
        candidateContent: candidate.content,
      });

      if (result.conflicts.length > 0) {
        l2Conflicts.push({
          candidateId: candidate.id,
          candidateTitle: candidate.title,
          layer: candidate.layer,
          conflicts: result.conflicts,
          blockingAction: result.blockingAction,
          mergedContent: result.mergedContent,
        });
      }

      if (result.blockingAction === "SKIP") {
        skippedByL2.push(candidate.id);
      } else if (result.mergedContent) {
        mergedByL2.push({
          candidateId: candidate.id,
          mergedContent: result.mergedContent,
        });
      }
    } catch (error) {
      console.error(`[L2] detectConflicts failed for ${candidate.id}:`, error);
    }
  }

  // ── L3: 演进扫描（写入后） ──────────────────────────
  let l3Evolution: L3EvolutionOutput = { signals: [], relations: [], proposalIds: [] };
  try {
    l3Evolution = await scanEvolution({
      tenantId: input.tenantId,
      scope: input.scope,
      traceId: input.traceId,
      newRuleIds: input.persistedIds.ruleIds,
      newMemoryIds: input.persistedIds.memoryIds,
      newSkillIds: input.persistedIds.skillIds,
      newKnowledgeIds: input.persistedIds.knowledgeIds,
    });
  } catch (error) {
    console.error("[L3] scanEvolution failed:", error);
  }

  // ── L4: 认知引擎（L3完成后） ────────────────────────
  let l4Cognitive: L4CognitiveOutput = {
    hypotheses: [],
    synthesizedKnowledgeIds: [],
    proposalIds: [],
    metaCognition: {},
  };
  try {
    l4Cognitive = await runCognitiveEngine({
      tenantId: input.tenantId,
      scope: input.scope,
      traceId: input.traceId,
      newRuleIds: input.persistedIds.ruleIds,
      newMemoryIds: input.persistedIds.memoryIds,
      newSkillIds: input.persistedIds.skillIds,
      newKnowledgeIds: input.persistedIds.knowledgeIds,
      l3Signals: l3Evolution.signals.map((s) => ({
        entryId: s.entryId,
        layer: s.layer,
        signalKind: s.signalKind,
        signalData: s.signalData,
        title: s.title,
        content: s.content,
      })),
      sessionSummary: input.sessionSummary,
    });
  } catch (error) {
    console.error("[L4] runCognitiveEngine failed:", error);
  }

  return {
    l2Conflicts,
    l3Evolution,
    l4Cognitive,
    skippedByL2,
    mergedByL2,
  };
}

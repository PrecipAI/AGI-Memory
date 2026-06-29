/**
 * 合成知识 metadata 的共享类型契约
 *
 * 这个文件是 L4 认知引擎（写入）和 L3 演进扫描器（读取）之间的隐性契约的显式化。
 * L4 在 persistSynthesizedKnowledge 时写入这些字段，
 * L3 的 scanStaleSynthesizedKnowledge 读取这些字段来判断合成知识是否成了"孤立的幽灵"。
 *
 * 如果改了这里的字段名，L4 和 L3 都会在编译期报错，避免静默失效。
 */

export interface SynthesizedKnowledgeMetadata {
  /** 假设类型，对应 L4 的 Hypothesis.type */
  hypothesis_type?: string;
  /** 假设的 L4 层级：pattern | causation | strategy */
  l4_layer?: "pattern" | "causation" | "strategy";
  /** 初始置信度（0-1） */
  initial_confidence?: number;
  /** 最终置信度（0-1） */
  final_confidence?: number;
  /** 证据条数 */
  evidence_count?: number;
  /** 推理链 */
  reasoning_chain?: string[];
  /**
   * 依赖的 source 对象 ID 列表
   * L3 scanStaleSynthesizedKnowledge 读这个字段反查依赖是否还 active
   *
   * 注意：这是"按主层统一标记"的旧字段，当 hypothesis 跨层（如 rule + memory）
   * 时无法区分每个 id 真实属于哪层，会导致 L3 把 memory.id 当成 rule.id 去查 rule 表而误判 stale。
   * 新代码应优先写 dependency_sources_by_layer；本字段保留兼容。
   */
  dependency_source_ids?: string[];
  /**
   * 依赖的 source 对象层级：rule | memory | skill | knowledge
   * L3 根据这个字段决定查哪张表
   *
   * 同上：跨层 hypothesis 时本字段只标"主层"，会导致其他层 id 误判 stale。
   */
  dependency_source_layer?: "rule" | "memory" | "skill" | "knowledge";
  /**
   * 按层分桶的依赖 source id 映射（新字段，优先于上面的旧字段）
   * key 是层名，value 是该层的 id 数组
   * L3 scanStaleSynthesizedKnowledge 优先读这个字段，按层查不同表，避免跨层误判
   */
  dependency_sources_by_layer?: Partial<Record<"rule" | "memory" | "skill" | "knowledge", string[]>>;
}

/**
 * 构造合成知识 metadata 的辅助函数，确保字段名一致
 *
 * sourceAssetLayers 是与 sourceIds 对齐的层名数组，用于跨层 hypothesis：
 * 例如 cross_layer_correlation 的 sourceIds=[rule.id, memory.id] 时，
 * sourceAssetLayers=["rule","memory"]，让 L3 知道每个 id 真实属于哪层。
 */
export function buildSynthesizedKnowledgeMetadata(input: {
  hypothesisType: string;
  l4Layer: "pattern" | "causation" | "strategy";
  initialConfidence: number;
  finalConfidence: number;
  evidenceCount: number;
  reasoningChain: string[];
  sourceIds: string[];
  sourceLayer?: "rule" | "memory" | "skill" | "knowledge";
  /**
   * 与 sourceIds 对齐的层名数组；如果未提供，则全部按 sourceLayer 标注
   */
  sourceAssetLayers?: Array<"rule" | "memory" | "skill" | "knowledge">;
}): SynthesizedKnowledgeMetadata {
  // 按层分桶：sourceAssetLayers 与 sourceIds 对齐，每个 id 落到对应层的桶里
  const byLayer: Partial<Record<"rule" | "memory" | "skill" | "knowledge", string[]>> = {};
  const layers = input.sourceAssetLayers;
  for (let i = 0; i < input.sourceIds.length; i++) {
    const id = input.sourceIds[i];
    const layer = layers?.[i] ?? input.sourceLayer ?? "rule";
    if (!byLayer[layer]) byLayer[layer] = [];
    byLayer[layer]!.push(id);
  }

  return {
    hypothesis_type: input.hypothesisType,
    l4_layer: input.l4Layer,
    initial_confidence: input.initialConfidence,
    final_confidence: input.finalConfidence,
    evidence_count: input.evidenceCount,
    reasoning_chain: input.reasoningChain,
    dependency_source_ids: input.sourceIds,
    dependency_source_layer: input.sourceLayer ?? "rule",
    dependency_sources_by_layer: byLayer,
  };
}

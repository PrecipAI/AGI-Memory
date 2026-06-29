/**
 * L3 演进扫描器
 *
 * 在治理流水线中同步执行，扫描已有四层资产的演进信号：
 *   - UNUSED：曾被召回但已 30 天无访问 → 提议 DEPRECATE
 *   - FREQUENT_FAILURE：Rule 门禁失败率 > 30% → 提议 STRENGTHEN
 *   - HIGH_DEMAND_UPGRADE：Project 级 Skill 召回 > 50 次 → 提议 UPGRADE_SCOPE
 *   - SUPERSEDED：被 supersedes 关系覆盖 → 提议 DEPRECATE
 *   - RELATION_DISCOVERY：跨层关系发现 → 写入 kp_relation
 */

import { getPool } from "@super-agent/db";
import { createGovernanceChangeProposal } from "@super-agent/db";
import { createKnowledgeRelation } from "@super-agent/db";
import type { SynthesizedKnowledgeMetadata } from "@super-agent/contracts";
import {
  countAccessByObjectRef,
  getLastAccessTimeByObjectRef,
} from "@super-agent/db";

export interface StalenessSignal {
  entryId: string;
  layer: "rule" | "skill" | "memory" | "knowledge";
  title: string;
  content: string;
  signalKind: "UNUSED" | "FREQUENT_FAILURE" | "HIGH_DEMAND_UPGRADE" | "SUPERSEDED" | "STALE_SYNTHESIS";
  signalData: Record<string, unknown>;
}

export interface CrossLayerRelation {
  fromObjectType: string;
  fromObjectId: string;
  toObjectType: string;
  toObjectId: string;
  relationType: string;
  statement: string;
}

export interface L3EvolutionOutput {
  signals: StalenessSignal[];
  relations: CrossLayerRelation[];
  proposalIds: string[];
}

const STALE_DAYS = 30;
const FAILURE_RATE_THRESHOLD = 0.30;
const HIGH_DEMAND_THRESHOLD = 50;
const MIN_GATE_TRIGGERS = 10;

export async function scanEvolution(input: {
  tenantId: string;
  scope: string;
  traceId: string;
  newRuleIds?: string[];
  newMemoryIds?: string[];
  newSkillIds?: string[];
  newKnowledgeIds?: string[];
}): Promise<L3EvolutionOutput> {
  const [unused, failures, highDemand, superseded, staleSynthesis] = await Promise.all([
    scanUnused(input),
    scanFrequentFailures(input),
    scanHighDemandSkills(input),
    scanSuperseded(input),
    scanStaleSynthesizedKnowledge(input),
  ]);

  const signals = [...unused, ...failures, ...highDemand, ...superseded, ...staleSynthesis];

  const proposalIds: string[] = [];
  for (const signal of signals) {
    const proposalId = await createGovernanceChangeProposal({
      tenantId: input.tenantId,
      scope: input.scope,
      targetObjectType: signal.layer,
      targetObjectId: signal.entryId,
      proposedAction: `l3_evolution_${signal.signalKind.toLowerCase()}`,
      proposedPayload: {
        target_id: signal.entryId,
        target_layer: signal.layer,
        target_title: signal.title,
        target_content: signal.content,
        signal_kind: signal.signalKind,
        signal_data: signal.signalData,
      },
      reason: buildSignalReason(signal),
      riskLevel: signal.signalKind === "FREQUENT_FAILURE" ? "high" : "medium",
      traceId: input.traceId,
      originScope: "session",
      availabilityScope: "session_only",
      promotionStatus: "needs_review",
      governanceLevel: "session",
      evolutionSignal: signal.signalKind,
      originalArtifactId: signal.entryId,
      proposedActionType: signal.signalKind === "UNUSED" || signal.signalKind === "SUPERSEDED" || signal.signalKind === "STALE_SYNTHESIS"
        ? "delete"
        : signal.signalKind === "HIGH_DEMAND_UPGRADE"
          ? "upgrade_scope"
          : "strengthen",
    });
    proposalIds.push(proposalId);
  }

  const relations = await discoverCrossLayerRelations(input);

  for (const rel of relations) {
    await createKnowledgeRelation({
      tenantId: input.tenantId,
      scope: input.scope,
      memoryDomain: "governance",
      relationType: rel.relationType,
      fromObjectType: rel.fromObjectType,
      fromObjectId: rel.fromObjectId,
      toObjectType: rel.toObjectType,
      toObjectId: rel.toObjectId,
      statement: rel.statement,
      confidenceScore: 0.75,
      metadata: { source: "l3_evolution_scan" },
      traceId: input.traceId,
    });
  }

  return { signals, relations, proposalIds };
}

async function scanUnused(input: {
  tenantId: string;
  scope: string;
  traceId: string;
}): Promise<StalenessSignal[]> {
  const pool = getPool();
  const cutoff = new Date(Date.now() - STALE_DAYS * 24 * 60 * 60 * 1000);

  const layers = [
    { table: "rule", contentCol: "statement", layer: "rule" as const },
    { table: "memory", contentCol: "content", layer: "memory" as const },
    { table: "skill", contentCol: "description", layer: "skill" as const },
  ];

  const signals: StalenessSignal[] = [];

  for (const { table, contentCol, layer } of layers) {
    const entries = await pool.query(
      `
      SELECT id, title, ${contentCol} AS content
      FROM ${table}
      WHERE tenant_id = $1
        AND scope = $2
        AND status = 'active'
      `,
      [input.tenantId, input.scope]
    );

    if (entries.rows.length === 0) continue;

    const ids = entries.rows.map((r) => String(r.id));
    const [counts, lastAccessMap] = await Promise.all([
      countAccessByObjectRef({
        tenantId: input.tenantId,
        scope: input.scope,
        objectType: layer,
        objectRefs: ids,
      }),
      getLastAccessTimeByObjectRef({
        tenantId: input.tenantId,
        scope: input.scope,
        objectType: layer,
        objectRefs: ids,
      }),
    ]);

    for (const row of entries.rows) {
      const id = String(row.id);
      const recallCount = counts[id] ?? 0;
      const lastAccessStr = lastAccessMap[id];
      if (recallCount === 0 || !lastAccessStr) continue;
      const lastAccessDate = new Date(lastAccessStr);
      if (lastAccessDate < cutoff) {
        const daysStale = Math.floor((Date.now() - lastAccessDate.getTime()) / (24 * 60 * 60 * 1000));
        signals.push({
          entryId: id,
          layer,
          title: String(row.title ?? ""),
          content: String(row.content ?? ""),
          signalKind: "UNUSED",
          signalData: { daysSinceLastRecall: daysStale, recallCount },
        });
      }
    }
  }

  return signals;
}

async function scanFrequentFailures(input: {
  tenantId: string;
  scope: string;
  traceId: string;
}): Promise<StalenessSignal[]> {
  const pool = getPool();
  const result = await pool.query(
    `
    SELECT r.id, r.title, r.statement,
           COUNT(a.id) AS total,
           COUNT(a.id) FILTER (WHERE a.decision = 'blocked' OR a.decision = 'rejected') AS fails
    FROM rule r
    LEFT JOIN rule_gate_audit a
      ON a.rule_id = r.id
      AND a.tenant_id = r.tenant_id
      AND a.scope = r.scope
    WHERE r.tenant_id = $1
      AND r.scope = $2
      AND r.status = 'active'
    GROUP BY r.id, r.title, r.statement
    HAVING COUNT(a.id) >= $3
    `,
    [input.tenantId, input.scope, MIN_GATE_TRIGGERS]
  );

  const signals: StalenessSignal[] = [];
  for (const row of result.rows) {
    const total = Number(row.total);
    const fails = Number(row.fails);
    const failureRate = total > 0 ? fails / total : 0;
    if (failureRate > FAILURE_RATE_THRESHOLD) {
      signals.push({
        entryId: String(row.id),
        layer: "rule",
        title: String(row.title ?? ""),
        content: String(row.statement ?? ""),
        signalKind: "FREQUENT_FAILURE",
        signalData: { totalTriggers: total, failCount: fails, failureRate },
      });
    }
  }
  return signals;
}

async function scanHighDemandSkills(input: {
  tenantId: string;
  scope: string;
  traceId: string;
}): Promise<StalenessSignal[]> {
  const pool = getPool();
  const skills = await pool.query(
    `
    SELECT id, title, description
    FROM skill
    WHERE tenant_id = $1
      AND scope = $2
      AND status = 'active'
      AND origin_scope = 'project'
    `,
    [input.tenantId, input.scope]
  );

  if (skills.rows.length === 0) return [];

  const ids = skills.rows.map((r) => String(r.id));
  const counts = await countAccessByObjectRef({
    tenantId: input.tenantId,
    scope: input.scope,
    objectType: "skill",
    objectRefs: ids,
  });

  const signals: StalenessSignal[] = [];
  for (const row of skills.rows) {
    const id = String(row.id);
    const recallCount = counts[id] ?? 0;
    if (recallCount > HIGH_DEMAND_THRESHOLD) {
      signals.push({
        entryId: id,
        layer: "skill",
        title: String(row.title ?? ""),
        content: String(row.description ?? ""),
        signalKind: "HIGH_DEMAND_UPGRADE",
        signalData: { recallCount },
      });
    }
  }
  return signals;
}

async function scanSuperseded(input: {
  tenantId: string;
  scope: string;
  traceId: string;
}): Promise<StalenessSignal[]> {
  const pool = getPool();
  const result = await pool.query(
    `
    SELECT
      gr.from_object_id AS supersedes_id,
      gr.to_object_id AS superseded_id,
      gr.from_object_type AS supersedes_type,
      gr.to_object_type AS superseded_type
    FROM kp_relation gr
    WHERE gr.tenant_id = $1
      AND gr.scope = $2
      AND gr.relation_type = 'supersedes'
      AND gr.status = 'active'
    `,
    [input.tenantId, input.scope]
  );

  const signals: StalenessSignal[] = [];
  for (const row of result.rows) {
    const supersededId = String(row.superseded_id);
    const supersededType = String(row.superseded_type);
    const layer = supersededType as "rule" | "skill" | "memory" | "knowledge";

    let title = "";
    let content = "";
    if (layer === "rule") {
      const r = await pool.query("SELECT title, statement FROM rule WHERE id = $1", [supersededId]);
      if (r.rows.length > 0) {
        title = String(r.rows[0].title ?? "");
        content = String(r.rows[0].statement ?? "");
      }
    } else if (layer === "memory") {
      const r = await pool.query("SELECT title, content FROM memory WHERE id = $1", [supersededId]);
      if (r.rows.length > 0) {
        title = String(r.rows[0].title ?? "");
        content = String(r.rows[0].content ?? "");
      }
    } else if (layer === "skill") {
      const r = await pool.query("SELECT title, description FROM skill WHERE id = $1", [supersededId]);
      if (r.rows.length > 0) {
        title = String(r.rows[0].title ?? "");
        content = String(r.rows[0].description ?? "");
      }
    }

    signals.push({
      entryId: supersededId,
      layer,
      title,
      content,
      signalKind: "SUPERSEDED",
      signalData: { supersededBy: String(row.supersedes_id) },
    });
  }
  return signals;
}

/**
 * 扫描"孤立的幽灵"合成知识：L4 产出的 synthesized_knowledge 依赖的 source 对象
 * 如果已被废弃/删除/禁用，合成知识就成了无根之物，触发 STALE_SYNTHESIS → DEPRECATE 提案
 *
 * 依赖关系读取优先级：
 *   1. metadata.dependency_sources_by_layer（新字段，按层分桶）：每个 id 按真实层查对应表
 *   2. metadata.dependency_source_ids + dependency_source_layer（旧字段）：全部按同一层查
 *
 * 旧字段在跨层 hypothesis 上有 bug（如 cross_layer_correlation 的 sourceIds 同时含
 * rule.id 和 memory.id，旧字段 sourceLayer 只标 "rule"，导致 memory.id 在 rule 表查不到
 * 被误判 stale）。新代码应优先读 dependency_sources_by_layer。
 */
async function scanStaleSynthesizedKnowledge(input: {
  tenantId: string;
  scope: string;
  traceId: string;
}): Promise<StalenessSignal[]> {
  const pool = getPool();

  // 查所有 active 的合成知识，读取其依赖元数据
  const synthKnowledge = await pool.query(
    `SELECT id, title, content, metadata
     FROM kp_synthesized_knowledge
     WHERE tenant_id = $1 AND scope = $2 AND status = 'active'
     AND knowledge_type IN ('synthesis', 'pattern')`,
    [input.tenantId, input.scope]
  );

  const signals: StalenessSignal[] = [];

  // 层名 → 物理表名映射
  const tableMap: Record<string, string> = {
    rule: "rule",
    memory: "memory",
    skill: "skill",
    knowledge: "kp_synthesized_knowledge",
  };

  for (const sk of synthKnowledge.rows) {
    // 用共享类型断言，如果 L4 改了字段名这里编译期会报错
    const metadata = sk.metadata as SynthesizedKnowledgeMetadata ?? {};
    const byLayer = metadata.dependency_sources_by_layer;
    const hasByLayer = byLayer && typeof byLayer === "object" && Object.keys(byLayer).length > 0;

    // 收集所有依赖 id + 它们各自所属的层
    // 新字段优先；旧字段兜底（全部按 sourceLayer 标）
    const depEntries: Array<{ id: string; layer: string }> = [];
    let depLayerForSignal = "rule"; // 用于 signalData.dependency_layer

    if (hasByLayer) {
      for (const [layer, ids] of Object.entries(byLayer)) {
        if (!Array.isArray(ids)) continue;
        for (const id of ids) {
          depEntries.push({ id: String(id), layer });
        }
      }
      depLayerForSignal = Object.keys(byLayer).join(",") || "rule";
    } else {
      const depSourceIds = Array.isArray(metadata.dependency_source_ids) ? metadata.dependency_source_ids : [];
      const depSourceLayer = typeof metadata.dependency_source_layer === "string" ? metadata.dependency_source_layer : "rule";
      for (const id of depSourceIds) {
        depEntries.push({ id: String(id), layer: depSourceLayer });
      }
      depLayerForSignal = depSourceLayer;
    }

    if (depEntries.length === 0) continue;

    // 按层分组查不同表，每个 id 必须在其所属层的表里 active 才算"未失效"
    // 用 Map<layer, id[]> 分桶，逐层批量查询，避免 N+1
    const idsByLayer = new Map<string, string[]>();
    for (const entry of depEntries) {
      const arr = idsByLayer.get(entry.layer) ?? [];
      arr.push(entry.id);
      idsByLayer.set(entry.layer, arr);
    }

    const activeIdSet = new Set<string>();
    for (const [layer, ids] of idsByLayer.entries()) {
      const table = tableMap[layer] ?? "rule";
      try {
        const activeCheck = await pool.query(
          `SELECT id FROM ${table}
           WHERE tenant_id = $1 AND scope = $2 AND status = 'active'
           AND id::text = ANY($3::text[])`,
          [input.tenantId, input.scope, ids]
        );
        for (const row of activeCheck.rows) {
          activeIdSet.add(String(row.id));
        }
      } catch {
        // 表名不存在或查询失败时，把这一层的 id 全部视为 stale（保守判定）
        // 但 depEntries 里这些 id 仍然计入 total，让提案带上"无法验证"信号
      }
    }

    const staleDepIds = depEntries
      .filter((e) => !activeIdSet.has(e.id))
      .map((e) => e.id);

    if (staleDepIds.length > 0) {
      signals.push({
        entryId: String(sk.id),
        layer: "knowledge",
        title: String(sk.title ?? ""),
        content: String(sk.content ?? ""),
        signalKind: "STALE_SYNTHESIS",
        signalData: {
          stale_dependency_ids: staleDepIds,
          dependency_layer: depLayerForSignal,
          total_dependencies: depEntries.length,
          stale_count: staleDepIds.length,
        },
      });
    }
  }

  return signals;
}

async function discoverCrossLayerRelations(input: {
  tenantId: string;
  scope: string;
  traceId: string;
  newRuleIds?: string[];
  newMemoryIds?: string[];
  newSkillIds?: string[];
  newKnowledgeIds?: string[];
}): Promise<CrossLayerRelation[]> {
  const pool = getPool();
  const relations: CrossLayerRelation[] = [];

  const newRuleIds = input.newRuleIds ?? [];
  const newMemoryIds = input.newMemoryIds ?? [];
  const newSkillIds = input.newSkillIds ?? [];

  if (newRuleIds.length > 0) {
    const rules = await pool.query(
      "SELECT id, title, statement, metadata FROM rule WHERE id = ANY($1)",
      [newRuleIds]
    );
    for (const rule of rules.rows) {
      const ruleContent = String(rule.statement ?? "");
      const ruleKeywords = extractKeywords(ruleContent);

      if (ruleKeywords.length === 0) continue;

      // depends_on（rule → skill）：关键词 ILIKE 匹配后，再加 overlap 阈值
      // 之前是 0 阈值——任何单字符命中就建关系，导致"使用环境变量"和"用户组件"共享"用"也建关系
      // 现在：target 文本必须和 rule 共享至少 2 个关键词才建关系
      const matchingSkills = await pool.query(
        `SELECT id, title, description FROM skill
         WHERE tenant_id = $1 AND scope = $2 AND status = 'active'
         AND (title ILIKE ANY($3) OR description ILIKE ANY($3))
         LIMIT 10`,
        [input.tenantId, input.scope, ruleKeywords.map((k) => `%${k}%`)]
      );

      for (const skill of matchingSkills.rows) {
        const skillKeywords = extractKeywords(`${skill.title} ${skill.description}`);
        const overlap = ruleKeywords.filter((k) => skillKeywords.includes(k));
        if (overlap.length >= 2) {
          relations.push({
            fromObjectType: "rule",
            fromObjectId: String(rule.id),
            toObjectType: "skill",
            toObjectId: String(skill.id),
            relationType: "depends_on",
            statement: `规则"${rule.title}"依赖技能"${skill.title}"执行（共享关键词：${overlap.slice(0, 3).join("、")}）`,
          });
        }
      }

      // derives_from（rule → memory）：同样加 overlap 阈值
      const matchingMemories = await pool.query(
        `SELECT id, title, content FROM memory
         WHERE tenant_id = $1 AND scope = $2 AND status = 'active'
         AND (title ILIKE ANY($3) OR content ILIKE ANY($3))
         LIMIT 10`,
        [input.tenantId, input.scope, ruleKeywords.map((k) => `%${k}%`)]
      );

      for (const memory of matchingMemories.rows) {
        const memKeywords = extractKeywords(`${memory.title} ${memory.content}`);
        const overlap = ruleKeywords.filter((k) => memKeywords.includes(k));
        if (overlap.length >= 2) {
          relations.push({
            fromObjectType: "rule",
            fromObjectId: String(rule.id),
            toObjectType: "memory",
            toObjectId: String(memory.id),
            relationType: "derives_from",
            statement: `规则"${rule.title}"与记忆"${memory.title}"相关（共享关键词：${overlap.slice(0, 3).join("、")}）`,
          });
        }
      }
    }
  }

  if (newMemoryIds.length > 0 && newSkillIds.length > 0) {
    const memories = await pool.query(
      "SELECT id, title, content FROM memory WHERE id = ANY($1)",
      [newMemoryIds]
    );
    const skills = await pool.query(
      "SELECT id, title, description FROM skill WHERE id = ANY($1)",
      [newSkillIds]
    );

    for (const mem of memories.rows) {
      const memKeywords = extractKeywords(String(mem.content ?? ""));
      if (memKeywords.length === 0) continue;

      for (const skill of skills.rows) {
        const skillText = `${skill.title} ${skill.description}`;
        const skillKeywords = extractKeywords(String(skillText ?? ""));
        const overlap = memKeywords.filter((k) => skillKeywords.includes(k));
        if (overlap.length >= 2) {
          relations.push({
            fromObjectType: "memory",
            fromObjectId: String(mem.id),
            toObjectType: "skill",
            toObjectId: String(skill.id),
            relationType: "relates_to",
            statement: `记忆"${mem.title}"与技能"${skill.title}"存在关联`,
          });
        }
      }
    }
  }

  // 共现补强：从 memory_access_log 找最近 N 天内同一 trace_id 下被一起召回的对象，
  // 这类共现关系比关键词 ILIKE 更可靠（来自真实使用场景）
  // 仅扫描最近 30 天，避免历史噪声
  relations.push(...await discoverAccessLogCooccurrence(input.tenantId, input.scope));

  return relations;
}

// 通过 memory_access_log 的 trace_id 共现发现跨层关系
// 同一 trace_id 下被一起 recall 的对象，往往在业务上相关
// 共现次数 >= 2 才记录，避免单次噪声
async function discoverAccessLogCooccurrence(tenantId: string, scope: string): Promise<CrossLayerRelation[]> {
  const pool = getPool();
  // 找最近 30 天内同一 trace_id 下被多次一起 recall 的对象对
  // 只考虑 rule/memory/skill 三种 object_type（knowledge 走独立链路）
  // 用 DISTINCT 去重避免同一对象对多次记录
  const result = await pool.query(
    `WITH cooccurrence AS (
      SELECT
        a.object_type AS from_type,
        a.object_ref AS from_id,
        b.object_type AS to_type,
        b.object_ref AS to_id,
        COUNT(DISTINCT a.trace_id) AS cooccur_count
      FROM memory_access_log a
      JOIN memory_access_log b
        ON a.tenant_id = b.tenant_id
        AND a.scope = b.scope
        AND a.trace_id = b.trace_id
        AND a.object_type < b.object_type
        AND a.object_ref <> b.object_ref
      WHERE a.tenant_id = $1
        AND a.scope = $2
        AND a.object_type IN ('rule', 'memory', 'skill')
        AND b.object_type IN ('rule', 'memory', 'skill')
        AND a.created_at >= NOW() - INTERVAL '30 days'
        AND b.created_at >= NOW() - INTERVAL '30 days'
      GROUP BY a.object_type, a.object_ref, b.object_type, b.object_ref
      HAVING COUNT(DISTINCT a.trace_id) >= 2
    )
    SELECT from_type, from_id, to_type, to_id, cooccur_count
    FROM cooccurrence
    ORDER BY cooccur_count DESC
    LIMIT 50`,
    [tenantId, scope]
  );

  // 查对象标题用于生成 statement
  const objectIds = new Set<string>();
  for (const row of result.rows) {
    objectIds.add(String(row.from_id));
    objectIds.add(String(row.to_id));
  }
  const titlesByType: Record<string, Record<string, string>> = { rule: {}, memory: {}, skill: {} };
  if (objectIds.size > 0) {
    const idArr = [...objectIds];
    // object_ref 是 text，rule/memory/skill 的 id 是 uuid，需要 ::text 转换
    const [rules, memories, skills] = await Promise.all([
      pool.query("SELECT id, title FROM rule WHERE id::text = ANY($1::text[])", [idArr]),
      pool.query("SELECT id, title FROM memory WHERE id::text = ANY($1::text[])", [idArr]),
      pool.query("SELECT id, title FROM skill WHERE id::text = ANY($1::text[])", [idArr])
    ]);
    for (const r of rules.rows) titlesByType.rule[String(r.id)] = String(r.title);
    for (const m of memories.rows) titlesByType.memory[String(m.id)] = String(m.title);
    for (const s of skills.rows) titlesByType.skill[String(s.id)] = String(s.title);
  }

  const relations: CrossLayerRelation[] = [];
  const seen = new Set<string>();
  for (const row of result.rows) {
    const fromType = String(row.from_type);
    const fromId = String(row.from_id);
    const toType = String(row.to_type);
    const toId = String(row.to_id);
    // 去重（按 from-to 排序的 key）
    const key = [fromType, fromId, toType, toId].sort().join("|");
    if (seen.has(key)) continue;
    seen.add(key);

    const fromTitle = titlesByType[fromType]?.[fromId] ?? fromId.slice(0, 8);
    const toTitle = titlesByType[toType]?.[toId] ?? toId.slice(0, 8);
    relations.push({
      fromObjectType: fromType,
      fromObjectId: fromId,
      toObjectType: toType,
      toObjectId: toId,
      relationType: "co_occurs_with",
      statement: `${fromTitle}(${fromType}) 与 ${toTitle}(${toType}) 在 ${row.cooccur_count} 次召回中共现`,
    });
  }
  return relations;
}

function extractKeywords(text: string): string[] {
  // 中文停用词表（高频功能字 + 虚词）：这些字几乎出现在所有技术文本里，没有区分度
  // 之前的停用词表只有 13 个字，"用/使/类/组/件/校/配/型"全没过滤，
  // 导致"使用环境变量校验"和"用户组件拆分"共享"用"→误建 depends_on 关系
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

  // 中文 bigram（2字滑窗）：替代原来的单字符分词
  // 单字符会把"组件拆分"拆成"组/件/拆/分"，任何包含"用/使/类"的文本都会撞上
  // bigram 后"组件拆分"→"组件/件拆/拆分"，"环境变量"→"环境/境变/变量"
  // 共享 bigram 才说明真有关联，单字共现是噪声
  const cjkText = text.replace(/[^\u4e00-\u9fff]/g, "");
  const cjkBigrams: string[] = [];
  for (let i = 0; i < cjkText.length - 1; i++) {
    const bigram = cjkText.slice(i, i + 2);
    // 任一字符在停用词表里就跳过（"的校验"→跳过）
    if (stopWords.has(bigram[0]) || stopWords.has(bigram[1])) continue;
    cjkBigrams.push(bigram);
  }

  return [...englishTokens, ...cjkBigrams].slice(0, 25);
}

function buildSignalReason(signal: StalenessSignal): string {
  switch (signal.signalKind) {
    case "UNUSED": {
      const d = signal.signalData as { daysSinceLastRecall: number; recallCount: number };
      return `L3演进扫描：已${d.daysSinceLastRecall}天未召回（历史召回${d.recallCount}次），建议废弃。`;
    }
    case "FREQUENT_FAILURE": {
      const d = signal.signalData as { totalTriggers: number; failCount: number; failureRate: number };
      return `L3演进扫描：门禁触发${d.totalTriggers}次，失败率${(d.failureRate * 100).toFixed(0)}%，建议强化。`;
    }
    case "HIGH_DEMAND_UPGRADE": {
      const d = signal.signalData as { recallCount: number };
      return `L3演进扫描：已被召回${d.recallCount}次，建议从项目级提升为全局级。`;
    }
    case "SUPERSEDED":
      return `L3演进扫描：已被更具体的条目通过supersedes关系覆盖，建议废弃。`;
    case "STALE_SYNTHESIS": {
      const d = signal.signalData as { stale_count: number; total_dependencies: number; dependency_layer: string };
      return `L3演进扫描：合成知识依赖的${d.stale_count}/${d.total_dependencies}个${d.dependency_layer}层对象已失效，成为"孤立的幽灵"，建议废弃。`;
    }
  }
}

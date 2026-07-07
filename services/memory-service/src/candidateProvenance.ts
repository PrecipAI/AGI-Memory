/**
 * candidateProvenance.ts — L1 candidate 来源溯源 + 实体规范化
 *
 * 解决两个问题：
 *   1. 实体重复（"React"/"React 18"/"react 18" 是三个独立节点）
 *      → L1 写入前调 createOrResolveKnowledgeEntity 做 slug 规范化 + alias 匹配，
 *        同一 canonical 实体只追加 alias 不新建节点
 *   2. evidence 跨层关联缺失（evidence 只挂 synthesized_knowledge）
 *      → L1 写入 rule/skill/memory 时，把 candidate 的 source_ref + content 作为 evidence
 *        写入 kp_evidence，并在 evidence_links 里建 evidence → rule/skill/memory 关联
 *
 * 设计原则：
 *   - 启发式抽取，不调 LLM（L1 是模板化抽取层，保持轻量）
 *   - 失败不阻塞主流程（candidate 已写入，provenance 是增强信息）
 *   - 复用现有 kp_entity 表 + createOrResolveKnowledgeEntity + createKnowledgeRelation
 */

import {
  createEvidenceLink,
  createKnowledgeEvidence,
  createKnowledgeRelation,
  createOrResolveKnowledgeEntity,
} from "@super-agent/db";

/**
 * L1 candidate 写入 rule/skill/memory 后调用，建立两条溯源链：
 *   a) evidence → rule/skill/memory（link_type=source_of）：这条规则从哪轮对话的哪句话抽的
 *   b) rule/skill/memory → entity（relationType=mentions）：这条规则提到了哪些技术实体
 *
 * 失败不抛异常,但返回 { evidence_link_ok, entity_link_ok, errors } 让调用方可感知。
 * 所有失败都带 traceId 写 console.error,便于排查。
 */
export async function persistCandidateProvenance(input: {
  tenantId: string;
  scope: string;
  traceId: string;
  targetType: "rule" | "memory" | "skill";
  targetId: string;
  title: string;
  content: string;
  sourceRef: string;
  sourceType: string;
  artifactTag: string;
}): Promise<{
  evidence_link_ok: boolean;
  entity_link_ok: boolean;
  errors: string[];
}> {
  const {
    tenantId,
    scope,
    traceId,
    targetType,
    targetId,
    title,
    content,
    sourceRef,
    sourceType,
    artifactTag,
  } = input;
  const errors: string[] = [];
  let evidenceLinkOk = false;
  let entityLinkOk = false;

  // ─── a) evidence → rule/skill/memory（source_of 关联） ───
  // 把 candidate 的 source_ref + content 作为 evidence，记录"这条规则从哪抽的"
  try {
    const evidenceId = await createKnowledgeEvidence({
      tenantId,
      scope,
      memoryDomain: "governance",
      evidenceType: "candidate_source",
      sourceType,
      sourceUri: `candidate://${sourceRef}`,
      rawRef: sourceRef,
      contentExcerpt: `${title}\n\n${content}`.slice(0, 500),
      metadata: {
        target_type: targetType,
        target_id: targetId,
        artifact_tag: artifactTag,
        source_ref: sourceRef,
      },
      traceId,
    });
    await createEvidenceLink({
      tenantId,
      scope,
      evidenceId,
      targetId,
      targetLayer: targetType === "memory" ? "memory" : targetType,
      linkType: "source_of",
      confidence: 1.0,
      traceId,
    });
    evidenceLinkOk = true;
  } catch (e) {
    const errMsg = e instanceof Error ? e.message : String(e);
    // 结构化日志:带 traceId / targetType / targetId,便于关联
    console.error(
      `[candidateProvenance] evidence link failed trace_id=${traceId} target=${targetType}:${targetId} error=${errMsg}`,
    );
    errors.push(`evidence_link_failed: ${errMsg}`);
  }

  // ─── b) rule/skill/memory → entity（mentions 关联） ───
  // 启发式抽取技术名词，调 createOrResolveKnowledgeEntity 做 slug 规范化 + alias 匹配
  try {
    const entities = extractTechEntities(`${title} ${content}`);
    for (const entity of entities) {
      const entityId = await createOrResolveKnowledgeEntity({
        tenantId,
        scope,
        memoryDomain: "governance",
        entityType: entity.entityType,
        canonicalName: entity.canonical,
        aliases: entity.aliases,
        summary: null,
        metadata: { source: "l1_candidate_ingress", artifact_tag: artifactTag },
        traceId,
      });
      await createKnowledgeRelation({
        tenantId,
        scope,
        memoryDomain: "governance",
        relationType: "mentions",
        fromObjectType: targetType,
        fromObjectId: targetId,
        toObjectType: "entity",
        toObjectId: entityId,
        statement: `${targetType} "${title.slice(0, 40)}" 提到实体 "${entity.canonical}"`,
        confidenceScore: 0.8,
        metadata: { source: "l1_candidate_ingress" },
        traceId,
      });
    }
    entityLinkOk = true;
  } catch (e) {
    const errMsg = e instanceof Error ? e.message : String(e);
    console.error(
      `[candidateProvenance] entity extraction failed trace_id=${traceId} target=${targetType}:${targetId} error=${errMsg}`,
    );
    errors.push(`entity_link_failed: ${errMsg}`);
  }

  return {
    evidence_link_ok: evidenceLinkOk,
    entity_link_ok: entityLinkOk,
    errors,
  };
}

/**
 * 启发式抽取技术名词
 *
 * 策略：
 *   1. 英文 CamelCase 技术名词：React / TypeScript / Zustand / Vite / AbortController / useEffect / useMemo
 *      正则：[A-Z][a-zA-Z0-9]+ （至少 2 段，或带连字符如 use-Effect）
 *      特殊：use* / With* 前缀也抽（useEffect / withTimeout）
 *   2. 英文全大写缩写：CI / PR / API / DOM / JSON
 *      正则：\b[A-Z]{2,}\b
 *   3. 中文技术术语 bigram：状态管理 / 类型检查 / 错误处理 / 依赖数组
 *      2-4 字中文词组（用 bigram 滑动窗口）
 *
 * 每个抽取出的实体：
 *   - canonical: 规范名（首字母大写形式，如 "React"）
 *   - aliases: 别名数组（小写形式 + 原始形式，如 ["react"]）
 *   - entityType: "framework" | "library" | "hook" | "concept" | "tool" | "abbr"
 */
interface ExtractedEntity {
  canonical: string;
  aliases: string[];
  entityType: string;
}

function extractTechEntities(text: string): ExtractedEntity[] {
  const entities: ExtractedEntity[] = [];
  const seen = new Set<string>();

  // 1. CamelCase 技术名词（React / TypeScript / Zustand / AbortController）
  // 至少 2 个字符，首字母大写
  const camelCaseMatches = text.match(/\b[A-Z][a-zA-Z0-9]{2,}\b/g) ?? [];
  for (const match of camelCaseMatches) {
    const slug = match.toLowerCase();
    if (seen.has(slug)) continue;
    seen.add(slug);
    // 判断 entityType
    const entityType = inferEntityType(match);
    entities.push({
      canonical: match,
      aliases: [slug],
      entityType,
    });
  }

  // 2. use* / with* 前缀的 hook/util 名（useEffect / useMemo / withTimeout）
  // 这类可能不被 CamelCase 正则命中（如果首字母小写）
  const hookMatches =
    text.match(/\b(use[A-Z][a-zA-Z0-9]*|with[A-Z][a-zA-Z0-9]*)\b/g) ?? [];
  for (const match of hookMatches) {
    const slug = match.toLowerCase();
    if (seen.has(slug)) continue;
    seen.add(slug);
    entities.push({
      canonical: match,
      aliases: [slug],
      entityType: match.startsWith("use") ? "hook" : "util",
    });
  }

  // 3. 英文全大写缩写（CI / PR / API / DOM / JSON / TSC）
  const abbrMatches = text.match(/\b[A-Z]{2,5}\b/g) ?? [];
  const abbrBlacklist = new Set([
    "A",
    "I",
    "OK",
    "TODO",
    "FIXME",
    "NOT",
    "AND",
    "OR",
    "THE",
  ]);
  for (const match of abbrMatches) {
    if (abbrBlacklist.has(match)) continue;
    const slug = match.toLowerCase();
    if (seen.has(slug)) continue;
    seen.add(slug);
    entities.push({
      canonical: match,
      aliases: [slug],
      entityType: "abbr",
    });
  }

  // 4. 中文技术术语（bigram 滑动窗口）
  // 抽 2-4 字中文词组，过滤常见停用词
  const cjkText = text.replace(/[^\u4e00-\u9fff]/g, "");
  const cjkStopwords = new Set([
    "的了在是",
    "我和就",
    "不都一",
    "上也",
    "很到",
    "说要",
    "去你会",
    "着看好",
    "这个",
    "那个",
    "可以",
    "需要",
    "应该",
    "必须",
    "不要",
    "不能",
    "什么",
    "怎么",
    "为什",
    "么",
    "如果",
    "因为",
    "所以",
    "但是",
    "用户",
    "系统",
    "我们",
    "你们",
    "他们",
    "自己",
    "一个",
    "这个",
  ]);
  for (let i = 0; i < cjkText.length - 1; i++) {
    const bigram = cjkText.slice(i, i + 2);
    if (cjkStopwords.has(bigram)) continue;
    // 只保留看起来像技术术语的 bigram（至少含一个技术相关字）
    if (!isTechBigram(bigram)) continue;
    const slug = bigram.toLowerCase();
    if (seen.has(slug)) continue;
    seen.add(slug);
    entities.push({
      canonical: bigram,
      aliases: [slug],
      entityType: "concept",
    });
  }

  return entities.slice(0, 15); // 限制每条 candidate 最多 15 个实体，避免图谱爆炸
}

function isTechBigram(bigram: string): boolean {
  const techChars = new Set([
    "类",
    "型",
    "规",
    "范",
    "错",
    "误",
    "处",
    "理",
    "状",
    "态",
    "管",
    "理",
    "组",
    "件",
    "钩",
    "子",
    "依",
    "赖",
    "数",
    "组",
    "提",
    "交",
    "分",
    "支",
    "合",
    "并",
    "冲",
    "突",
    "重",
    "试",
    "超",
    "时",
    "校",
    "验",
    "环",
    "境",
    "变",
    "量",
    "日",
    "志",
    "级",
    "别",
    "结",
    "构",
    "化",
    "测",
    "试",
    "审",
    "查",
    "回",
    "收",
    "废",
    "弃",
    "升",
    "级",
    "降",
    "权",
    "遗",
    "忘",
    "演",
    "进",
    "扫",
    "描",
    "假",
    "设",
    "推",
    "理",
    "证",
    "据",
    "合",
    "成",
    "知",
    "识",
    "图",
    "谱",
    "实",
    "体",
    "事",
    "实",
    "关",
    "系",
  ]);
  for (const ch of bigram) {
    if (techChars.has(ch)) return true;
  }
  return false;
}

function inferEntityType(name: string): string {
  const lower = name.toLowerCase();
  // 已知框架/库
  const frameworks = new Set([
    "react",
    "redux",
    "zustand",
    "vite",
    "next",
    "vue",
    "angular",
    "svelte",
  ]);
  const libraries = new Set([
    "typescript",
    "javascript",
    "eslint",
    "prettier",
    "jest",
    "vitest",
    "storybook",
  ]);
  const tools = new Set([
    "npm",
    "git",
    "webpack",
    "rollup",
    "esbuild",
    "turbopack",
    "babel",
  ]);

  if (frameworks.has(lower)) return "framework";
  if (libraries.has(lower)) return "library";
  if (tools.has(lower)) return "tool";
  return "tech_term";
}

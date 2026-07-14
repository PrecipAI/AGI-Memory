# 40. 反投机取巧（Anti Reward Hacking）改进 Spec

> 基于 `AGI-Memory_反投机取巧改进方案.md` 的四个方向，结合本项目代码现状盘点后制定的落地 spec。
> 原则：能确定性检查的一律不留给模型自己说了算；不能确定性化的靠持续监测+真实结果兜底。

---

## 0. 现状盘点（事实，非猜测）

### 0.1 已实现（不重做）

| 能力 | 位置 |
|---|---|
| classification_trace 结构校验（Q1-Q4 + decision_layer 一致性 + Q编号引用） | [hostModelGovernanceAdapter.ts:766-811](../../services/memory-service/src/hostModelGovernanceAdapter.ts#L766-L811) |
| review_trace 字段校验 + consensus=false 强制 needs_review | [hostModelGovernanceAdapter.ts:813-859](../../services/memory-service/src/hostModelGovernanceAdapter.ts#L813-L859) |
| self_test 各层字段强校验 | [hostModelGovernanceAdapter.ts:888-934](../../services/memory-service/src/hostModelGovernanceAdapter.ts#L888-L934) |
| L2 冲突检测（embedding + Jaccard 降级 + 启发式分类） | [L2ConflictDetector.ts:126-267](../../services/memory-service/src/governance/L2ConflictDetector.ts#L126-L267) |
| L3 演进扫描（SUPERSEDED/STALE_SYNTHESIS 等 5 种信号） | [L3EvolutionScanner.ts:50-464](../../services/memory-service/src/governance/L3EvolutionScanner.ts#L50-L464) |
| importance_weight 三因子加权衰减（recency+frequency+utility） | [knowledge.ts:1985-2086](../../libs/db/src/repositories/knowledge.ts#L1985-L2086) |
| L2 阈值自适应校准（session_outcomes 反推） | [L2ThresholdCalibrator.ts:97-291](../../services/memory-service/src/governance/L2ThresholdCalibrator.ts#L97-L291) |
| 跨层内容冲突检测（完全字符串匹配） | [hostModelGovernanceAdapter.ts:135-259](../../services/memory-service/src/hostModelGovernanceAdapter.ts#L135-L259) `auditCrossLayerBoundaries` |
| 反废话词检测（FILLER_PATTERNS） | [hostModelGovernanceAdapter.ts:750-762](../../services/memory-service/src/hostModelGovernanceAdapter.ts#L750-L762) |

### 0.2 明确缺口

| 缺口 | 来源 |
|---|---|
| MCP 层 schema 三件套全 `.optional()`，强校验依赖 hostModelGovernanceAdapter，走 rules_fallback 即绕过 | [server.ts:224/232/263](../../services/memory-mcp-server/src/server.ts#L224) |
| classification_trace reasoning 具体性校验（n-gram 重合度） | 全仓 0 匹配 |
| 同批次内跨候选 reasoning 雷同检测 | 全仓 0 匹配 |
| canary 哨兵候选注入 | 全仓 0 匹配 |
| review_trace 轮换提示词（单一固定字符串） | [governancePromptBuilder.ts:234-251](../../services/memory-service/src/governancePromptBuilder.ts#L234-L251) |
| session_outcomes 缺 SUPERSEDED outcome | [0021_session_outcomes.sql:35-37](../../db/migrations/0021_session_outcomes.sql#L35-L37) |
| session_outcomes 缺"分类判断被推翻"信号字段 | 表结构无此字段 |
| self_test 与 content 交叉验证（声明值 vs 实际内容一致性） | 全仓 0 匹配 |
| source_refs excerpt 真实性校验（是否真在原始 session 里） | 全仓 0 匹配 |

### 0.3 结构性短板

1. **MCP 层与 hostModelGovernanceAdapter 校验断层**：MCP 层三件套 `.optional()`，强校验全压在 adapter 上。走 `rules_fallback`（[hostModelGovernanceAdapter.ts:77-88](../../services/memory-service/src/hostModelGovernanceAdapter.ts#L77-L88)）或绕过 host_model 流程的提交，三套硬门控全部失效。**这是最大的投机取巧入口。**
2. **review_trace "假装是另一个模型"是提示词补丁**：[governancePromptBuilder.ts:250](../../services/memory-service/src/governancePromptBuilder.ts#L250) 自己承认不是真正的独立模型调用。当前无外部 LLM 调用基础设施（`embeddingProvider.ts` 只做 embedding）。
3. **session_outcomes 与 classification_trace 之间无数据回路**：session_outcomes 记录任务级 outcome（成功/失败），与"分类判断准不准"完全无关。L3 演进扫描的 SUPERSEDED 来自 `kp_relation` 表，不回流到 session_outcomes。

---

## P0: 堵 MCP Schema 结构性漏洞

### P0-1: 收紧 classification_trace / review_trace / self_test 的 optional

**目标**：MCP 层强制要求三件套，不走 host_model 流程的提交也无法绕过。

**现状**：
- [server.ts:224-228](../../services/memory-mcp-server/src/server.ts#L224-L228): `self_test: looseObjectSchema.optional()`
- [server.ts:232-260](../../services/memory-mcp-server/src/server.ts#L232-L260): `classification_trace: z.object({...}).optional()`
- [server.ts:263-278](../../services/memory-mcp-server/src/server.ts#L263-L278): `review_trace: z.object({...}).optional()`

**改动方案**：

1. 在 `governanceCandidateBaseSchema` 中，将三个字段的 `.optional()` 去掉，改为必填。
2. evidence 候选除外——evidence 是原始数据，不需要分类判断。evidence 候选走独立的 `governanceEvidenceCandidateSchema`（如果存在），或在 schema 层用 `.refine()` 做条件必填：
   ```typescript
   classification_trace: z.object({...}).nullable().refine(
     (val) => val !== null || /* is evidence */ false,
     "classification_trace is required for non-evidence candidates"
   )
   ```
   **更简洁的方案**：evidence 候选用独立的 schema extend，不继承三件套字段。检查 evidence 候选是否已有独立 schema 定义。
3. 同步更新 Zod schema 的 `.describe()` 文本，从"REQUIRED by backend validator"改为"REQUIRED"。

**影响范围分析**：
- **直接影响**：所有走 MCP 入口的 governance-run 调用，如果候选缺三件套，MCP 层直接 400 拒绝，不用等到 hostModelGovernanceAdapter。
- **调用方影响**：需排查所有调用 `memory_run_full_governance` / `memory_ingest_candidate` 的 host 端代码，确认都已补齐三件套字段。重点排查：
  - `hostCaptureGovernanceRun.ts` 的 governance-batch-preview / governance-run 路径
  - `candidateIngress.ts` 的普通 memory 候选路径（这条路径是否走 governance 三件套需确认）
  - 任何 `rules_fallback` 路径
- **向后兼容**：已有数据库中不合规的历史候选不受影响（schema 校验只在入口）。但如果 candidateIngress 路径不走三件套，收紧后会导致该路径提交失败——需确认。

**测试方案**：
- Gate test：提交缺 classification_trace 的 rule_candidate → 期望 MCP 层 400
- Gate test：提交缺 review_trace 的 memory_candidate → 期望 MCP 层 400
- Gate test：提交缺 self_test 的 skill_proposal_candidate → 期望 MCP 层 400
- Gate test：提交完整三件套的 rule_candidate → 期望通过
- Gate test：evidence 候选不传三件套 → 期望通过（evidence 豁免）

**风险**：
- 如果有调用方依赖 `.optional()` 的宽松行为（先提交后补齐），收紧会破坏现有流程。需在改动前 grep 所有调用方确认。

---

## P1: 确定性校验加强（方向一 + 方案漏掉的两个交叉验证）

### P1-1: classification_trace reasoning 具体性校验（n-gram 重合度）

**目标**：检查 `decision_reasoning` 是否真的针对这条候选，还是套话。

**现状**：
- [hostModelGovernanceAdapter.ts:788-797](../../services/memory-service/src/hostModelGovernanceAdapter.ts#L788-L797) 只校验 reasoning 引用了 Q 编号（正则 `/Q[1-4]/`），不校验内容是否与候选相关。
- 模型可以写"Q1 不命中，Q2 不命中，Q3 命中，归入 Memory"这种万能套话，对任何 memory 候选都适用。

**改动方案**：

1. **新增工具函数** `reasoningSpecificityScore(reasoning, candidateTitle, candidateContent)`：
   - 从 `candidateTitle + candidateContent` 提取关键词（复用 [L2ConflictDetector.ts:423-447](../../services/memory-service/src/governance/L2ConflictDetector.ts#L423-L447) 的 `tokenize()` + 中文 bigram）
   - 从 `reasoning` 提取同样粒度的 token
   - 计算 Jaccard 相似度（复用 [L2ConflictDetector.ts:412-421](../../services/memory-service/src/governance/L2ConflictDetector.ts#L412-L421) 的 `jaccardSimilarity()`）
   - 返回 0-1 的分数

2. **在 validateCandidate 中插入校验**（[hostModelGovernanceAdapter.ts:811](../../services/memory-service/src/hostModelGovernanceAdapter.ts#L811) 之后，`classification_trace` 透传后）：
   ```typescript
   // 具体性校验：reasoning 必须与候选内容有词汇重合
   const specificity = reasoningSpecificityScore(reasoning, validated.title ?? "", validated.content ?? "");
   if (specificity < SPECIFICITY_THRESHOLD) {
     throw new Error(formatValidationError(
       `${expectedType}[${index}].classification_trace.decision_reasoning`,
       `specificity score ${specificity.toFixed(2)} below threshold ${SPECIFICITY_THRESHOLD}`,
       "decision_reasoning 必须引用候选 title/content 中的具体词汇，不能是万能套话。",
       "BAD: 'Q1 不命中，Q3 命中，归入 Memory'\nGOOD: 'Q1 不命中（不是关于 PostgreSQL 连接池的放行判断），Q3 命中（绑定 2026-07-10 连接池泄漏那次经历）'"
     ));
   }
   ```

3. **阈值设定**：`SPECIFICITY_THRESHOLD = 0.15`（初始值，需用真实数据校准）。理由：title+content 通常 20-50 个有效 token，reasoning 需至少引用 3-5 个才算具体。Jaccard 0.15 对应约 3/20 的重合。

4. **降级策略**：如果 title+content 全是英文专名（如 "PostgreSQL JSONB"），tokenize 后 token 很少，Jaccard 可能偏高。需在 tokenize 时保留英文专名不拆分。

**影响范围分析**：
- **直接影响**：所有 governance-run 候选提交时多一道校验。
- **间接影响**：如果阈值设太高，大量合规 reasoning 被误杀；设太低，套话仍能通过。需要用 golden 50 eval 数据集校准。

**测试方案**：
- Gate test：reasoning 引用候选具体词汇 → 通过
- Gate test：reasoning 是万能套话"Q1不命中Q3命中归入Memory" → REJECT
- Gate test：reasoning 引用了 Q 编号但词汇与候选 0 重合 → REJECT
- Eval：用 golden 50 数据集跑一遍，统计误杀率（合规 reasoning 被拒的比例）和漏检率（套话通过的比例）。目标：误杀率 < 5%，套话检出率 > 80%。

**风险**：
- 阈值需要持续校准。建议加一个配置项，不要硬编码常量。

### P1-2: 同批次内跨候选 reasoning 雷同检测

**目标**：同一次 governance-run 提交的多条候选，如果 reasoning 彼此高度相似（复制粘贴换几个词），整批标记为"疑似批量应付"。

**现状**：
- [hostModelGovernanceAdapter.ts:135-259](../../services/memory-service/src/hostModelGovernanceAdapter.ts#L135-L259) `auditCrossLayerBoundaries` 只检测"同一内容跨层"，不检测"同一 reasoning 跨候选"。
- [L2ConflictDetector.ts:126-267](../../services/memory-service/src/governance/L2ConflictDetector.ts#L126-L267) `detectConflicts` 只在"候选 vs 已有库"之间做，不在"同批次候选之间"做。

**改动方案**：

1. **新增函数** `auditIntraBatchSimilarity(adaptedBatch)`：
   - 位置：[hostModelGovernanceAdapter.ts](../../services/memory-service/src/hostModelGovernanceAdapter.ts) 中 `auditCrossLayerBoundaries` 之后
   - 逻辑：
     - 遍历同批次内同层候选（rule vs rule, memory vs memory...）
     - 对每对候选的 `classification_trace.decision_reasoning` 做 bigram 提取 + Jaccard 相似度
     - 相似度 > 0.7（初始阈值）→ 标记为"疑似批量应付"
     - 同批次内雷同对数 > 2 → 整批 throw error，要求重新生成
     - 雷同对数 ≤ 2 → 在 reason 字段追加警告标记，走人工审批

2. **调用点**：[hostModelGovernanceAdapter.ts](../../services/memory-service/src/hostModelGovernanceAdapter.ts) `applyHostModelGovernanceResult` 函数中，`auditCrossLayerBoundaries(adaptedBatch)` 调用之后（约 L121 附近）：
   ```typescript
   auditCrossLayerBoundaries(adaptedBatch);
   auditIntraBatchSimilarity(adaptedBatch);  // 新增
   ```

3. **复用工具**：直接复用 [L2ConflictDetector.ts](../../services/memory-service/src/governance/L2ConflictDetector.ts) 的 `tokenize()` / `jaccardSimilarity()` / 中文 bigram 提取。

**影响范围分析**：
- **直接影响**：同批次提交多条候选时多一道校验。单条候选提交不受影响。
- **间接影响**：如果模型确实对同类候选生成相似 reasoning（合理情况），可能误杀。需区分"逻辑相似"和"文字雷同"——Jaccard 衡量的是文字重合，逻辑相似但用词不同不会被误杀。

**测试方案**：
- Gate test：同批次 3 条 memory 候选，reasoning 完全相同 → 整批 REJECT
- Gate test：同批次 3 条 memory 候选，reasoning 各不相同 → 通过
- Gate test：同批次 2 条 reasoning 高度相似（Jaccard 0.8）→ 追加警告标记
- Eval：用真实 governance-run 批次数据统计雷同检出率

**风险**：
- 批量雷同的阈值（0.7）需要校准。建议先用"只警告不拦截"模式跑一周，收集真实数据后再决定是否硬拦截。

### P1-3: self_test 与 content 交叉验证

**目标**：self_test 声明的 true/false 必须与 content 实际内容一致，不能声明 `about_user_not_code=true` 但 content 全是代码。

**现状**：
- [hostModelGovernanceAdapter.ts:888-934](../../services/memory-service/src/hostModelGovernanceAdapter.ts#L888-L934) `readSelfTest` 只校验 LLM 声明的值（true/false），不与 content 交叉验证。
- [hostModelGovernanceAdapter.ts:1053-1234](../../services/memory-service/src/hostModelGovernanceAdapter.ts#L1053-L1234) `validateLayerBoundary` 已有大量 content 模式检测（`hardRejectPatterns`、`rawFactPatterns`、`userProfileSignals`、`implSignals`），可以复用。

**改动方案**：

1. **新增函数** `crossValidateSelfTest(candidateType, content, selfTest)`：
   - 位置：[hostModelGovernanceAdapter.ts](../../services/memory-service/src/hostModelGovernanceAdapter.ts)
   - 按候选类型做不同交叉校验：

   | 候选类型 | self_test 声明 | 交叉校验逻辑 |
   |---|---|---|
   | memory | `about_user_not_code=true` | 检查 content 是否匹配 `implSignals`（代码实现细节关键词）。如果匹配 → 矛盾，REJECT |
   | memory | `time_diluted="stable"` | 检查 content 是否含时间敏感词（"今天"/"昨天"/"当前版本"/"v2.3"）。如果含 → 矛盾，REJECT |
   | knowledge | `ood_threshold=true`（超出训练分布） | 检查 content 是否是常识性陈述（匹配 `COMMON_KNOWLEDGE_PATTERNS`）。如果是 → 矛盾，REJECT |
   | knowledge | `reusable=true` | 检查 content 是否绑定具体一次事件（匹配 `SPECIFIC_EVENT_PATTERNS`）。如果是 → 矛盾，REJECT |
   | rule | `survives_without_project_nouns=true` | 检查 content 是否含项目专有名词（匹配 `PROJECT_NOUN_PATTERNS`）。如果含 → 矛盾，REJECT |
   | skill | `executable_with_generic_terms=true` | 同 rule 逻辑 |

2. **调用点**：在 `readSelfTest` 之后（[hostModelGovernanceAdapter.ts](../../services/memory-service/src/hostModelGovernanceAdapter.ts) 约 L934 之后），调用 `crossValidateSelfTest`。

3. **模式定义**：复用 `validateLayerBoundary` 已有的模式数组，提取为模块级常量：
   - `IMPL_SIGNALS`（代码实现细节关键词）— 已有
   - `TIME_SENSITIVE_PATTERNS`（时间敏感词）— 新增
   - `COMMON_KNOWLEDGE_PATTERNS`（常识性陈述）— 新增
   - `SPECIFIC_EVENT_PATTERNS`（具体事件绑定词）— 新增
   - `PROJECT_NOUN_PATTERNS`（项目专有名词）— 新增，需根据项目实际填充

**影响范围分析**：
- **直接影响**：所有带 self_test 的候选多一道交叉校验。
- **间接影响**：模式匹配可能有假阳性/假阴性。需要用 golden 50 数据集校准模式列表。

**测试方案**：
- Gate test：memory 候选 content 全是代码，self_test 声明 `about_user_not_code=true` → REJECT
- Gate test：memory 候选 content 是用户偏好，self_test 声明 `about_user_not_code=true` → 通过
- Gate test：rule 候选 content 含"PostgreSQL"，self_test 声明 `survives_without_project_nouns=true` → REJECT
- Eval：用 golden 50 数据集统计交叉验证的准确率

**风险**：
- 模式列表需要持续维护。建议提取到配置文件（如 `.trae/governance-patterns.json`），不硬编码在代码里。

### P1-4: source_refs excerpt 真实性校验

**目标**：校验 `source_excerpt` 是否真的出现在原始 session 文本里，防止模型编造来源。

**现状**：
- [hostModelGovernanceAdapter.ts:646-661](../../services/memory-service/src/hostModelGovernanceAdapter.ts#L646-L661) 只校验 rule 候选的 source_refs 包含完整对话轮次（user_message + assistant_message），不校验 excerpt 内容真实性。
- [governancePromptBuilder.ts:74-76](../../services/memory-service/src/governancePromptBuilder.ts#L74-L76) 有文字警告"commentary_messages 不是用户原话"，但没有事后校验。

**改动方案**：

1. **新增函数** `verifySourceExcerpt(sourceRefs, rawSessionText)`：
   - 从 governance-run 的 `raw_inputs` 中获取原始 session 文本（需确认 raw_inputs 的数据结构）
   - 对每个 source_ref 的 `source_excerpt`，检查是否是原始 session 文本的子串（允许模糊匹配：normalize 空白字符后做 includes 检查）
   - 匹配失败 → 标记该 source_ref 为"来源可疑"
   - 同批次内"来源可疑"比例 > 30% → 整批 REJECT

2. **调用点**：在 `validateCandidate` 的 source_refs 校验之后（[hostModelGovernanceAdapter.ts:661](../../services/memory-service/src/hostModelGovernanceAdapter.ts#L661) 附近）。

3. **降级策略**：如果 rawSessionText 不可用（如非 session 来源的候选），跳过此校验，不阻断。

**影响范围分析**：
- **直接影响**：所有带 source_refs 的候选多一道校验。
- **数据依赖**：需要 governance-run 入口能拿到原始 session 文本。需确认 `hostCaptureGovernanceRun.ts` 是否把 raw session text 传到 adapter 层。

**测试方案**：
- Gate test：source_excerpt 是原始 session 的真实子串 → 通过
- Gate test：source_excerpt 是模型编造的文本 → 标记"来源可疑"
- Gate test：同批次 4/10 候选 excerpt 编造 → 整批 REJECT

**风险**：
- 原始 session 文本可能很长，子串匹配性能需关注。建议先 normalize（去空白、转小写）再做 includes。
- 模型可能对 excerpt 做轻微改写（加省略号、截断），需要容忍。建议用"最长公共子序列"或"编辑距离"做模糊匹配，阈值 0.8。

---

## P2: session_outcomes 信号回路（方向四）

### P2-1: session_outcomes 加 SUPERSEDED outcome

**目标**：让 session_outcomes 能记录"这条知识当初的分类判断后来被证明是错的"。

**现状**：
- [0021_session_outcomes.sql:35-37](../../db/migrations/0021_session_outcomes.sql#L35-L37) outcome CHECK 约束只有 5 个值：`success / failure / failure_recovered / knowledge_outdated / abandoned`。
- 没有 SUPERSEDED 状态。

**改动方案**：

1. **新增 migration** `0031_session_outcomes_reward_hacking_signals.sql`：
   ```sql
   BEGIN;
   -- 加 SUPERSEDED outcome
   ALTER TABLE session_outcomes
     DROP CONSTRAINT IF EXISTS session_outcomes_outcome_check;
   ALTER TABLE session_outcomes
     ADD CHECK (outcome IN (
       'success', 'failure', 'failure_recovered',
       'knowledge_outdated', 'abandoned', 'superseded'
     ));

   -- 加"分类判断被推翻"信号字段
   ALTER TABLE session_outcomes
     ADD COLUMN IF NOT EXISTS classification_overturned boolean DEFAULT false,
     ADD COLUMN IF NOT EXISTS overturn_source text CHECK (overturn_source IN (
       'review_trace', 'l3_evolution', 'l2_conflict', 'manual_review', 'self_test_crosscheck'
     )),
     ADD COLUMN IF NOT EXISTS overturn_detected_at timestamptz;

   -- 索引：按"被推翻"筛选
   CREATE INDEX IF NOT EXISTS idx_session_outcomes_overturned
     ON session_outcomes (tenant_id, scope, classification_overturned)
     WHERE status = 'active' AND classification_overturned = true;

   -- 更新 knowledge_utility 视图：加"分类推翻率"指标
   CREATE OR REPLACE VIEW knowledge_utility AS
   SELECT
     UNNEST(retrieved_ids) AS entry_id,
     COUNT(*)::int AS total_recalls,
     COUNT(*) FILTER (WHERE outcome IN ('success', 'failure_recovered'))::int AS success_count,
     COUNT(*) FILTER (WHERE outcome IN ('failure', 'abandoned'))::int AS failure_count,
     COUNT(*) FILTER (WHERE outcome = 'knowledge_outdated')::int AS outdated_count,
     COUNT(*) FILTER (WHERE outcome = 'superseded')::int AS superseded_count,
     COUNT(*) FILTER (WHERE classification_overturned = true)::int AS classification_overturned_count,
     CASE WHEN COUNT(*) > 0
       THEN COUNT(*) FILTER (WHERE outcome IN ('success', 'failure_recovered'))::real / COUNT(*)
       ELSE NULL
     END AS utility_score,
     CASE WHEN COUNT(*) > 0
       THEN COUNT(*) FILTER (WHERE classification_overturned = true)::real / COUNT(*)
       ELSE NULL
     END AS classification_overturn_rate
   FROM session_outcomes
   WHERE status = 'active'
   GROUP BY UNNEST(retrieved_ids);
   COMMIT;
   ```

2. **更新 `recordSessionOutcome` 函数**（[knowledge.ts:1323-1368](../../libs/db/src/repositories/knowledge.ts#L1323-L1368)）：增加 `classificationOverturned` / `overturnSource` 参数。

3. **L3 演进扫描回流**：在 [L3EvolutionScanner.ts:284-344](../../services/memory-service/src/governance/L3EvolutionScanner.ts#L284-L344) SUPERSEDED 信号触发时，除了生成 governance_change_proposal，同时写一条 session_outcomes 记录（outcome='superseded', classification_overturned=true, overturn_source='l3_evolution'）。

**影响范围分析**：
- **直接影响**：session_outcomes 表结构变更，需跑 migration。
- **向后兼容**：新字段有默认值（false / null），历史数据不受影响。
- **视图变更**：knowledge_utility 视图重建，下游查询需确认字段兼容。

**测试方案**：
- Gate test：插入 outcome='superseded' 记录 → 成功
- Gate test：插入 classification_overturned=true 记录 → 成功
- Gate test：查询 knowledge_utility 视图 → 包含 classification_overturn_rate 字段
- Integration test：L3 演进扫描触发 SUPERSEDED → session_outcomes 自动写入

**风险**：
- migration 在生产库执行需确认无锁表风险。session_outcomes 表数据量需评估。

### P2-2: 审批推翻时回流 session_outcomes

**目标**：人工审批推翻候选的分类判断时，自动写一条 session_outcomes 记录。

**现状**：审批推翻走 `governance_change_proposal` 的 approval/reject 流程，不回流 session_outcomes。

**改动方案**：

1. 在审批处理逻辑中（需确认审批处理的代码位置，可能在 `hostActionExecutor.ts` 或 `hostAction.ts`），当候选的 `promotion_status` 从 approved 变为 rejected 且原因是"分类错误"时，调用 `recordSessionOutcome` 写一条 `classification_overturned=true, overturn_source='manual_review'` 的记录。

2. 在 [L2ConflictDetector.ts](../../services/memory-service/src/governance/L2ConflictDetector.ts) 检测到冲突并推翻初判时，同样回流 `overturn_source='l2_conflict'`。

**影响范围分析**：
- 需确认审批处理的代码路径。改动面可能涉及多个文件。

**测试方案**：
- Integration test：审批推翻候选 → session_outcomes 自动写入 classification_overturned 记录
- Integration test：L2 冲突推翻初判 → session_outcomes 自动写入

**风险**：
- 审批处理逻辑可能分散在多处，需全面排查。

---

## P3: 动态复核 + 哨兵（方向三，低成本部分）

### P3-1: review_trace 轮换提示词

**目标**：不让模型靠"记住复核套路"应付过关。

**现状**：
- [governancePromptBuilder.ts:234-251](../../services/memory-service/src/governancePromptBuilder.ts#L234-L251) 是单一固定字符串。
- 提示词原文："完成 classification_trace 后，假装你是另一个完全没有看过这次对话的模型，只看这条候选的 title + content，重新判断它该归哪一层"。

**改动方案**：

1. **准备 3-5 个语义等价但措辞不同的复核提示词版本**：
   - 版本 A（当前）：假装你是另一个模型...
   - 版本 B：忽略上面的分类过程，只看 title 和 content，如果这是你第一次见到这段内容，你会把它归到哪一层？
   - 版本 C：作为一个没参与分类的复核员，你的任务是验证这个分类是否合理。只依据 title 和 content 做判断，不要被上面的 reasoning 影响。
   - 版本 D：假设上面的 classification_trace 不存在，仅凭 title + content，这条候选应该属于哪一层？给出你的独立判断。
   - 版本 E：换位思考——如果你是审批人，只看 title 和 content（不看 classification_trace），你会把它分到哪一层？为什么？

2. **轮换策略**：按 `traceId` 的 hash 值取模选择版本，确保同一条候选每次跑都用同一版本（可复现），但不同候选用不同版本。

3. **改动文件**：
   - [governancePromptBuilder.ts](../../services/memory-service/src/governancePromptBuilder.ts)：把单一字符串改为数组，新增 `selectReviewPrompt(traceId)` 函数。
   - [hostModelGovernanceAdapter.ts](../../services/memory-service/src/hostModelGovernanceAdapter.ts)：在调用 governancePromptBuilder 时传入 traceId。

**影响范围分析**：
- **直接影响**：review_trace 的提示词变化，模型生成的 review_reasoning 风格会多样化。
- **向后兼容**：已有的 review_trace 数据不受影响。

**测试方案**：
- Gate test：同一 traceId 两次调用 → 返回同一版本
- Gate test：不同 traceId → 版本分布均匀（用 100 个 traceId 测统计分布）
- Eval：对比轮换前后的 review_trace 质量（consensus 分歧率、套话检出率）

**风险**：
- 低风险。提示词变化不影响 schema 校验。

### P3-2: canary 哨兵候选注入

**目标**：治理运行时混入已知正确答案的测试候选，检测模型是否在走过场。

**现状**：全仓无 canary 机制。

**改动方案**：

1. **新增 canary 模板池** `canaryTemplates.json`（放在 `services/memory-service/src/governance/` 下）：
   - 10-20 条人工标注好的测试候选
   - 每条包含：title, content, candidate_type, 期望的 classification_trace, 期望的 review_trace, 期望的 self_test
   - 覆盖四种类型（rule/memory/skill/knowledge）+ 各种边界情况（套话/跨层/模糊）

2. **注入逻辑**：在 `applyHostModelGovernanceResult`（[hostModelGovernanceAdapter.ts:72-133](../../services/memory-service/src/hostModelGovernanceAdapter.ts#L72-L133)）入口处：
   - 每隔 N 次 governance-run（N=20，可配置），随机选 1 条 canary 模板
   - 把 canary 候选混入正常批次，模型不知道这是测试
   - canary 候选标记 `is_canary: true`（内部字段，不传给模型）

3. **期望行为校验**：在 `validateCandidate` 之后，对 canary 候选做额外校验：
   - 模型的 classification_trace 是否与期望一致？
   - 模型的 self_test 是否与期望一致？
   - 不一致 → 记录 canary miss，触发同批次其他候选的额外复核（标记 `needs_deep_review`）
   - 不阻断入库（canary 候选不入库），只记录指标

4. **监控指标**：canary 命中率 = canary 判断正确数 / canary 总注入数。长期追踪，命中率下降 → 预警。

**影响范围分析**：
- **直接影响**：每 20 次 governance-run 多 1 条 canary 候选的处理开销（极小）。
- **数据依赖**：需要人工标注 10-20 条 canary 模板。这是工作量主要来源。

**测试方案**：
- Gate test：canary 候选注入 → 模型不知情（canary 标记不泄漏到提示词）
- Gate test：canary 判断正确 → 记录 hit
- Gate test：canary 判断错误 → 记录 miss + 触发同批次额外复核标记
- Eval：用 golden 50 数据集模拟 canary，统计命中率

**风险**：
- canary 模板需要定期更新，否则模型可能"记住"模板（如果是同一模型生成的）。建议 canary 模板用人工标注，不用模型生成。
- canary 候选不能入库，需在 `consolidateCandidates` 阶段过滤掉。

---

## P4: 需要外部 LLM 基础设施（不在本轮 spec 范围）

以下改动需要先建外部 LLM 调用基础设施，当前项目只有 `embeddingProvider.ts`（只做 embedding）。建议单独立项：

| 改动 | 依赖 | 说明 |
|---|---|---|
| 真正独立模型复核 | 外部 LLM 调用服务 | review_trace 不再由同一模型生成，而是调用独立 LLM |
| 同构扰动测试 | 外部 LLM 调用服务 + 扰动生成器 | 对候选做等价改写后让 LLM 重新分类，检测一致性 |
| 随机深度抽查 | 外部 LLM 调用服务 | 5-10% 候选用更强模型/更长思考时间复核 |

**建议**：先做 P0-P3，积累 canary 命中率和分类推翻率数据后，再评估是否需要建 LLM 基础设施。如果 P0-P3 已经把投机取巧率压到可接受范围，P4 可以暂缓。

---

## 投机行为率监控（接进现有审批页面，不做独立看板）

五个指标，作为 governance 审批页面的健康度卡片：

| 指标 | 数据来源 | 计算方式 |
|---|---|---|
| 哨兵候选命中率 | canary 注入日志 | hit_count / total_canary_count |
| 套话/雷同检出率 | P1-1 + P1-2 校验日志 | rejected_by_specificity + rejected_by_intra_batch / total_candidates |
| 深浅复核分歧率 | P4（暂不可用） | 暂记为 N/A，P4 落地后补充 |
| 同构扰动一致率 | P4（暂不可用） | 暂记为 N/A，P4 落地后补充 |
| 分类判断被推翻率 | P2 session_outcomes | classification_overturned_count / total_recalls |

**实现方式**：在 governance 审批页面（需确认前端代码位置）加一个"治理健康度"面板，展示这五个指标的趋势图。数据从 session_outcomes + canary 日志聚合。

---

## 落地顺序与依赖关系

```
P0-1 (MCP schema 收紧) ──────────────────────── 无依赖，先做
  │
  ├─→ P1-1 (n-gram 具体性校验) ──────────────── 依赖 P0-1 确保三件套必填
  ├─→ P1-2 (跨候选雷同检测) ─────────────────── 依赖 P1-1 的工具函数
  ├─→ P1-3 (self_test 交叉验证) ─────────────── 无依赖，可与 P1-1 并行
  └─→ P1-4 (source_refs 真实性) ─────────────── 无依赖，可与 P1-1 并行

P2-1 (session_outcomes SUPERSEDED) ──────────── 无依赖，越早加越早有数据
P2-2 (审批推翻回流) ────────────────────────── 依赖 P2-1

P3-1 (review 轮换提示词) ────────────────────── 无依赖，低成本低风险
P3-2 (canary 哨兵注入) ──────────────────────── 依赖 canary 模板池人工标注

P4 (外部 LLM 基础设施) ──────────────────────── 不在本轮范围
```

**建议执行顺序**：
1. P0-1（先堵最大漏洞）
2. P1-1 + P1-3 + P1-4（并行，确定性校验加强）
3. P2-1（数据越早积累越好）
4. P1-2（复用 P1-1 工具函数）
5. P3-1（低成本低风险）
6. P2-2 + P3-2（依赖前面）

---

## 质量检查清单

每个改动落地前必须确认：

- [ ] 改动文件路径和行号已确认（不是猜测）
- [ ] 改动前后的代码差异已写明
- [ ] Gate test 覆盖正向 + 反向用例
- [ ] Eval 用 golden 50 数据集验证（如涉及分类质量）
- [ ] 影响范围已分析（直接 + 间接 + 向后兼容）
- [ ] 阈值/配置项已提取为常量或配置文件（不硬编码）
- [ ] 现有工具函数已复用（不重复造轮子）
- [ ] 改动不破坏现有 governance-run 流程（回归测试通过）

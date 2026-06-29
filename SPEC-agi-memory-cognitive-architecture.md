# 认知架构升级：加权遗忘 + LLM 元认知

## 目标

把 fix-4（遗忘机制）和 fix-6（元认知）从"第一步"推进到"最后一步"——让系统从"TTL binary 归档 + 规则加权求和"升级到"基于认知科学的重要性加权衰减 + LLM 驱动边界评估"。这两个转变完成后，系统满足"AGI 记忆"标签的第三条标准。

## 决策记录

### fix-6 LLM 驱动元认知

- **LLM 调用时机：仅低置信时调**
  - 来源：用户指定
  - 规则版本先算 overall_confidence
  - < 0.4 时升级到 LLM 推理（对应现有 boundary.status='unknown' 阈值）
  - 高置信查询不调 LLM，省成本省延迟

- **保留规则版本作为 baseline + 降级**
  - 来源：代码库推断
  - 规则版本继续跑，作为 LLM 的输入 baseline
  - LLM 不可用时回退到规则版本

- **LLM 输入：query + retrieve 结果摘要 + 规则 baseline**
  - 来源：代码库推断
  - 给 LLM 喂：用户查询、retrieve 命中的各层条目、规则版本算的 confidence_basis
  - 让 LLM 在此基础上推理"我知道的边界在哪"

- **LLM 输出格式：保持现有 MetacognitionAssessment schema**
  - 来源：代码库推断
  - 不改 schema，只是 boundary / coverage_areas / knowledge_gaps 的内容由 LLM 生成而非规则
  - recommended_actions 由 LLM 判断（可以超出预设的 4 个值）

### 召回质量评估（新增维度，fix-6 修正）

- **区分"知识真没有" vs "有但没召回"**
  - 来源：用户访谈决策（"查询词项命中率"）
  - 复用 buildMetacognitionAssessment 已有的 knowledge_gaps.term/hit 字段
  - 新增 retrieve_quality 字段，三态：good / partial / poor

- **retrieve_quality 计算规则**
  - term_hit_ratio = knowledge_gaps.filter(hit).length / knowledge_gaps.length
  - good（>= 0.6）：查询词大部分命中，召回正常
  - partial（0.3-0.6）：部分命中，可能召回有问题
  - poor（< 0.3）：查询词几乎没命中，知识库真的没有 OR 召回算法严重失败

- **retrieve_quality 修正 confidence trigger 逻辑**
  - 原来：overall_confidence < 0.4 → trigger LLM
  - 修正后：分三种情况
    - confidence < 0.4 AND retrieve_quality='good' → 知识真没有，trigger LLM 推理边界
    - confidence < 0.4 AND retrieve_quality='poor' → 召回可能失败，不 trigger LLM，标记 recommended_actions 加 "retrieve_quality_poor_investigate"
    - confidence < 0.4 AND retrieve_quality='partial' → trigger LLM，但 prompt 提示"召回可能不完整"
  - 这避免了"召回失败被误判成知识缺口"的循环依赖

- **retrieve_quality 也用于 importance_weight 归档保护**（与 fix-4 联动）
  - 见下方"归档保护"

### fix-4 加权衰减（修正）

- **retrieve 用法：排序 + 软过滤 + 硬归档兜底（软硬兼施）**
  - 来源：用户指定（"软硬兼施，删除一定要存在，但取决于抽取效果"）
  - 软过滤层：retrieve 时按 importance_weight 排序，低权重沉底，applyContextBudget 自然裁掉
  - 硬归档层：importance_weight < 阈值持续 N 天 → archived（取代 90 天时间 TTL）

- **TTL 改成加权衰减驱动**
  - 来源：用户指定
  - 不再用"90 天没召回"的时间硬阈值
  - 改成"importance_weight < 0.2 持续 30 天"→ archived
  - 30 天窗口避免短期波动误归档

- **归档保护：避免"召回失败导致误归档"**
  - 来源：用户访谈决策（"加召回失败保护"）
  - 归档前检查：如果该条知识长期没被召回，但同期其他知识的召回率正常，那这条该归档
  - 如果同期整体 retrieve_quality 都低（说明 retrieve 算法有问题），不归档——这是 retrieve 的锅，不是知识的锅
  - 实现：归档候选集（importance_weight < 0.2 持续 30 天）出来后，对每个候选检查"最近 30 天内同 scope 的平均 retrieve_quality"
    - 平均 retrieve_quality='good' → 确认归档
    - 平均 retrieve_quality='poor' → 跳过归档，记日志 "skipped archival due to poor retrieve quality"

- **三因子权重比例：Recency 0.3 / Frequency 0.3 / Utility 0.4**
  - 来源：代码库推断（基于用户对 session_outcomes → utility_score → retrieve ranking 链路的重视）
  - Utility 权重最高（0.4），因为 outcome 信号是"使用时有没有帮上忙"的直接证据
  - Recency 和 Frequency 各 0.3，时间衰减和召回频率同等重要
  - 注意：recency 因子受归档保护约束，retrieve 失败不会导致 recency 单方面衰减到归档

- **衰减触发时机：lifecycleWorker 定期重算**
  - 来源：性能推断
  - 不做实时计算（每次 retrieve 都算 importance_weight 太重）
  - lifecycleWorker 跑完归档后重算所有 active 知识的 importance_weight

- **数据不足降级：session_outcomes < 300 条时全用 0.5**
  - 来源：代码库推断（当前 81 条，48 条 no_signal）
  - 数据不够时 importance_weight 全部 0.5（不惩罚新知识），等数据攒够再启用加权
  - 这意味着 fix-4 的"硬归档"在数据攒够前不会真正归档任何东西

## 假设

### fix-4 假设（需用户确认）

- 假设 importance_weight 归档阈值 = 0.2，原因：三因子加起来 < 0.2 意味着 recency 低 + frequency 低 + utility 低，三条都满足的知识确实该归档
- 假设 归档持续天数 = 30 天，原因：避免短期波动（某条知识刚好一个月没被问到）导致误归档
- 假设 数据启用阈值 = 300 条 session_outcomes，原因：当前 81 条不够撑加权模型，300 条是统计意义上的最小样本量
- 假设 decay_constant = 30 天，原因：recency_score = exp(-days/30)，30 天内召回过的知识 recency > 0.37，60 天后 < 0.14，90 天后 < 0.05
- 假设 importance_weight 不影响 L4 合成（本期不做），原因：L4 合成优先级是另一个架构决策，本期只管 retrieve 排序 + 归档。如果后续要让 L4 按权重优先合成，再补 SPEC
- 按惯例处理：归档的知识不物理删除，只改 lifecycle_state='archived'，后期可恢复

### fix-6 假设（需用户确认）

- 假设 低置信阈值 = 0.4，原因：跟现有 boundary.status='unknown' 阈值一致，规则版本 < 0.4 时才升级到 LLM
- 假设 LLM 调用走 KnowledgeModelWorker（跟 fix-3 L4 合成同一个通道），原因：统一 LLM 调用入口，不另建通道
- 假设 LLM 元认知的 prompt 在实现时设计，不在 SPEC 里定死，原因：prompt 是实现细节，需要迭代调试
- 按惯例处理：LLM 元认知输出记 trace_id，方便审计

## 实现范围

### 做

#### fix-6 LLM 驱动元认知

6. **新增 retrieve_quality 评估**（retrieveBundle.ts，buildMetacognitionAssessment 内）
   - 复用 knowledge_gaps.term/hit 字段
   - 计算 term_hit_ratio = hits / total
   - 三态：good (>=0.6) / partial (0.3-0.6) / poor (<0.3)
   - 写入 metacognition.retrieve_quality 字段（schema 新增此字段）

7. **新增 KnowledgeModelWorker.assessMetacognition 函数**（knowledgeModelWorker.ts）
   - 输入：query + retrieve 结果摘要 + 规则 baseline + retrieve_quality
   - 输出：MetacognitionAssessment（保持现有 schema + retrieve_quality）
   - 走 KnowledgeModelWorker 统一 LLM 通道（跟 fix-3 同入口）

8. **改 buildMetacognitionAssessment → 三阶段**（retrieveBundle.ts）
   - 阶段 1：规则版本照算（现有逻辑 + retrieve_quality）
   - 阶段 2：判断 trigger
     - confidence >= 0.4 → method='rule'
     - confidence < 0.4 AND retrieve_quality='good' → method='llm'，调 LLM 推理
     - confidence < 0.4 AND retrieve_quality='poor' → method='rule'，加 recommended_action='retrieve_quality_poor_investigate'
     - confidence < 0.4 AND retrieve_quality='partial' → method='llm'，prompt 提示"召回可能不完整"
   - 阶段 3：LLM 失败时回退规则版本，method='llm_fallback'

9. **openapi.yaml 加 metacognition.method + retrieve_quality 字段**
   - method: "rule" | "llm" | "llm_fallback"
   - retrieve_quality: "good" | "partial" | "poor"

#### fix-4 加权衰减

10. **新增 kp_synthesized_knowledge.importance_weight 字段**（migration 0026）
    - double precision, default 0.5
    - 加 importance_weight_updated_at timestamptz
    - 加索引：(tenant_id, scope, importance_weight) WHERE status='active' AND lifecycle_state='curated'

11. **新增 recomputeImportanceWeights 函数**（libs/db/repositories/knowledge.ts）
    - 查所有 active + curated 的合成知识
    - 对每条算 importance_weight = 0.3×recency + 0.3×frequency + 0.4×utility
    - recency = exp(-days_since_last_recall / 30)
    - frequency = log(1 + recall_count) / log(1 + max_recall_count_in_scope)
    - utility = knowledge_utility.utility_score ?? 0.5
    - session_outcomes < 300 条时全写 0.5（降级模式）
    - 批量 UPDATE + 更新 importance_weight_updated_at

12. **改 archiveStaleSynthesizedKnowledge**（libs/db/repositories/knowledge.ts）
    - 从"90 天 last_recalled_at"改成"importance_weight < 0.2 AND importance_weight_updated_at < now() - 30 days"

13. **归档保护：新增 retrieve_quality 历史表 + 归档前检查**（libs/db/repositories/knowledge.ts）
    - 新增 kp_retrieve_quality_log 表（migration 0027）：记录每次 retrieve 的 tenant/scope/trace_id/term_hit_ratio/retrieve_quality/created_at
    - buildMetacognitionAssessment 算出 retrieve_quality 后写入此表
    - archiveStaleSynthesizedKnowledge 归档前查最近 30 天同 scope 的平均 term_hit_ratio
      - 平均 >= 0.4 → 确认归档（retrieve 正常，知识确实没用）
      - 平均 < 0.4 → 跳过归档，记日志 "skipped archival due to poor retrieve quality"

14. **改 applyUtilityRanking → applyImportanceRanking**（retrieveBundle.ts）
    - 排序键从 utility_score 改成 importance_weight
    - NULL（无信号）仍排最后
    - 不做硬过滤——低权重的沉底，applyContextBudget 自然裁

15. **lifecycleWorker 接入**
    - 归档前先调 recomputeImportanceWeights
    - 然后 archiveStaleSynthesizedKnowledge 用新条件 + 归档保护
    - 返回值加 reweighted_knowledge_count, skipped_archival_count

### 不做（本期）

- importance_weight 不影响 L4 合成优先级（后续再补）
- importance_weight 不影响 rules / factual_memory / procedural_memory 排序（只管 synthesized_knowledge）
- LLM 元认知不改 MetacognitionAssessment schema（只改内容来源）
- 不做 importance_weight 的手动覆盖接口（后续如果需要再加）
- 不做加权衰减的可视化看板（后续如果需要再加）

## 资源维护闭环

- **importance_weight 字段**：
  - 新增：migration 0026 加字段
  - 查看：getKnowledgeUtility 已有，加 importance_weight 返回
  - 编辑：不手动编辑，lifecycleWorker 自动重算
  - 状态：active + curated 的才参与计算
  - 删除：归档（archived）的不参与计算
  - 测试验证：recomputeImportanceWeights 跑完后验证 importance_weight 在 0-1 之间
  - 审计：importance_weight_updated_at 记录上次计算时间

- **LLM 元认知**：
  - 新增：KnowledgeModelWorker.assessMetacognition 函数
  - 查看：retrieve response 的 metacognition.method 字段
  - 状态：rule / llm / llm_fallback
  - 测试验证：低置信查询触发 LLM，高置信不触发
  - 审计：trace_id 贯穿

## 链路反推

- **retrieve 使用者**：AI agent 调 retrieve，拿到 metacognition 字段
  - 高置信（>= 0.4）：metacognition.method='rule'，直接用规则版本
  - 低置信（< 0.4）：metacognition.method='llm'，LLM 推理了边界
  - LLM 失败：metacognition.method='llm_fallback'，回退规则

- **importance_weight 计算链路**：
  - session_outcomes → knowledge_utility 视图 → utility_score
  - memory_access_log → recall_count
  - last_recalled_at → recency_score
  - 三者加权 → importance_weight
  - lifecycleWorker 定期重算

- **关键保护**：
  - 数据不足时 importance_weight=0.5（不惩罚新知识）
  - LLM 不可用时回退规则版本
  - 归档不物理删除，可恢复

## 验收标准

### fix-6 验收

- retrieve_quality 字段在所有 retrieve 响应中都存在（good/partial/poor）
- term_hit_ratio 计算正确：空知识库时 = 0（poor），全命中时 = 1（good）
- 高置信查询（overall_confidence >= 0.4）：metacognition.method='rule'，不调 LLM
- 低置信 + retrieve_quality='good'：metacognition.method='llm'，调 LLM 推理边界
- 低置信 + retrieve_quality='poor'：metacognition.method='rule'，recommended_actions 含 'retrieve_quality_poor_investigate'，不调 LLM
- 低置信 + retrieve_quality='partial'：metacognition.method='llm'，调 LLM
- LLM 不可用时：metacognition.method='llm_fallback'，回退规则版本
- 测试：构造一个空知识库查询（必然 confidence 低 + retrieve_quality='poor'），验证不调 LLM
- 测试：构造一个有知识但查询词不对的查询（confidence 低 + retrieve_quality='partial'），验证调 LLM

### fix-4 验收

- recomputeImportanceWeights 跑完后，所有 active+curated 合成知识的 importance_weight 在 [0, 1] 之间
- session_outcomes < 300 条时，importance_weight 全部 = 0.5（降级模式）
- archiveStaleSynthesizedKnowledge 用新条件（importance_weight < 0.2 AND updated_at < 30 天前）
- 归档保护生效：当 retrieve_quality_log 最近 30 天平均 term_hit_ratio < 0.4 时，不归档
- retrieve 排序按 importance_weight 降序，NULL 排最后
- 测试：插入一条 importance_weight=0.1, updated_at=31天前, 平均 retrieve_quality=0.8 的知识，跑 lifecycleWorker，验证被归档
- 测试：插入一条 importance_weight=0.1, updated_at=31天前, 平均 retrieve_quality=0.2 的知识，跑 lifecycleWorker，验证**不**被归档（retrieve 失败保护）
- 测试：插入一条 importance_weight=0.1, updated_at=10天前的知识，跑 lifecycleWorker，验证不被归档（30 天窗口保护）

## 用户偏好记录（本次新增）

- 用户倾向"软硬兼施"：不是非黑即白，软过滤和硬归档可以共存
- 用户重视"抽取效果"：如果加权衰减效果好，硬归档可以少用；效果一般时硬归档是必须的
- 用户接受"仅低置信时调 LLM"的 trade-off：不为高置信查询付额外成本
- 用户要求"区分因果"：降权/归档必须区分"知识本身不行" vs "召回算法不行"，不能让 retrieve 失败的锅扣在知识头上
- 用户倾向"复用已有信号"：retrieve_quality 用 knowledge_gaps 已有的 term/hit 字段，不另起炉灶

---

## fix-9 抽取链路修复（自检后追加，架构认知纠正版）

### 架构认知纠正（关键）

自检后发现原 SPEC 基于错误的架构认知：
- **错误认知**：memory-service 是独立服务，自己调 LLM（KNOWLEDGE_MODEL_ENDPOINT）
- **正确认知**：memory-service 是 MCP 插件后端，通过 `memory-mcp-server` 暴露 MCP 工具给宿主（TRAE/Qoder/Codex/CC）。**所有 LLM 调用都在宿主侧**，memory-service 不应该自己调 LLM

真实交互流程（两步式 MCP dance）：
```
Step 1: 宿主调 memory_retrieve_context / memory_run_governance 等 MCP 工具
Step 2: memory-mcp-server 转发给后端 memory-service（HTTP）
Step 3: memory-service 返回结果（含 mission_brief 如果需要宿主做 LLM 评估）
Step 4: 宿主拿到结果后自己决定是否调 LLM 评估/合成
Step 5: 宿主再调 MCP 工具回写 LLM 结果（如需要）
```

### 触发原因

fix-8 自检发现：fix-8 加权衰减 + 归档保护机制验证时假设数据库里有真实合成知识，但实际查证后暴露 4 个炸雷：

1. **31 条合成知识是野数据**：`governance_job_id` 全部 null（0/31 有关联 job），metadata 所有字段（source_kind / host / thread_id / governance_mode / provider / synthesis_type）全部 null。不是正经抽取链路产物，是旁路塞的野数据。
2. **KnowledgeModelWorker 的 LLM 通道设计错误**：
   - `analyze` / `synthesize` / `assessMetacognition` 三个方法都走 `KNOWLEDGE_MODEL_ENDPOINT` HTTP fetch
   - 这是"memory-service 自己调 LLM"的设计，跟 MCP 架构冲突
   - endpoint 未配置 → 三个方法全部降级或 return null
   - 实际宿主 LLM 通过 `host_model_result.extraction_preview` 通道传进来（通道 A 已接），但 metadata 没写 `provider` 字段
3. **上游数据稀烂**：`kp_fact` 只有 1 条，`kp_document` = 0 条，`session_outcomes` 33 条（< 300 触发降级模式）。
4. **utility_score 字段在 schema 里不存在**：SPEC 原写 `importance_weight = 0.3×recency + 0.3×frequency + 0.4×utility`，retrieveBundle.ts 有回退到 `utility_score` 的代码，但 `kp_synthesized_knowledge` 实际无此列。当前没炸只是因为 `session_outcomes<300` 走降级路径没 SELECT 这列，样本够 300 时会 SQL error。

### 抽取链路代码梳理（自检结果）

```
memory_candidate（candidateIngress.ts）
    ↓ 触发 governance job
hostCaptureGovernanceRun.ts / knowledgeGovernance.ts
    ↓ 调 KnowledgeModelWorker.analyze 抽取 entity / fact
createKnowledgeFact (knowledge.ts L868)
    ↓ 调 KnowledgeModelWorker.synthesize 产生合成知识
createSynthesizedKnowledge (knowledgeGovernance.ts L1044 / L4CognitiveEngine.ts L679 / hostCaptureGovernanceRun.ts L691/L1414)
```

代码全在，**缺的是触发和配置**：
- 没人主动触发 governance job（需要外部 API 调用或 host_capture 流程）
- `synthesize()` 因配置缺失直接 return null

### 决策记录（用户确认，架构认知纠正后）

- **优先级：先修抽取链路**
  - 来源：用户访谈决策
  - 理由：fix-8 遗忘机制本身设计没错，但优化对象是 31 条野数据 = 在空数据上调优。先让合成链路产出真实知识，fix-8 才有意义。

- **utility_score：加 migration 创建 utility_score 列**
  - 来源：用户访谈决策
  - 理由：诚实承认 schema 缺这列，加 0028 migration 创建。
  - 字段定义：`utility_score double precision`（nullable，旧数据默认 NULL）
  - 写入责任：暂由 recomputeImportanceWeights 内部从 retrieve_quality_log 反推（avg term_hit_ratio 高 → utility 高），不在合成时写入。后期可加显式 utility 信号源。

- **31 条野数据：全删**
  - 来源：用户访谈决策
  - 理由：governance_job_id=null、metadata 全空，是旁路塞的野数据，内容是元认知报告不是 reusable knowledge；留着会污染 retrieve 和 importance_weight 计算。

- **通道 A 不补 provider 字段**
  - 来源：用户访谈决策
  - 理由：metadata 已有 governance_mode='host_model' 能区分来源，再加 provider 冗余。

- **彻底删掉 KNOWLEDGE_MODEL_ENDPOINT 依赖**
  - 来源：用户访谈决策
  - 理由：MCP 架构下所有 LLM 调用都在宿主侧，memory-service 不应该自己调 LLM。KnowledgeModelWorker 的 analyze/synthesize/assessMetacognition 三个方法对 KNOWLEDGE_MODEL_ENDPOINT 的 HTTP fetch 全部删除。
  - 改造方向：
    - `analyze`：改成从 host_model_result 读取（宿主在 governance-run 时传进来）
    - `synthesize`：改成从 host_model_result.synthesis_result 读取（扩展 host_model_result schema）
    - `assessMetacognition`：改成返回规则版本 + mission_brief（如果需要 LLM 评估），让宿主自己做

- **lifecycle 改成非周期性维护，只做用户显式调用**
  - 来源：用户访谈决策 + 补充说明
  - 用户原话："lifecycle 改成非周期性维护，只做用户显式调用；或者默认加一条规则多少天要跑一下，到时候相当于给宿主挂一个定时任务或者怎么样；这条路要是不行，就走用户直接显式调用"
  - 改造方向：
    - lifecycle 不再自动跑（去掉 governance-run 完成后的自动触发）
    - 暴露为 MCP 工具，宿主显式调用
    - 或加一条规则 N 天跑一次，宿主侧定时任务调用
    - 当前 fix-9 先做"暴露为 MCP 工具"，定时任务留后续

- **assessMetacognition 交给宿主 LLM**
  - 来源：用户访谈决策
  - 用户原话："必须要交给宿主LLM，怎么可能会不在调用呢，我们这个是以插件/mcp的方式接入trae，qoder，codex，cc这种软件，不应该会出现这种情况"
  - 改造方向：
    - 删掉 assessMetacognition 对 KNOWLEDGE_MODEL_ENDPOINT 的依赖
    - retrieve 返回规则版本结果
    - 如果 method='llm'（需要 LLM 评估），retrieve 返回附加 mission_brief 让宿主自己做
    - 宿主做完 LLM 评估后，可调新 MCP 工具回写结果（或直接用，不回写）

- **通道 B（memory-service 内部二次合成）接宿主 LLM 的方式：扩展 host_model_result**
  - 来源：用户访谈决策
  - 改造方向：宿主调 governance-run 时，host_model_result 里除了 extraction_preview，再传一个 synthesis_result 字段。hostCaptureGovernanceRun 用 host_model_result.synthesis_result 替代 modelWorker.synthesize()。

### 实现范围（fix-9，架构认知纠正后）

#### 做

1. **加 migration 0028：创建 utility_score 列**
   - `db/migrations/0028_synthesized_knowledge_utility_score.sql`
   - `ALTER TABLE kp_synthesized_knowledge ADD COLUMN IF NOT EXISTS utility_score double precision;`
   - 不设默认值（NULL 表示无信号，应用层处理）

2. **改 recomputeImportanceWeights：utility 因子从 retrieve_quality_log 反推**
   - 同 scope 最近 30 天平均 term_hit_ratio 映射到 utility_score（0.0-1.0）
   - 写入 `kp_synthesized_knowledge.utility_score`
   - 三因子加权保持 `0.3×recency + 0.3×frequency + 0.4×utility`

3. **改 applyImportanceRanking：utility_score 回退逻辑保留**
   - 字段存在后回退逻辑就有意义了
   - 不需要改代码，确认现有逻辑生效

4. **清掉 31 条野数据**
   - `DELETE FROM kp_synthesized_knowledge WHERE tenant_id='tenant-local' AND scope='memory.validation'`
   - 同时清 `kp_retrieve_quality_log`（避免归档保护逻辑基于野数据时期的 retrieve 数据）
   - 不清 `kp_fact` 和 `kp_evidence`（这些是真实抽取的，留着合成链路复用）

5. **彻底删掉 KnowledgeModelWorker 对 KNOWLEDGE_MODEL_ENDPOINT 的依赖**
   - `analyze()`：改成从 host_model_result 读取，去掉 HTTP fetch 逻辑
   - `synthesize()`：改成从 host_model_result.synthesis_result 读取，去掉 HTTP fetch 逻辑
   - `assessMetacognition()`：改成返回 null + mission_brief，去掉 HTTP fetch 逻辑
   - 保留 `heuristicAnalyze` / `heuristicSynthesize` 作为降级路径（可选）
   - 删掉 `KNOWLEDGE_HEURISTIC_SYNTHESIS_ENABLED` 环境变量依赖（启发式合成不再启用）

6. **host_model_result schema 实际不需要扩展（自检纠正）**
   - 原计划：加 synthesis_result 字段，让宿主传合成结果
   - 实际查证：[hostCaptureGovernanceRun.ts L691](file:///c:/Users/yangy/.qoderworkcn/workspace/mq988j0j137zwdp8/agi-memory-src/services/memory-service/src/hostCaptureGovernanceRun.ts#L691) 已经直接用 `host_model_result.extraction_preview.knowledge_candidates` 创建 synthesized_knowledge
   - knowledge_candidates 就是宿主 LLM 的合成结果，通道 A 一直在工作
   - 之前误判"31 条野数据是种子"是因为 metadata 没写 provider 字段，不是通道 A 没接
   - KnowledgeModelWorker.synthesize 是给"基于 fact 的二次合成"用的（knowledgeGovernance/L4CognitiveEngine 调用），跟通道 A 互补
   - synthesize return null 后调用方已有 null 检查（[L4CognitiveEngine L641](file:///c:/Users/yangy/.qoderworkcn/workspace/mq988j0j137zwdp8/agi-memory-src/services/memory-service/src/governance/L4CognitiveEngine.ts#L641) / [knowledgeGovernance L987](file:///c:/Users/yangy/.qoderworkcn/workspace/mq988j0j137zwdp8/agi-memory-src/services/memory-service/src/knowledgeGovernance.ts#L987)），走降级路径不崩溃

7. **retrieve 时 assessMetacognition 改造**
   - 删掉 `retrieveBundle.ts` 里对 `assessMetacognition` 的调用（L879-950 的 LLM 三阶段逻辑）
   - 改成：如果 method='llm'，retrieve 返回规则版本结果 + `metacognition_mission_brief` 字段
   - 宿主拿到 mission_brief 后自己做 LLM 评估
   - 宿主做完后可调新 MCP 工具 `memory_submit_metacognition` 回写（可选，不回写也能用）

8. **lifecycle 改成 skill 触发**
   - 去掉 [app.ts L764](file:///c:/Users/yangy/.qoderworkcn/workspace/mq988j0j137zwdp8/agi-memory-src/services/memory-service/src/app.ts#L764) governance-run 完成后的自动 lifecycle 触发
   - 去掉 [governanceRun.ts L95](file:///c:/Users/yangy/.qoderworkcn/workspace/mq988j0j137zwdp8/agi-memory-src/services/memory-service/src/governanceRun.ts#L95) 的 lifecycle 自动调用
   - 不新增 MCP 工具，**改用 skill 触发**
   - 写一个 `memory-lifecycle` SKILL.md（位置：`.trae/skills/memory-lifecycle/SKILL.md`），描述："当用户说整理记忆/跑生命周期/清理过期知识时，调用 memory_run_governance（或合适的 MCP 工具）触发 LifecycleWorker"
   - 定时任务能力缺失（skill 是被动触发），用户原话"加一条规则多少天要跑一下，到时候相当于给宿主挂一个定时任务"留后续

9. **废弃文件清理（用户强制要求）**
   - 删 6 个 `.trae/skills/l1-test-skill-*/` 目录（L1 测试残留，跟生产无关）
   - 删 `scripts/` 里废弃验证脚本（逐一筛选，保留还在用的工具脚本如 cleanup-all.mjs / generate-contracts.mjs / generate-schema-snapshot.mjs 等）
   - 删 `knowledgeModelWorker.ts` 里 `analyze` / `synthesize` / `assessMetacognition` 三个方法的 HTTP fetch 代码
   - 删 `retrieveBundle.ts` L879-950 的 LLM 三阶段逻辑
   - **后续每次做完废弃或新链路，必须同步清理测试文件和废弃文件**（用户原话）

#### 不做（本期）

- 不做 lifecycle 定时任务规则（用户提到的"N 天跑一次"，需要宿主侧定时器，留后续）
- 不做 `memory_submit_metacognition` MCP 工具（assessMetacognition 先只返回 mission_brief，回写留后续）
- 不修 candidateIngress 触发逻辑（外部 API 调用链路本期不动）
- 不做 utility_score admin API 手动调整入口（自动反推够用）
- 不写 utility_score 单元测试（先跑通端到端，单测延后）

### 验收标准

- migration 0028 跑通，`kp_synthesized_knowledge.utility_score` 列存在
- 31 条野数据清空，`SELECT COUNT(*) FROM kp_synthesized_knowledge WHERE tenant_id='tenant-local' AND scope='memory.validation'` = 0
- `KNOWLEDGE_MODEL_ENDPOINT` 在代码里不再被引用（grep 0 命中）
- `host_model_result` schema 支持 `synthesis_result` 字段
- `.trae/skills/memory-lifecycle/SKILL.md` 创建
- 6 个 l1-test-skill 目录删除
- scripts/ 里废弃验证脚本清理（保留工具脚本）
- retrieve 返回结构含 `metacognition_mission_brief` 字段（当 method='llm' 时）
- lifecycle 跑完后：`SELECT utility_score FROM kp_synthesized_knowledge WHERE utility_score IS NOT NULL` 有数据
- 编译通过，现有测试不破坏

### 风险

- 删掉 KNOWLEDGE_MODEL_ENDPOINT 依赖后，heuristicAnalyze / heuristicSynthesize 成唯一降级路径。如果宿主没传 host_model_result，analyze/synthesize 会降级到启发式或返回 null。
- 31 条野数据清空后，retrieve 测试可能 fail（之前测试基于野数据）。需要同步更新测试 fixture。
- fact 只有 1 条，宿主触发 governance-run 时合成可能产出极少 synthesized_knowledge。如果产出 < 5 条，需要先补 fact 入库链路。
- lifecycle 改成显式调用后，如果宿主不主动调，importance_weight 不会重算，归档不会发生。需要在宿主侧文档强调定期调用。
- assessMetacognition 改成返回 mission_brief 后，如果宿主不做 LLM 评估，method 永远是 'rule'。fix-8-2 的 LLM 元认知能力实际依赖宿主配合。


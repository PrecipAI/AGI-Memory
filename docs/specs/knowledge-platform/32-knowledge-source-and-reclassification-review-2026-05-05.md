# Knowledge 来源与重分类复核（2026-05-05）

## 1. 结论

当前 active 的 14 条 `knowledge` 都有外部来源，不是无来源产物。  
但其中有一部分虽然“证据来自外部资料”，表达上已经接近“我们系统采纳后的本地规范”，这类后续应拆成两层：

1. `external knowledge`
   保留外部世界的通用知识结论
2. `local adopted memory/rule`
   单独记录“我们采纳了什么、后续怎么执行”

因此这份复核分成两类：

- **A 类**：可以继续保留在 `knowledge`
- **B 类**：建议后续拆成 `knowledge + local memory/rule`

---

## 2. A 类：可继续保留在 Knowledge 的外部知识

这些更像“行业/生态/方法层的外部知识”，即使被我们参考，也不天然等于本地记忆：

1. `成熟知识平台正在收敛为知识库、工作流、Agent 和多源数据的一体化系统`
   代表来源：
   - `RAGFlow`
   - `FastGPT`
   - `DB-GPT`

2. `Agent 框架正在收敛到工具、记忆、工作流、多智能体和评估的一体化运行时`
   代表来源：
   - `AgentScope`
   - `CrewAI`
   - `Google ADK`
   - `CAMEL`
   - `MetaGPT`
   - `Lagent`

3. `成熟 RAG 系统会把检索、证据装配和可观测性拆成独立环节`
   代表来源：
   - `LangChain RAG tutorial`

4. `图谱召回适合关系型问题，但不能替代证据治理和事实有效性判断`
   代表来源：
   - `GraphRAG 对比材料`
   - `agent-memory` 相关文章

5. `图谱抽取不等于知识治理，chunk 内路径只能作为图谱候选`
   代表来源：
   - `LlamaIndex Property Graph`

---

## 3. B 类：建议拆成 Knowledge + Local Memory/Rule 的条目

这些条目虽然证据来源是外部知识，但它们已经非常接近“本地工程规范”。
后续更稳的做法是：

- 外部通用规律保留在 `knowledge`
- 我们的采用决定单独进入 `memory` 或 `rule`

### B1. 长期记忆与治理原则

1. `长期记忆必须在使用时验证有效性，而不是只做相似召回`
   外部来源：
   - `GitHub Copilot memory`
   - `Mem0`
   - 中文 `AI agent memory` 工程文章
   建议：
   - `knowledge`：保留外部规律
   - `memory/rule`：如果我们明确采用，就单独写“本系统记忆召回必须带验证”

2. `长期记忆不能退化成向量片段库，必须显式建模结构、时间和治理`
   外部来源：
   - 长期记忆架构文章
   - Graphiti / ACT-R 相关思路
   建议：
   - `knowledge`：保留该类外部观点
   - `memory`：如果本系统已采纳为架构边界，再单独落本地决策

### B2. 检索与 RAG 工程原则

3. `生产级检索默认应采用多信号候选、重排和证据边界，而不是单一路径`
   外部来源：
   - 中文 RAG 工程文章
   建议：
   - `knowledge`：保留通用工程经验
   - `memory/rule`：如果本系统当前路线已经确定混合召回/重排，则单独记录本地采纳

4. `生产级 RAG 应拆成检索、重排、证据校验、观测和安全治理的闭环`
   外部来源：
   - `LlamaIndex`
   - `OWASP`
   - `RAGFlow`
   - `RAGAS`
   建议同上

5. `检索基础设施应抽象为可替换后端，核心契约是混合召回、过滤、融合和重排`
   外部来源：
   - `Pinecone`
   - `Qdrant`
   - `Elasticsearch`
   - `FlagEmbedding`
   建议同上

6. `RAG 评估必须拆开检索质量、生成忠实度和多轮行为`
   外部来源：
   - `DeepEval`
   建议：
   - `knowledge`：保留评测框架外部规律
   - `rule`：若本系统验收必须按这条做，再单独写成本地 hard rule

### B3. Agent / Harness / 安全 / 观测原则

7. `Agent 工具和 MCP 接入必须有结构化授权、沙箱和审计，而不能只靠提示词约束`
   外部来源：
   - `MCP Authorization`
   - `awesome-harness-engineering`
   - `LangChain` prompt injection 资料
   - `DB-GPT`
   建议：
   - `knowledge`：保留外部安全设计原则
   - `rule`：如果本系统强制执行，就再单独落本地安全规则

8. `Agent 可靠性来自 harness 闭环，而不是单次提示词或单模型能力`
   外部来源：
   - `awesome-harness-engineering`
   - `DeepEval`
   - `OpenAI Agents SDK`
   建议：
   - `knowledge`：保留行业规律
   - `memory`：如果本系统路线已明确依赖 harness，可记为本地架构决策

9. `Agent 观测必须记录轨迹、工具调用、上下文和成本，否则无法治理失败`
   外部来源：
   - `DeepEval`
   - `Langfuse`
   - `AutoHarness`
   - observability / event log 相关资料
   建议：
   - `knowledge`：保留外部观测规律
   - `rule`：如果本系统后续必须执行，可单独落 hard rule

---

## 4. 当前项目已经加上的防错措施

本轮不是只做人工分类，我还把项目规则改了，避免后面再混：

1. `knowledgeGovernance.ts`
   新增 synthesis 边界门禁：
   - 如果来源是本地/混合来源，不允许直接进入 `knowledge`
   - 如果输出带本地采纳/项目内口吻，转去 `memory_candidate` 或 `audit_only`

2. `knowledgeModelWorker.ts`
   更新模型 contract：
   - `knowledge` 只允许 external general knowledge
   - local adopted decisions 不得直接落 `knowledge`
   - internal process / validation material 默认去 `audit_only`

3. `apply-codex-governance-synthesis.mjs`
   旧版 legacy synthesis 脚本默认禁用，防止再次灌入老式混层知识

---

## 5. 仍然建议的后续动作

如果要把这套彻底做干净，后续建议补两步：

1. 给 `knowledge` 增加 `source_scope` 可视化字段
   - `external_general`
   - `local_adopted`
   - `mixed`

2. 给“本地采纳决策”补正式落点
   - 现在项目已经能阻止错误落 `knowledge`
   - 但还没有把所有 `knowledge -> local memory/rule adoption` 做成自动双写闭环

当前状态已经比之前稳得多：

- 不再把内部会话和验证结果写成 `knowledge`
- 不再允许 legacy 手工脚本继续污染
- 新合成链路开始按“外部知识 vs 本地采纳”做边界控制

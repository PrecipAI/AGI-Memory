# 当前长期知识/记忆系统完整数据报告

生成时间：2026-05-05T14:15:14.404Z
Tenant / Scope：tenant-local / memory.validation

## 1. 总体数据

| 指标 | 数量 |
| --- | ---: |
| Active documents | 121 |
| Active markdown documents | 118 |
| Active sections | 2401 |
| Active evidence | 2416 |
| Active synthesized knowledge | 14 |
| Facts / Entities / Relations | 0 / 0 / 0 |
| Intermediate recall surface | 0 |
| Active review queue | 5 |
| Pending change proposals | 0 |

## 2. 能力评测

- 总 case：10
- 通过 case：10
- 总通过率：100%
- 正向能力通过率：100%
- 边界拒召回通过率：100%
- 平均延迟：257.059 ms
- 平均 derived 命中：3.5
- 平均 evidence trace：19

## 3. Synthesized Knowledge 明细

| # | 类型 | 标题 | 置信度 | 风险 | Evidence | Sources |
| ---: | --- | --- | ---: | --- | ---: | ---: |
| 1 | design_principle | Agent 工具和 MCP 接入必须有结构化授权、沙箱和审计，而不能只靠提示词约束 | 0.9200 | low | 6 | 6 |
| 2 | derived_rule | 长期记忆必须在使用时验证有效性，而不是只做相似召回 | 0.9200 | low | 5 | 5 |
| 3 | cross_source_pattern | Agent 可靠性来自 harness 闭环，而不是单次提示词或单模型能力 | 0.9100 | low | 6 | 6 |
| 4 | derived_rule | Agent 观测必须记录轨迹、工具调用、上下文和成本，否则无法治理失败 | 0.9100 | low | 6 | 6 |
| 5 | design_principle | 生产级检索默认应采用多信号候选、重排和证据边界，而不是单一路径 | 0.9100 | low | 6 | 6 |
| 6 | design_principle | 检索基础设施应抽象为可替换后端，核心契约是混合召回、过滤、融合和重排 | 0.9000 | low | 7 | 7 |
| 7 | derived_rule | 长期记忆不能退化成向量片段库，必须显式建模结构、时间和治理 | 0.9000 | low | 4 | 4 |
| 8 | design_principle | 生产级 RAG 应拆成检索、重排、证据校验、观测和安全治理的闭环 | 0.9000 | low | 6 | 6 |
| 9 | derived_rule | RAG 评估必须拆开检索质量、生成忠实度和多轮行为 | 0.9000 | low | 6 | 6 |
| 10 | cross_source_pattern | Agent 框架正在收敛到工具、记忆、工作流、多智能体和评估的一体化运行时 | 0.8900 | low | 8 | 8 |
| 11 | cross_source_pattern | 成熟 RAG 系统会把检索、证据装配和可观测性拆成独立环节 | 0.8800 | low | 4 | 4 |
| 12 | boundary_condition | 图谱召回适合关系型问题，但不能替代证据治理和事实有效性判断 | 0.8800 | low | 3 | 3 |
| 13 | boundary_condition | 图谱抽取不等于知识治理，chunk 内路径只能作为图谱候选 | 0.8600 | low | 3 | 3 |
| 14 | cross_source_pattern | 成熟知识平台正在收敛为知识库、工作流、Agent 和多源数据的一体化系统 | 0.8600 | low | 6 | 6 |

## 4. Synthesized Knowledge 内容摘要

### 1. Agent 工具和 MCP 接入必须有结构化授权、沙箱和审计，而不能只靠提示词约束

- 类型：design_principle
- 置信度：0.9200
- 风险：low
- Evidence：6
- Sources：6

# Agent 工具和 MCP 接入必须有结构化授权、沙箱和审计，而不能只靠提示词约束

只在 prompt 里告诉 agent“不要做危险操作”不够。只要系统允许工具调用、MCP、文件、网络或外部资源，安全边界就必须由 harness 和协议层承担。

最低工程要求：

1. 权限采用 deny/allow/approval 等结构化规则，不依赖模型自觉。
2. 高风险工具在沙箱或受控环境里执行，外部访问需要显式批准或策略放行。
3. MCP/工具调用要带身份、作用域、预算、错误语义和审计记录。
4. 检索到的文档、网页、用户输入和工具返回都应视为不可信上下文，不能直接覆盖系统规则。
5. 对敏感动作保留 trace，能解释谁触发、用了哪个工具、为什么允许、结果是什么。

适用边界：凡是 agent 能执行动作、访问私有数据或调用外部服务，就应采用这条原则；纯离线问答可以简化。

### 2. 长期记忆必须在使用时验证有效性，而不是只做相似召回

- 类型：derived_rule
- 置信度：0.9200
- 风险：low
- Evidence：5
- Sources：5

# 长期记忆必须在使用时验证有效性，而不是只做相似召回

长期记忆系统不能把“曾经写入的记忆”直接等价为“当前可用的事实”。更稳的规则是：只存储带引用、可行动的事实；召回时先检查引用或当前上下文是否仍然成立，再让记忆进入回答或执行计划。

这个规则同时解释了三个工程取舍：

1. 记忆写入应优先记录会影响未来任务的事实和原因，而不是保存完整对话噪声。
2. 记忆召回必须保留 citation / evidence path，否则旧记忆会在版本、分支、环境变化后误导 agent。
3. 长上下文直接塞全文并不能替代治理后的记忆，因为 token、延迟和上下文腐烂会扩大成本与错误面。

适用边界：对代码库、项目约束、用户长期偏好、API 版本、运行环境和任务经验尤其重要；对一次性闲聊或短期临时状态不应升级为长期记忆。

### 3. Agent 可靠性来自 harness 闭环，而不是单次提示词或单模型能力

- 类型：cross_source_pattern
- 置信度：0.9100
- 风险：low
- Evidence：6
- Sources：6

# Agent 可靠性来自 harness 闭环，而不是单次提示词或单模型能力

多个来源共同指向一个模式：Agent 可靠性要靠 harness 把运行边界、工具调用、评估、轨迹和迭代优化组织起来，而不是只依赖更长提示词或更强模型。

这个模式至少包含：

1. 安全边界：sandbox、权限申请和外部访问控制决定 agent 能安全做什么。
2. 执行编排：task runner / orchestration 负责队列、并行、进度和多步骤执行。
3. 工具治理：工具选择、延迟加载、错误返回和 MCP 等协议要可控。
4. 评估验证：trajectory eval、outcome eval、benchmark 和回归测试决定改动是否真的变好。
5. 运行观测：trace、span、输入输出和工具调用记录是定位失败的前提。
6. 自动迭代：meta-harness 可以基于 benchmark 保留或丢弃系统提示、工具配置和路由改动。

适用边界：这条模式适合需要长期运行、自动执行或接入工具的 agent；简单问答 bot 不一定需要完整 harness，但一旦涉及文件、命令、外部资源或多步任务，就应进入 harness 设计。

### 4. Agent 观测必须记录轨迹、工具调用、上下文和成本，否则无法治理失败

- 类型：derived_rule
- 置信度：0.9100
- 风险：low
- Evidence：6
- Sources：6

# Agent 观测必须记录轨迹、工具调用、上下文和成本，否则无法治理失败

Agent 系统失败通常不是单点错误，而是上下文、工具、权限、状态、模型输出和外部环境共同作用的结果。没有运行轨迹，就无法判断失败发生在哪一层。

观测规则：

1. 每次运行记录输入、计划、工具调用、模型调用、检索结果、输出和错误。
2. trace/span 应能串起多步任务，而不是只保存最终回答。
3. 成本、token、工具耗时、循环次数和预算消耗要进入治理数据。
4. 失败案例要能回放或至少重建关键证据链，供后续治理、测试和 skill 沉淀使用。
5. 观测数据不是最终知识，只有稳定模式和修复经验才应升级为 derived knowledge 或 skill。

适用边界：凡是多步 agent、RAG、工具调用或自动化执行，都应保留观测；一次性简单问答可以只保留轻量日志。

### 5. 生产级检索默认应采用多信号候选、重排和证据边界，而不是单一路径

- 类型：design_principle
- 置信度：0.9100
- 风险：low
- Evidence：6
- Sources：6

# 生产级检索默认应采用多信号候选、重排和证据边界，而不是单一路径

生产级 RAG 检索不应押注单一路径。更稳的默认形态是：用多种信号生成候选，再用统一重排和证据边界控制最终进入上下文的材料。

可落地的检索原则：

1. BM25/关键词负责专有名词、编号、字段、短语和硬命中兜底。
2. 向量负责同义表达、语义相近问题和模糊意图。
3. 元数据、版本、权限、时间和范围负责过滤边界，防止召回旧材料或越权内容。
4. rerank 负责统一裁决候选相关性，但要控制候选 K 和成本。
5. 上下文增强负责解决孤句误读和 chunk 切碎，但不能把摘要当成唯一证据。

适用边界：这条原则适合普通文档问答和知识库助手；如果治理层已经产出高质量 derived knowledge 或图谱规则，召回入口可以优先命中治理产物，再按需回落到原始 evidence。

### 6. 检索基础设施应抽象为可替换后端，核心契约是混合召回、过滤、融合和重排

- 类型：design_principle
- 置信度：0.9000
- 风险：low
- Evidence：7
- Sources：7

# 检索基础设施应抽象为可替换后端，核心契约是混合召回、过滤、融合和重排

Milvus、Qdrant、Pinecone、Weaviate、Elasticsearch、FlagEmbedding 等组件解决的是不同层面的检索能力，不应把某一个后端直接写死成知识系统本体。

稳定的工程契约应包括：

1. dense 向量召回：解决语义相近和改写问题。
2. sparse/BM25 召回：解决关键词、术语、编号、字段和短文本硬命中。
3. metadata/payload 过滤：解决用户、版本、权限、时间和来源边界。
4. fusion/RRF：把多路候选合并为统一排序，避免直接比较异构分数。
5. rerank：在有限候选集上做最终相关性裁决。
6. backend adapter：向上暴露统一接口，方便后续替换 Milvus、Elasticsearch 或其他存储。

适用边界：这条原则服务普通召回路线和证据定位路线；当图谱治理产物足够成熟时，检索后端仍作为 evidence fallback 和校验通道。

### 7. 长期记忆不能退化成向量片段库，必须显式建模结构、时间和治理

- 类型：derived_rule
- 置信度：0.9000
- 风险：low
- Evidence：4
- Sources：4

# 长期记忆不能退化成向量片段库，必须显式建模结构、时间和治理

长期记忆系统的核心不是“把更多文本放进向量库”，而是把可复用知识组织成有结构、有时间语义、可更新、可遗忘、可验证的对象。

治理规则应至少包含：

1. 结构化：把事实、关系、规则、经验和用户画像区分开，避免所有内容都变成不可解释的 chunk。
2. 时间性：记录形成时间、最后验证时间、衰减或过期条件，避免旧记忆长期污染未来任务。
3. 重要性：召回排序不能只依赖相似度，还应考虑重要性、使用频率、时效和当前上下文相关性。
4. 巩固与遗忘：治理层需要合并重复知识、替换旧结论、归档低价值内容，而不是只追加。
5. 可追溯：任何长期结论都应能回到 evidence，否则不能升级为稳定记忆。

适用边界：这条规则适用于 agent 长期记忆、项目知识库和跨会话偏好；短期任务状态可以保留在运行层，不应全部进入长期记忆。

### 8. 生产级 RAG 应拆成检索、重排、证据校验、观测和安全治理的闭环

- 类型：design_principle
- 置信度：0.9000
- 风险：low
- Evidence：6
- Sources：6

# 生产级 RAG 应拆成检索、重排、证据校验、观测和安全治理的闭环

生产级 RAG 的关键不是“有没有向量库”，而是能否把候选召回、重排、证据约束、评估、观测和安全治理拆成可审计的闭环。

因此默认设计应包含：

1. 召回层：可以使用向量、关键词、结构化过滤或图谱候选，但不能把相似度当最终可信度。
2. 重排层：对候选节点二次排序，把问题相关性和上下文预算显式纳入流程。
3. 证据层：回答必须落回 evidence / source markdown，必要时再展开原文。
4. 评估层：用 ContextPrecision、Faithfulness 等指标持续测试 RAG 输出。
5. 观测层：记录 workflow trace，能定位每一步用了哪些节点和工具。
6. 安全层：把可被攻击者修改的检索文档视为风险入口，不能默认信任召回内容。

适用边界：这是工程系统原则，不要求每个小 demo 都一次性实现全部组件；但面向长期知识系统或生产 agent 时，缺任一环都会降低可解释性和可治理性。

### 9. RAG 评估必须拆开检索质量、生成忠实度和多轮行为

- 类型：derived_rule
- 置信度：0.9000
- 风险：low
- Evidence：6
- Sources：6

# RAG 评估必须拆开检索质量、生成忠实度和多轮行为

RAG 系统不能只用“回答看起来对不对”做验收。工程评估应拆成检索、生成和多轮行为三层，否则无法判断问题出在召回、排序、证据装配、提示词还是模型生成。

推荐的评估拆分：

1. 检索层：评估相关证据是否被找全、相关节点是否排在无关节点之前。
2. 生成层：评估回答是否基于 retrieval_context、是否和证据矛盾、是否回答了问题。
3. 端到端层：组合 retrieval + generation 指标，验证用户最终体验。
4. 多轮层：单轮指标不能覆盖对话状态、追问、省略和历史依赖，需要专门的 multi-turn case。
5. CI 层：把关键测试集接入回归流程，防止索引、模型、chunk、rerank 或提示词调整后静默退化。

适用边界：适合任何要长期迭代的 RAG/Agent 知识系统；早期探索可以先用小测试集，但必须保留可扩展到 CI 的数据结构。

### 10. Agent 框架正在收敛到工具、记忆、工作流、多智能体和评估的一体化运行时

- 类型：cross_source_pattern
- 置信度：0.8900
- 风险：low
- Evidence：8
- Sources：8

# Agent 框架正在收敛到工具、记忆、工作流、多智能体和评估的一体化运行时

主流 Agent 框架的共同方向不是只封装一次 LLM 调用，而是把工具、记忆、状态、工作流、多智能体协作、人类介入和评估组合成可运行、可调试、可扩展的运行时。

工程含义：

1. Agent 设计应先明确运行时边界：状态如何保存、工具如何注册、任务如何编排、失败如何恢复。
2. 多智能体不是默认答案，只有当角色分工、消息路由和停止条件明确时才有价值。
3. human-in-the-loop、MCP、RAG、长期记忆和评估不应是外挂点缀，而应进入框架能力矩阵。
4. 选择框架时要看可观测、部署、状态持久化和治理能力，而不是只看 demo 复杂度。

适用边界：适用于生产 agent、自动化工作流和多工具系统；简单单轮聊天不需要完整 runtime。

### 11. 成熟 RAG 系统会把检索、证据装配和可观测性拆成独立环节

- 类型：cross_source_pattern
- 置信度：0.8800
- 风险：low
- Evidence：4
- Sources：4

成熟 RAG 不应被实现成“向量检索后直接拼上下文”。更稳的形态是把流程拆成：索引/入库、候选检索、证据装配、回答约束、过程追踪与评估。检索只负责找候选，证据装配负责控制进入模型的上下文，回答约束负责在证据不足时拒答或降级，可观测性负责定位召回与生成问题。

适用场景：面向真实用户的问题回答、知识库问答、agent 工具检索。
边界：简单静态 FAQ 可以简化为两步链路；但当来源复杂、需要审计或需要持续改进时，应拆分这些环节。

### 12. 图谱召回适合关系型问题，但不能替代证据治理和事实有效性判断

- 类型：boundary_condition
- 置信度：0.8800
- 风险：low
- Evidence：3
- Sources：3

# 图谱召回适合关系型问题，但不能替代证据治理和事实有效性判断

GraphRAG 的价值在于利用实体、关系和本体组织候选知识，尤其适合跨文档、多跳、层级引用和语义关系明确的问题。但图谱本身不是可信答案生成器：边的存在不等于事实有效，路径可达不等于证据充分。

因此图谱路线应遵守三个边界：

1. 图谱负责组织候选和扩展关系，不负责单独裁决最终答案。
2. 关系必须来自治理后的事实和证据，弱相关内容允许保持孤岛，不能强行连边。
3. 最终上下文仍要落到 evidence / canonical markdown，保证可审查、可回滚、可纠错。

适用边界：当问题涉及因果链、概念演化、跨来源比较、依赖关系、冲突消解时，图谱价值较高；当问题只是精确查找单个字段时，关键词或结构化过滤可能更直接。

### 13. 图谱抽取不等于知识治理，chunk 内路径只能作为图谱候选

- 类型：boundary_condition
- 置信度：0.8600
- 风险：low
- Evidence：3
- Sources：3

Property graph / KG extractor 可以从 chunk 中抽取实体和关系路径，但这只是图谱候选生成，不等于已经完成跨来源知识治理。真正可召回的知识图谱需要再做跨文档去重、冲突检测、关系合并、适用边界判断和 evidence 绑定；否则图谱只是把 chunk 噪声结构化，并不会自动变聪明。

适用场景：GraphRAG、知识图谱入库、文档关系抽取。
边界：单文档问答或局部导航可以直接使用 chunk-level path；跨来源推理、长期知识沉淀和默认召回必须经过治理层确认。

### 14. 成熟知识平台正在收敛为知识库、工作流、Agent 和多源数据的一体化系统

- 类型：cross_source_pattern
- 置信度：0.8600
- 风险：low
- Evidence：6
- Sources：6

# 成熟知识平台正在收敛为知识库、工作流、Agent 和多源数据的一体化系统

多个开源产品的共同趋势是：知识库不再只是“上传文档后问答”，而是在向数据处理、RAG 检索、可视化工作流、Agent 编排和多源数据接入融合。

这个趋势对我们的设计有三个含义：

1. 知识系统应提供统一 ingest / governance / recall / evidence trace，而不是只做文档列表。
2. Ops Console 不是最终产品形态，但必须能解释入库、抽取、治理、召回和证据使用情况。
3. 知识治理产物应能服务 Agent 和 workflow，不只服务问答页面。

适用边界：这条模式用于产品方向和系统边界判断；具体实现仍应按我们当前路线分层落地，避免一次性复制完整低代码平台。

## 5. Evidence 来源分布

| Source type | Host | Evidence |
| --- | --- | ---: |
| markdown_file | github.com | 872 |
| markdown_file | help.aliyun.com | 139 |
| markdown_file | www.cnblogs.com | 107 |
| markdown_file | docs.llamaindex.ai | 84 |
| markdown_file | eastondev.com | 81 |
| markdown_text | github.com | 75 |
| markdown_file | www.phppan.com | 53 |
| markdown_file | gist.github.com | 53 |
| markdown_file | genai.owasp.org | 49 |
| markdown_file | cloud.tencent.com | 49 |
| markdown_file | docs.ragas.io | 45 |
| markdown_file | modelcontextprotocol.io | 44 |
| markdown_file | docs.pinecone.io | 42 |
| markdown_file | deepeval.com | 42 |
| markdown_file | zh.wikipedia.org | 41 |
| markdown_file | python.langchain.com | 32 |
| markdown_file | openai.github.io | 30 |
| markdown_file | www.elastic.co | 29 |
| markdown_file | weaviate.io | 29 |
| markdown_file | docs.langchain.com | 27 |
| markdown_file | owasp.org | 26 |
| markdown_file | open.bigmodel.cn | 26 |
| markdown_file | blog.csdn.net | 25 |
| markdown_file | htmlpage.cn | 23 |
| markdown_file | qwen.readthedocs.io | 23 |
| markdown_file | jiangren.com.au | 23 |
| markdown_text | github.blog | 22 |
| markdown_file | qdrant.tech | 22 |
| markdown_file | www.flandre.ltd | 21 |
| markdown_file | docs.arize.com | 19 |

## 6. 最近治理任务

| Job | Type | Status | Synthesized | Purge | Warnings |
| --- | --- | --- | ---: | --- | --- |
| 9b07f125-df40-4e2d-abe5-b0e40a119cc5 | host_capture_session_governance | pending | 0 | no | [] |
| a9af08df-f80f-4271-86c6-f428ae9cb840 | host_capture_session_governance | pending | 0 | no | [] |
| aafa6cac-2e26-4dbf-943c-e41674aff4b8 | host_capture_session_governance | pending | 0 | no | [] |
| 4467c6b2-4bcf-4063-ae0f-40da76c17699 | host_capture_session_governance | pending | 0 | no | [] |
| be8eda99-d764-43f8-9fe3-80cebf8ba918 | host_capture_session_governance | pending | 0 | no | [] |
| f0fd55c0-a35f-408e-ad8a-4d0fe253eac6 | host_capture_session_governance | pending | 0 | no | [] |
| 7f292f6b-68ac-4f94-a036-47a78f3fcc61 | host_capture_session_governance | pending | 0 | no | [] |
| df79c91e-fa59-4c8e-a5fa-7bc43159a027 | host_capture_session_governance | pending | 0 | no | [] |
| 3804cdfd-f09b-48aa-b8a5-342dbb1adb67 | host_capture_session_governance | pending | 0 | no | [] |
| 27da19c7-ed4d-4ae1-948f-4cc5c9abf67c | host_capture_session_governance | pending | 0 | no | [] |

## 7. Memory / Rule / Skill 状态

- Memory：retired=2
- Rule：retired=1
- Skill：retired=1

## 8. 当前能力边界结论

- 当前系统已经能用治理后的 synthesized knowledge 作为主召回对象，并返回 evidence trace。
- 当前长期层不再暴露 facts/entities/relations，符合“中间产物只服务治理”的设计。
- 现有能力评测是首版 10 条 case，能说明链路和典型边界，但不能代表大规模泛化能力。
- 多跳能力当前主要依赖治理前置合成，而不是在线 graph search；图搜索应作为后续对比路线。

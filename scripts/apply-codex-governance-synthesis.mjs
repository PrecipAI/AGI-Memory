import pg from "pg";
import { randomUUID, createHash } from "node:crypto";

const { Pool } = pg;
const tenantId = process.env.DEFAULT_TENANT_ID || "tenant-local";
const scope = process.env.DEFAULT_SCOPE || "memory.validation";
const traceId = `codex-governance-synthesis-${Date.now()}`;

const pool = new Pool({
  connectionString:
    process.env.DB_URL ||
    `postgresql://${encodeURIComponent(process.env.PGUSER || "postgres")}:${
      encodeURIComponent(process.env.PGPASSWORD || "postgres")
    }@${process.env.PGHOST || "127.0.0.1"}:${process.env.PGPORT || "55432"}/${process.env.PGDATABASE || "super_agent_system"}`
});

function normalizeContent(value) {
  return value.trim().replace(/\s+/g, " ").toLowerCase();
}

function json(value) {
  return JSON.stringify(value ?? {});
}

function jsonArray(value) {
  return JSON.stringify(Array.isArray(value) ? value : []);
}

const synthesisItems = [
  {
    knowledgeType: "derived_rule",
    title: "长期记忆必须在使用时验证有效性，而不是只做相似召回",
    content: [
      "# 长期记忆必须在使用时验证有效性，而不是只做相似召回",
      "",
      "长期记忆系统不能把“曾经写入的记忆”直接等价为“当前可用的事实”。更稳的规则是：只存储带引用、可行动的事实；召回时先检查引用或当前上下文是否仍然成立，再让记忆进入回答或执行计划。",
      "",
      "这个规则同时解释了三个工程取舍：",
      "",
      "1. 记忆写入应优先记录会影响未来任务的事实和原因，而不是保存完整对话噪声。",
      "2. 记忆召回必须保留 citation / evidence path，否则旧记忆会在版本、分支、环境变化后误导 agent。",
      "3. 长上下文直接塞全文并不能替代治理后的记忆，因为 token、延迟和上下文腐烂会扩大成本与错误面。",
      "",
      "适用边界：对代码库、项目约束、用户长期偏好、API 版本、运行环境和任务经验尤其重要；对一次性闲聊或短期临时状态不应升级为长期记忆。"
    ].join("\n"),
    confidenceScore: 0.92,
    reasoningSummary:
      "GitHub Copilot memory article provides memory-as-tool, citation-backed facts, just-in-time verification, and measured developer impact. Mem0 and long-term memory engineering materials support continuity and context budget concerns. Together they support a derived rule: memory recall must be evidence-validated at use time.",
    support: [
      "0416503a-a56e-4569-a910-ff83f349a3cf",
      "07d9b2ea-b158-474f-b87c-8605ef36b1b9",
      "07732d7d-016a-45bb-bc62-8a9f07a1dd36",
      "017324b5-4819-43fe-aca8-d8892e32a9f3",
      "0742f14e-7e63-4c5c-b280-249ada453f1e"
    ]
  },
  {
    knowledgeType: "design_principle",
    title: "生产级 RAG 应拆成检索、重排、证据校验、观测和安全治理的闭环",
    content: [
      "# 生产级 RAG 应拆成检索、重排、证据校验、观测和安全治理的闭环",
      "",
      "生产级 RAG 的关键不是“有没有向量库”，而是能否把候选召回、重排、证据约束、评估、观测和安全治理拆成可审计的闭环。",
      "",
      "因此默认设计应包含：",
      "",
      "1. 召回层：可以使用向量、关键词、结构化过滤或图谱候选，但不能把相似度当最终可信度。",
      "2. 重排层：对候选节点二次排序，把问题相关性和上下文预算显式纳入流程。",
      "3. 证据层：回答必须落回 evidence / source markdown，必要时再展开原文。",
      "4. 评估层：用 ContextPrecision、Faithfulness 等指标持续测试 RAG 输出。",
      "5. 观测层：记录 workflow trace，能定位每一步用了哪些节点和工具。",
      "6. 安全层：把可被攻击者修改的检索文档视为风险入口，不能默认信任召回内容。",
      "",
      "适用边界：这是工程系统原则，不要求每个小 demo 都一次性实现全部组件；但面向长期知识系统或生产 agent 时，缺任一环都会降低可解释性和可治理性。"
    ].join("\n"),
    confidenceScore: 0.9,
    reasoningSummary:
      "LlamaIndex RAG workflow shows reranking and tracing; RAGAS material provides evaluation metrics; scalar-enhanced RAG material highlights version/noise/audit controls; OWASP identifies RAG document manipulation as a security risk; RAGFlow positions RAG as a context layer. These sources jointly support the design principle.",
    support: [
      "05293b71-fd13-47a8-beae-d5d333c7c249",
      "002c1202-91fe-4a4e-9054-641484395792",
      "00ab7ced-3724-458e-b34c-27063c2ec49b",
      "07a4820a-6300-401d-ae5d-5b2a10e8f28b",
      "094b6d25-2a5d-40df-8af1-ca51ad803abb",
      "0ab05777-f08f-4cac-9f48-67b65ee84e11"
    ]
  },
  {
    knowledgeType: "cross_source_pattern",
    title: "Agent 可靠性来自 harness 闭环，而不是单次提示词或单模型能力",
    content: [
      "# Agent 可靠性来自 harness 闭环，而不是单次提示词或单模型能力",
      "",
      "多个来源共同指向一个模式：Agent 可靠性要靠 harness 把运行边界、工具调用、评估、轨迹和迭代优化组织起来，而不是只依赖更长提示词或更强模型。",
      "",
      "这个模式至少包含：",
      "",
      "1. 安全边界：sandbox、权限申请和外部访问控制决定 agent 能安全做什么。",
      "2. 执行编排：task runner / orchestration 负责队列、并行、进度和多步骤执行。",
      "3. 工具治理：工具选择、延迟加载、错误返回和 MCP 等协议要可控。",
      "4. 评估验证：trajectory eval、outcome eval、benchmark 和回归测试决定改动是否真的变好。",
      "5. 运行观测：trace、span、输入输出和工具调用记录是定位失败的前提。",
      "6. 自动迭代：meta-harness 可以基于 benchmark 保留或丢弃系统提示、工具配置和路由改动。",
      "",
      "适用边界：这条模式适合需要长期运行、自动执行或接入工具的 agent；简单问答 bot 不一定需要完整 harness，但一旦涉及文件、命令、外部资源或多步任务，就应进入 harness 设计。"
    ].join("\n"),
    confidenceScore: 0.91,
    reasoningSummary:
      "Harness engineering resources cover sandboxing, task runners, evals, and meta-harness loops. DeepEval describes traces. OpenAI Agents SDK material covers tool-use behavior. These independent sources support a cross-source pattern that production agent reliability is a harness property.",
    support: [
      "0095bf84-ad7e-4714-b55a-deb18f576b4f",
      "04992cc2-d123-43d6-b47f-630b0f8900b2",
      "0a23556b-54a2-4e75-9ba0-d5945e3ca5ce",
      "0be58122-7baa-45d7-a9e5-55b157258b74",
      "01f9df13-97ce-4f6f-8da9-5097636f72e5",
      "07deb23e-264d-4c09-916b-1253c385db42"
    ]
  },
  {
    knowledgeType: "derived_rule",
    title: "长期记忆不能退化成向量片段库，必须显式建模结构、时间和治理",
    content: [
      "# 长期记忆不能退化成向量片段库，必须显式建模结构、时间和治理",
      "",
      "长期记忆系统的核心不是“把更多文本放进向量库”，而是把可复用知识组织成有结构、有时间语义、可更新、可遗忘、可验证的对象。",
      "",
      "治理规则应至少包含：",
      "",
      "1. 结构化：把事实、关系、规则、经验和用户画像区分开，避免所有内容都变成不可解释的 chunk。",
      "2. 时间性：记录形成时间、最后验证时间、衰减或过期条件，避免旧记忆长期污染未来任务。",
      "3. 重要性：召回排序不能只依赖相似度，还应考虑重要性、使用频率、时效和当前上下文相关性。",
      "4. 巩固与遗忘：治理层需要合并重复知识、替换旧结论、归档低价值内容，而不是只追加。",
      "5. 可追溯：任何长期结论都应能回到 evidence，否则不能升级为稳定记忆。",
      "",
      "适用边界：这条规则适用于 agent 长期记忆、项目知识库和跨会话偏好；短期任务状态可以保留在运行层，不应全部进入长期记忆。"
    ].join("\n"),
    confidenceScore: 0.9,
    reasoningSummary:
      "Memory architecture materials criticize vector-store-as-memory and emphasize temporal dynamics, consolidation, forgetting, and weighted retrieval. Graphiti and ACT-R-inspired memory materials show concrete directions for temporal graph and dynamic activation. Together they support a rule that long-term memory must be governed structured knowledge, not flat vector snippets.",
    support: [
      "d5de59b1-b044-430f-a424-ab7e685c2182",
      "1d942eab-f4ae-4d09-ba05-0059bc716e53",
      "57d2dc68-2bf6-4fe5-b37d-e48c2eacacfd",
      "fe01054f-fd93-493c-9b17-10dcab02c4ac"
    ]
  },
  {
    knowledgeType: "boundary_condition",
    title: "图谱召回适合关系型问题，但不能替代证据治理和事实有效性判断",
    content: [
      "# 图谱召回适合关系型问题，但不能替代证据治理和事实有效性判断",
      "",
      "GraphRAG 的价值在于利用实体、关系和本体组织候选知识，尤其适合跨文档、多跳、层级引用和语义关系明确的问题。但图谱本身不是可信答案生成器：边的存在不等于事实有效，路径可达不等于证据充分。",
      "",
      "因此图谱路线应遵守三个边界：",
      "",
      "1. 图谱负责组织候选和扩展关系，不负责单独裁决最终答案。",
      "2. 关系必须来自治理后的事实和证据，弱相关内容允许保持孤岛，不能强行连边。",
      "3. 最终上下文仍要落到 evidence / canonical markdown，保证可审查、可回滚、可纠错。",
      "",
      "适用边界：当问题涉及因果链、概念演化、跨来源比较、依赖关系、冲突消解时，图谱价值较高；当问题只是精确查找单个字段时，关键词或结构化过滤可能更直接。"
    ].join("\n"),
    confidenceScore: 0.88,
    reasoningSummary:
      "GraphRAG comparison facts show graph retrieval uses semantic relationships and ontologies. Traditional RAG critique shows flat chunk retrieval loses logic and cross-reference paths. Memory architecture critique warns that structured knowledge and confidence calibration are missing from flat vector memory. These facts support a boundary: graph helps organize retrieval, but evidence governance still decides trust.",
    support: [
      "da243f4b-aa31-4966-929f-62b065608760",
      "430855b2-75ab-425c-a9d7-74b9fac5efd0",
      "d5de59b1-b044-430f-a424-ab7e685c2182"
    ]
  },
  {
    knowledgeType: "design_principle",
    title: "生产级检索默认应采用多信号候选、重排和证据边界，而不是单一路径",
    content: [
      "# 生产级检索默认应采用多信号候选、重排和证据边界，而不是单一路径",
      "",
      "生产级 RAG 检索不应押注单一路径。更稳的默认形态是：用多种信号生成候选，再用统一重排和证据边界控制最终进入上下文的材料。",
      "",
      "可落地的检索原则：",
      "",
      "1. BM25/关键词负责专有名词、编号、字段、短语和硬命中兜底。",
      "2. 向量负责同义表达、语义相近问题和模糊意图。",
      "3. 元数据、版本、权限、时间和范围负责过滤边界，防止召回旧材料或越权内容。",
      "4. rerank 负责统一裁决候选相关性，但要控制候选 K 和成本。",
      "5. 上下文增强负责解决孤句误读和 chunk 切碎，但不能把摘要当成唯一证据。",
      "",
      "适用边界：这条原则适合普通文档问答和知识库助手；如果治理层已经产出高质量 derived knowledge 或图谱规则，召回入口可以优先命中治理产物，再按需回落到原始 evidence。"
    ].join("\n"),
    confidenceScore: 0.91,
    reasoningSummary:
      "Chinese RAG engineering notes identify recall/ranking as separate tasks and list failure modes for semantic-only search. They recommend BM25 plus dense retrieval, normalization or rerank, context enhancement, and scalar controls. Rerank cost data adds the operational boundary that candidate size must be controlled.",
    support: [
      "43e43568-8ba4-4856-acdd-2205ed2e84c3",
      "0ecc7941-0bce-478d-9b32-b853473d6a5a",
      "c28bba8c-56b7-4778-8caf-fb6521fadc33",
      "18f5f451-140a-482b-85cd-7cb4e2092e8b",
      "b4178b5b-ca23-4fe3-b7c2-c40528a6a978",
      "8dab2ddc-1ad2-435d-8a39-3d57df237296"
    ]
  },
  {
    knowledgeType: "derived_rule",
    title: "RAG 评估必须拆开检索质量、生成忠实度和多轮行为",
    content: [
      "# RAG 评估必须拆开检索质量、生成忠实度和多轮行为",
      "",
      "RAG 系统不能只用“回答看起来对不对”做验收。工程评估应拆成检索、生成和多轮行为三层，否则无法判断问题出在召回、排序、证据装配、提示词还是模型生成。",
      "",
      "推荐的评估拆分：",
      "",
      "1. 检索层：评估相关证据是否被找全、相关节点是否排在无关节点之前。",
      "2. 生成层：评估回答是否基于 retrieval_context、是否和证据矛盾、是否回答了问题。",
      "3. 端到端层：组合 retrieval + generation 指标，验证用户最终体验。",
      "4. 多轮层：单轮指标不能覆盖对话状态、追问、省略和历史依赖，需要专门的 multi-turn case。",
      "5. CI 层：把关键测试集接入回归流程，防止索引、模型、chunk、rerank 或提示词调整后静默退化。",
      "",
      "适用边界：适合任何要长期迭代的 RAG/Agent 知识系统；早期探索可以先用小测试集，但必须保留可扩展到 CI 的数据结构。"
    ].join("\n"),
    confidenceScore: 0.9,
    reasoningSummary:
      "DeepEval RAG materials separate retrieval metrics, generation metrics, E2E evaluation, multi-turn RAG evaluation, hyperparameter optimization, simulation, and CI unit testing. These facts jointly support a governance rule for evaluation decomposition.",
    support: [
      "e7e9282c-5064-44d4-89d6-7cc008473086",
      "ed5ccb76-99e6-4074-a28e-c131ea730d05",
      "9a40f72f-1ab1-4805-b2ca-144758176dee",
      "2cf12cd9-873b-4aac-ba18-8c35640d843e",
      "7b9cf6e9-be30-48d2-9923-ade984d1c55f",
      "699b353d-af60-4b44-a65d-699de3650e50"
    ]
  },
  {
    knowledgeType: "cross_source_pattern",
    title: "成熟知识平台正在收敛为知识库、工作流、Agent 和多源数据的一体化系统",
    content: [
      "# 成熟知识平台正在收敛为知识库、工作流、Agent 和多源数据的一体化系统",
      "",
      "多个开源产品的共同趋势是：知识库不再只是“上传文档后问答”，而是在向数据处理、RAG 检索、可视化工作流、Agent 编排和多源数据接入融合。",
      "",
      "这个趋势对我们的设计有三个含义：",
      "",
      "1. 知识系统应提供统一 ingest / governance / recall / evidence trace，而不是只做文档列表。",
      "2. Ops Console 不是最终产品形态，但必须能解释入库、抽取、治理、召回和证据使用情况。",
      "3. 知识治理产物应能服务 Agent 和 workflow，不只服务问答页面。",
      "",
      "适用边界：这条模式用于产品方向和系统边界判断；具体实现仍应按我们当前路线分层落地，避免一次性复制完整低代码平台。"
    ].join("\n"),
    confidenceScore: 0.86,
    reasoningSummary:
      "FastGPT, RAGFlow, DB-GPT, and related open-source products describe combinations of knowledge bases, RAG retrieval, visual workflow orchestration, multi-source data access, and agent capabilities. The convergence supports a product-level pattern for unified knowledge systems.",
    support: [
      "c159a330-8baf-4ec6-9c04-9185a225ab9b",
      "e252d7b7-ad2b-4818-8367-dcecbe771506",
      "348b6205-607e-45c9-b5e9-9838ae3691b2",
      "1aa6d2b0-b5b1-416f-abc2-978e91944ad4",
      "859f14d4-e48c-4f95-abeb-7bfb105b2e6a",
      "e222e905-5099-4776-ab9c-a3054f11fe16"
    ]
  },
  {
    knowledgeType: "cross_source_pattern",
    title: "Agent 框架正在收敛到工具、记忆、工作流、多智能体和评估的一体化运行时",
    content: [
      "# Agent 框架正在收敛到工具、记忆、工作流、多智能体和评估的一体化运行时",
      "",
      "主流 Agent 框架的共同方向不是只封装一次 LLM 调用，而是把工具、记忆、状态、工作流、多智能体协作、人类介入和评估组合成可运行、可调试、可扩展的运行时。",
      "",
      "工程含义：",
      "",
      "1. Agent 设计应先明确运行时边界：状态如何保存、工具如何注册、任务如何编排、失败如何恢复。",
      "2. 多智能体不是默认答案，只有当角色分工、消息路由和停止条件明确时才有价值。",
      "3. human-in-the-loop、MCP、RAG、长期记忆和评估不应是外挂点缀，而应进入框架能力矩阵。",
      "4. 选择框架时要看可观测、部署、状态持久化和治理能力，而不是只看 demo 复杂度。",
      "",
      "适用边界：适用于生产 agent、自动化工作流和多工具系统；简单单轮聊天不需要完整 runtime。"
    ].join("\n"),
    confidenceScore: 0.89,
    reasoningSummary:
      "AgentScope, CrewAI, Google ADK, InternLM Lagent, MetaGPT, and CAMEL facts show convergence around tools, memory, multi-agent workflows, state, evaluation, and production deployment. This supports a runtime-level pattern for agent framework selection.",
    support: [
      "3901d9b7-d499-4763-86ca-c7f330db340f",
      "4a80179c-e87b-4247-b087-a4e313805114",
      "3bb50009-7642-4538-aef3-9a8273deacff",
      "deb643b1-70b5-4e40-98db-53d23849f841",
      "d769f2c1-b5f9-41d1-a105-d6ced5c384ca",
      "a039f94c-c94f-4168-af2e-c801354e2126",
      "6004baa1-94fc-4953-acdb-96109a96c65f",
      "4ffc15c7-b50c-45c5-a78e-af35c2f660a3"
    ]
  },
  {
    knowledgeType: "design_principle",
    title: "Agent 工具和 MCP 接入必须有结构化授权、沙箱和审计，而不能只靠提示词约束",
    content: [
      "# Agent 工具和 MCP 接入必须有结构化授权、沙箱和审计，而不能只靠提示词约束",
      "",
      "只在 prompt 里告诉 agent“不要做危险操作”不够。只要系统允许工具调用、MCP、文件、网络或外部资源，安全边界就必须由 harness 和协议层承担。",
      "",
      "最低工程要求：",
      "",
      "1. 权限采用 deny/allow/approval 等结构化规则，不依赖模型自觉。",
      "2. 高风险工具在沙箱或受控环境里执行，外部访问需要显式批准或策略放行。",
      "3. MCP/工具调用要带身份、作用域、预算、错误语义和审计记录。",
      "4. 检索到的文档、网页、用户输入和工具返回都应视为不可信上下文，不能直接覆盖系统规则。",
      "5. 对敏感动作保留 trace，能解释谁触发、用了哪个工具、为什么允许、结果是什么。",
      "",
      "适用边界：凡是 agent 能执行动作、访问私有数据或调用外部服务，就应采用这条原则；纯离线问答可以简化。"
    ].join("\n"),
    confidenceScore: 0.92,
    reasoningSummary:
      "Harness engineering materials describe permission architecture, sandboxing, MCP protocol gaps, and authorization standards. MCP Authorization describes transport-level authorization. Prompt injection/RAG facts show retrieved content is an attack surface. These sources support structured security outside prompt text.",
    support: [
      "3f919717-9f92-42c2-8b1e-d0972ae04d6b",
      "0095bf84-ad7e-4714-b55a-deb18f576b4f",
      "71938526-a7a1-468a-ab03-f933c8041e58",
      "6bb3518c-6da7-465e-ae8d-5d38bef42502",
      "4e1f8097-a930-4c2a-852e-5e79d61af8bf",
      "e2bb7071-5f72-40d1-9c58-6f5acc711cab"
    ]
  },
  {
    knowledgeType: "design_principle",
    title: "检索基础设施应抽象为可替换后端，核心契约是混合召回、过滤、融合和重排",
    content: [
      "# 检索基础设施应抽象为可替换后端，核心契约是混合召回、过滤、融合和重排",
      "",
      "Milvus、Qdrant、Pinecone、Weaviate、Elasticsearch、FlagEmbedding 等组件解决的是不同层面的检索能力，不应把某一个后端直接写死成知识系统本体。",
      "",
      "稳定的工程契约应包括：",
      "",
      "1. dense 向量召回：解决语义相近和改写问题。",
      "2. sparse/BM25 召回：解决关键词、术语、编号、字段和短文本硬命中。",
      "3. metadata/payload 过滤：解决用户、版本、权限、时间和来源边界。",
      "4. fusion/RRF：把多路候选合并为统一排序，避免直接比较异构分数。",
      "5. rerank：在有限候选集上做最终相关性裁决。",
      "6. backend adapter：向上暴露统一接口，方便后续替换 Milvus、Elasticsearch 或其他存储。",
      "",
      "适用边界：这条原则服务普通召回路线和证据定位路线；当图谱治理产物足够成熟时，检索后端仍作为 evidence fallback 和校验通道。"
    ].join("\n"),
    confidenceScore: 0.9,
    reasoningSummary:
      "Pinecone hybrid search shows dense and sparse vector combination. Elasticsearch RRF shows rank fusion. Qdrant facts cover filtering and scaling. BGE/FlagEmbedding supports embedding/rerank model choices. Together these sources support a backend-agnostic retrieval contract.",
    support: [
      "c2dbb99e-66b3-4353-a48b-97269d4a5489",
      "f04dfe83-70b2-4439-9dac-53f7086fbcf0",
      "4f5d4a68-c2ba-4bfa-a17b-36c8529412b3",
      "bea7e5dd-10cf-436c-98bf-266e74a2a0cc",
      "b1717e98-bf31-428b-acc8-c578f48755fe",
      "6c9e4769-ac19-434e-9c9e-7520075dd932",
      "474bf4f0-261c-4ee4-8328-de60dc564df9"
    ]
  },
  {
    knowledgeType: "derived_rule",
    title: "Agent 观测必须记录轨迹、工具调用、上下文和成本，否则无法治理失败",
    content: [
      "# Agent 观测必须记录轨迹、工具调用、上下文和成本，否则无法治理失败",
      "",
      "Agent 系统失败通常不是单点错误，而是上下文、工具、权限、状态、模型输出和外部环境共同作用的结果。没有运行轨迹，就无法判断失败发生在哪一层。",
      "",
      "观测规则：",
      "",
      "1. 每次运行记录输入、计划、工具调用、模型调用、检索结果、输出和错误。",
      "2. trace/span 应能串起多步任务，而不是只保存最终回答。",
      "3. 成本、token、工具耗时、循环次数和预算消耗要进入治理数据。",
      "4. 失败案例要能回放或至少重建关键证据链，供后续治理、测试和 skill 沉淀使用。",
      "5. 观测数据不是最终知识，只有稳定模式和修复经验才应升级为 derived knowledge 或 skill。",
      "",
      "适用边界：凡是多步 agent、RAG、工具调用或自动化执行，都应保留观测；一次性简单问答可以只保留轻量日志。"
    ].join("\n"),
    confidenceScore: 0.91,
    reasoningSummary:
      "DeepEval traces, Langfuse, Awesome Harness observability resources, event log pattern, and AutoHarness cost attribution all emphasize traceable execution, tool calls, costs, and diagnostics. These facts support observability as a governance prerequisite.",
    support: [
      "0be58122-7baa-45d7-a9e5-55b157258b74",
      "b101ea17-6e3d-4c40-9698-13a421876a11",
      "b29a9b8d-4b29-4331-be14-2a96d960e248",
      "2556dffd-64e4-4ea7-87b6-7eac8d4faa98",
      "a1ecd120-7ba2-4d8d-a71d-c5a57d91a09e",
      "37376b7b-5d01-4733-8a8e-d50601134fd3"
    ]
  }
];

async function loadEvidence(factIds) {
  const { rows } = await pool.query(
    `
    SELECT DISTINCT ON (f.id)
      f.id AS fact_id,
      f.title AS fact_title,
      f.statement AS fact_statement,
      e.id AS evidence_id,
      e.source_uri AS evidence_source_uri,
      d.id AS document_id,
      d.title AS document_title
    FROM kp_fact f
    JOIN kp_relation ev
      ON ev.tenant_id = f.tenant_id
     AND ev.scope = f.scope
     AND ev.from_object_type = 'fact'
     AND ev.from_object_id = f.id
     AND ev.to_object_type = 'evidence'
     AND ev.relation_type = 'evidenced_by'
     AND ev.status = 'active'
    JOIN kp_evidence e
      ON e.id = ev.to_object_id
     AND e.status = 'active'
    JOIN kp_relation ds
      ON ds.tenant_id = f.tenant_id
     AND ds.scope = f.scope
     AND ds.from_object_type = 'fact'
     AND ds.from_object_id = f.id
     AND ds.to_object_type = 'section'
     AND ds.relation_type = 'derived_from'
     AND ds.status = 'active'
    JOIN kp_section s
      ON s.id = ds.to_object_id
     AND s.status = 'active'
    JOIN kp_document d
      ON d.id = s.document_id
     AND d.status = 'active'
    WHERE f.tenant_id = $1
      AND f.scope = $2
      AND f.id = ANY($3::uuid[])
      AND f.status = 'active'
    ORDER BY f.id, f.importance DESC, f.confidence_score DESC
    `,
    [tenantId, scope, factIds]
  );
  return rows;
}

async function retireLowValueFacts(jobId) {
  const { rows } = await pool.query(
    `
    WITH protected_facts AS (
      SELECT DISTINCT source_object_id::uuid AS fact_id
      FROM kp_synthesized_knowledge_evidence
      WHERE tenant_id = $1
        AND scope = $2
        AND status = 'active'
        AND source_object_type = 'fact'
    ),
    low_value AS (
      SELECT f.id
      FROM kp_fact f
      WHERE f.tenant_id = $1
        AND f.scope = $2
        AND f.status = 'active'
        AND NOT EXISTS (SELECT 1 FROM protected_facts pf WHERE pf.fact_id = f.id)
        AND (
          lower(f.title) IN (
            'languages',
            'forks',
            'license',
            'navigation menu',
            'folders and files',
            'search code, repositories, users, issues, pull requests...',
            'use saved searches to filter your results more quickly',
            'uh oh!',
            'citation',
            'references',
            'contributors',
            'history',
            'installation',
            'from pypi',
            'using pip:',
            'pull the source code from github'
          )
          OR f.statement ~* '(you can.t perform that action|there was an error while loading|name name last commit message|search syntax tips|no releases published|code open more actions menu|source url: https://github.com|apache-2.0 license|mit license|pip install|git clone)'
          OR length(trim(f.statement)) < 45
        )
    ),
    updated AS (
      UPDATE kp_fact f
      SET status = 'retired',
          lifecycle_state = 'archived',
          review_state = 'model_accepted',
          metadata = f.metadata || jsonb_build_object(
            'retired_by', 'codex_model_layer_governance',
            'retire_reason', 'low_value_repository_or_installation_noise',
            'governance_job_id', $3::text
          ),
          trace_id = $4,
          updated_at = now()
      FROM low_value lv
      WHERE f.id = lv.id
      RETURNING f.id
    )
    SELECT id FROM updated
    `,
    [tenantId, scope, jobId, traceId]
  );

  const retiredIds = rows.map((row) => row.id);
  if (retiredIds.length === 0) {
    return { retired_fact_count: 0, retired_relation_count: 0 };
  }

  const relationResult = await pool.query(
    `
    UPDATE kp_relation
    SET status = 'retired',
        metadata = metadata || jsonb_build_object(
          'retired_by', 'codex_model_layer_governance',
          'retire_reason', 'connected_fact_retired',
          'governance_job_id', $3::text
        ),
        trace_id = $4,
        updated_at = now()
    WHERE tenant_id = $1
      AND scope = $2
      AND status = 'active'
      AND (
        (from_object_type = 'fact' AND from_object_id = ANY($5::uuid[]))
        OR (to_object_type = 'fact' AND to_object_id = ANY($5::uuid[]))
      )
    `,
    [tenantId, scope, jobId, traceId, retiredIds]
  );

  const decisionId = randomUUID();
  await pool.query(
    `
    INSERT INTO kp_governance_decision (
      id, tenant_id, scope, status, version, governance_job_id, governance_type,
      target_object_type, target_object_id, decision, confidence_score, risk_level,
      evidence_refs, reason, before_state, after_state, model_name, prompt_version,
      ruleset_version, trace_id
    )
    VALUES (
      $1, $2, $3, 'active', 1, $4, 'corpus_noise_governance',
      'fact_batch', NULL, 'retire_low_value_noise', 0.9500, 'low',
      '[]'::jsonb, $5, $6::jsonb, $7::jsonb, 'codex-model-layer',
      'manual-codex-governance-v2', 'knowledge-governance-rules-v2', $8
    )
    `,
    [
      decisionId,
      tenantId,
      scope,
      jobId,
      "Repository navigation, installation snippets, license/footer rows, GitHub UI noise, loading errors, and very short fragments were retired from active governance.",
      json({ active_fact_status_before: "active" }),
      json({
        retired_fact_count: retiredIds.length,
        retired_relation_count: relationResult.rowCount,
        protected_evidence_bound_facts: true
      }),
      traceId
    ]
  );

  return {
    retired_fact_count: retiredIds.length,
    retired_relation_count: relationResult.rowCount
  };
}

async function markRemainingFactsEvidenceOnly(jobId) {
  const { rowCount } = await pool.query(
    `
    INSERT INTO kp_recall_surface_state (
      id, tenant_id, scope, status, version, object_type, object_id, recall_state,
      context_assembly_state, governance_job_id, reason, metadata, trace_id
    )
    SELECT
      gen_random_uuid(),
      f.tenant_id,
      f.scope,
      'active',
      1,
      'fact',
      f.id,
      CASE
        WHEN EXISTS (
          SELECT 1
          FROM kp_synthesized_knowledge_evidence ske
          WHERE ske.tenant_id = f.tenant_id
            AND ske.scope = f.scope
            AND ske.status = 'active'
            AND ske.source_object_type = 'fact'
            AND ske.source_object_id = f.id
        ) THEN 'evidence_support'
        ELSE 'evidence_only'
      END,
      CASE
        WHEN EXISTS (
          SELECT 1
          FROM kp_synthesized_knowledge_evidence ske
          WHERE ske.tenant_id = f.tenant_id
            AND ske.scope = f.scope
            AND ske.status = 'active'
            AND ske.source_object_type = 'fact'
            AND ske.source_object_id = f.id
        ) THEN 'supporting_evidence'
        ELSE 'not_default_context'
      END,
      $3,
      CASE
        WHEN EXISTS (
          SELECT 1
          FROM kp_synthesized_knowledge_evidence ske
          WHERE ske.tenant_id = f.tenant_id
            AND ske.scope = f.scope
            AND ske.status = 'active'
            AND ske.source_object_type = 'fact'
            AND ske.source_object_id = f.id
        ) THEN 'Fact is retained as explicit evidence for derived knowledge.'
        ELSE 'Fact remains available for audit/evidence fallback, but should not be assembled as default knowledge before further governance.'
      END,
      jsonb_build_object('governed_by', 'codex_model_layer_governance', 'governance_completion', true),
      $4
    FROM kp_fact f
    WHERE f.tenant_id = $1
      AND f.scope = $2
      AND f.status = 'active'
    ON CONFLICT (tenant_id, scope, object_type, object_id) DO UPDATE
    SET recall_state = EXCLUDED.recall_state,
        context_assembly_state = EXCLUDED.context_assembly_state,
        governance_job_id = EXCLUDED.governance_job_id,
        reason = EXCLUDED.reason,
        metadata = kp_recall_surface_state.metadata || EXCLUDED.metadata,
        trace_id = EXCLUDED.trace_id,
        updated_at = now()
    `,
    [tenantId, scope, jobId, traceId]
  );

  return { fact_recall_surface_upsert_count: rowCount };
}

async function main() {
  await pool.query("BEGIN");
  try {
    const jobId = randomUUID();
    await pool.query(
      `
      INSERT INTO kp_governance_job (
        id, tenant_id, scope, status, version, job_type, trigger_type, trigger_ref,
        target_object_type, target_object_ids, priority, run_status, requested_by, payload, trace_id
      )
      VALUES (
        $1, $2, $3, 'recorded', 1, 'codex_model_layer_governance',
        'manual_codex_model_layer', $4, 'fact', '[]'::jsonb, 80,
        'running', 'codex', $5::jsonb, $6
      )
      `,
      [
        jobId,
        tenantId,
        scope,
        `codex-governance://${Date.now()}`,
        json({
          execution_mode: "codex_as_model_layer",
          adapter_layer: "not_used",
          item_count: synthesisItems.length
        }),
        traceId
      ]
    );

    const created = [];
    const decisions = [];
    const recallStates = [];
    for (const item of synthesisItems) {
      const evidenceRows = await loadEvidence(item.support);
      const missing = item.support.filter((factId) => !evidenceRows.some((row) => row.fact_id === factId));
      if (missing.length) {
        throw new Error(`Missing active evidence for ${item.title}: ${missing.join(", ")}`);
      }

      const evidenceIds = [...new Set(evidenceRows.map((row) => row.evidence_id))];
      const sourceObjectIds = [...new Set(evidenceRows.map((row) => row.fact_id))];
      const normalizedContent = normalizeContent(item.content);
      const metadata = {
        governance_output_type: "derived_knowledge",
        model_layer_executor: "codex",
        evidence_bound: true,
        source_documents: evidenceRows.map((row) => ({
          document_id: row.document_id,
          document_title: row.document_title,
          evidence_source_uri: row.evidence_source_uri
        })),
        content_hash: createHash("sha256").update(item.content, "utf8").digest("hex")
      };

      const existing = await pool.query(
        `
        SELECT id
        FROM kp_synthesized_knowledge
        WHERE tenant_id = $1
          AND scope = $2
          AND knowledge_type = $3
          AND normalized_content = $4
        LIMIT 1
        `,
        [tenantId, scope, item.knowledgeType, normalizedContent]
      );
      let synthesizedId = existing.rows[0]?.id;
      let existed = Boolean(synthesizedId);
      if (synthesizedId) {
        await pool.query(
          `
          UPDATE kp_synthesized_knowledge
          SET status = 'active',
              lifecycle_state = 'curated',
              review_state = 'model_accepted',
              recall_state = 'active',
              evidence_ids = $5::jsonb,
              source_object_ids = $6::jsonb,
              reasoning_summary = $7,
              confidence_score = $8,
              risk_level = 'low',
              governance_job_id = $9,
              metadata = metadata || $10::jsonb,
              updated_at = now()
          WHERE id = $1
            AND tenant_id = $2
            AND scope = $3
            AND knowledge_type = $4
          `,
          [
            synthesizedId,
            tenantId,
            scope,
            item.knowledgeType,
            jsonArray(evidenceIds),
            jsonArray(sourceObjectIds),
            item.reasoningSummary,
            item.confidenceScore,
            jobId,
            json(metadata)
          ]
        );
      } else {
        synthesizedId = randomUUID();
        await pool.query(
          `
          INSERT INTO kp_synthesized_knowledge (
            id, tenant_id, scope, status, version, memory_domain, lifecycle_state, review_state,
            recall_state, knowledge_type, title, content, normalized_content, source_object_ids,
            evidence_ids, reasoning_summary, confidence_score, risk_level, governance_job_id,
            metadata, trace_id
          )
          VALUES (
            $1, $2, $3, 'active', 1, 'knowledge', 'curated', 'model_accepted',
            'active', $4, $5, $6, $7, $8::jsonb,
            $9::jsonb, $10, $11, 'low', $12,
            $13::jsonb, $14
          )
          `,
          [
            synthesizedId,
            tenantId,
            scope,
            item.knowledgeType,
            item.title,
            item.content,
            normalizedContent,
            jsonArray(sourceObjectIds),
            jsonArray(evidenceIds),
            item.reasoningSummary,
            item.confidenceScore,
            jobId,
            json(metadata),
            traceId
          ]
        );
      }

      for (const row of evidenceRows) {
        await pool.query(
          `
          INSERT INTO kp_synthesized_knowledge_evidence (
            tenant_id, scope, status, synthesized_knowledge_id, evidence_id,
            source_object_type, source_object_id, support_role, trace_id
          )
          VALUES ($1, $2, 'active', $3, $4, 'fact', $5, 'supports', $6)
          ON CONFLICT (synthesized_knowledge_id, evidence_id, source_object_type, source_object_id) DO NOTHING
          `,
          [tenantId, scope, synthesizedId, row.evidence_id, row.fact_id, traceId]
        );
      }

      const decisionId = randomUUID();
      await pool.query(
        `
        INSERT INTO kp_governance_decision (
          id, tenant_id, scope, status, version, governance_job_id, governance_type,
          target_object_type, target_object_id, decision, confidence_score, risk_level,
          evidence_refs, reason, before_state, after_state, model_name, prompt_version,
          ruleset_version, trace_id
        )
        VALUES (
          $1, $2, $3, 'active', 1, $4, 'cross_source_synthesis_governance',
          'synthesized_knowledge', $5, 'model_accepted', $6, 'low',
          $7::jsonb, $8, '{}'::jsonb, $9::jsonb, 'codex-model-layer',
          'manual-codex-governance-v1', 'knowledge-governance-rules-v1', $10
        )
        `,
        [
          decisionId,
          tenantId,
          scope,
          jobId,
          synthesizedId,
          item.confidenceScore,
          jsonArray(evidenceIds),
          item.reasoningSummary,
          json({
            existed,
            recall_state: "active",
            knowledge_type: item.knowledgeType,
            source_object_ids: sourceObjectIds
          }),
          traceId
        ]
      );
      decisions.push(decisionId);

      const recallId = randomUUID();
      await pool.query(
        `
        INSERT INTO kp_recall_surface_state (
          id, tenant_id, scope, status, version, object_type, object_id, recall_state,
          context_assembly_state, governance_job_id, reason, metadata, trace_id
        )
        VALUES (
          $1, $2, $3, 'active', 1, 'synthesized_knowledge', $4, 'active',
          'active', $5, $6, $7::jsonb, $8
        )
        ON CONFLICT (tenant_id, scope, object_type, object_id) DO UPDATE
        SET recall_state = EXCLUDED.recall_state,
            context_assembly_state = EXCLUDED.context_assembly_state,
            governance_job_id = EXCLUDED.governance_job_id,
            reason = EXCLUDED.reason,
            metadata = kp_recall_surface_state.metadata || EXCLUDED.metadata,
            trace_id = EXCLUDED.trace_id,
            updated_at = now()
        RETURNING id
        `,
        [
          recallId,
          tenantId,
          scope,
          synthesizedId,
          jobId,
          "Codex model-layer governance accepted this evidence-bound derived knowledge for normal recall.",
          json({ model_layer_executor: "codex", evidence_bound: true }),
          traceId
        ]
      );
      recallStates.push(recallId);
      created.push({ id: synthesizedId, title: item.title, existed, evidence_count: evidenceIds.length });
    }

    const corpusNoiseGovernance = await retireLowValueFacts(jobId);
    const factRecallGovernance = await markRemainingFactsEvidenceOnly(jobId);

    await pool.query(
      `
      UPDATE kp_governance_job
      SET run_status = 'completed',
          started_at = COALESCE(started_at, now()),
          finished_at = now(),
          result_payload = $4::jsonb,
          updated_at = now()
      WHERE id = $1
        AND tenant_id = $2
        AND scope = $3
      `,
      [
        jobId,
        tenantId,
        scope,
        json({
          decision: "completed",
          execution_mode: "codex_as_model_layer",
          synthesized_knowledge_ids: created.map((item) => item.id),
          governance_decision_ids: decisions,
          recall_surface_state_ids: recallStates,
          corpus_noise_governance: corpusNoiseGovernance,
          fact_recall_governance: factRecallGovernance,
          created
        })
      ]
    );

    await pool.query("COMMIT");
    console.log(
      JSON.stringify(
        {
          ok: true,
          tenant_id: tenantId,
          scope,
          job_id: jobId,
          created,
          corpus_noise_governance: corpusNoiseGovernance,
          fact_recall_governance: factRecallGovernance
        },
        null,
        2
      )
    );
  } catch (error) {
    await pool.query("ROLLBACK");
    throw error;
  } finally {
    await pool.end();
  }
}

await main();

import fs from "node:fs/promises";

const outputPath = new URL("../tests/knowledge-benchmark/ai-dev-source-candidates.v1.json", import.meta.url);

const targetDocuments = 280;

const blockedUrls = new Set(
  [
    "https://blog.langchain.org.cn/launching-long-term-memory-support-in-langgraph",
    "https://openai.com/index/the-next-evolution-of-the-agents-sdk",
    "https://microsoft.github.io/graphrag",
    "https://github.com/QwenLM/Qwen-Agent/blob/main/README.md",
    "https://milvus.io/docs/integrate_with_langchain.md",
    "https://milvus.io/docs/zh",
    "https://developer.volcengine.com/articles/7529428812854427699",
    "https://www.volcengine.com/docs/82379",
    "https://milvus.io/docs/zh/integrate_with_langchain.md",
    "https://milvus.io/docs/zh/hybrid_search_with_milvus.md",
    "https://milvus.io/docs/zh/single-vector-search.md",
    "https://milvus.io/docs/zh/full-text-search.md",
    "https://milvus.io/docs/zh/reranking.md",
    "https://milvus.io/docs/zh/embeddings.md",
    "https://www.volcengine.com/docs/82379/1263482",
    "https://www.volcengine.com/docs/82379/1263481",
    "https://www.volcengine.com/docs/82379/1263483",
    "https://github.com/GAIA-benchmark/GAIA",
    "https://github.com/zilliztech/GraphRAG",
    "https://github.com/modelcontextprotocol/servers",
    "http://arxiv.org/abs/2604.23338v1",
    "https://github.com/TauricResearch/TradingAgents",
    "https://github.com/wanshuiyin/Auto-claude-code-research-in-sleep"
  ].map(normalizeUrlKey)
);

const topicByKeyword = [
  ["memory", "agent_memory"],
  ["mem0", "agent_memory"],
  ["rag", "rag"],
  ["retrieval", "rag"],
  ["agentic rag", "agentic_rag"],
  ["eval", "eval_harness"],
  ["benchmark", "eval_harness"],
  ["harness", "harness_engineering"],
  ["mcp", "mcp_tool_use"],
  ["model context protocol", "mcp_tool_use"],
  ["prompt injection", "security"],
  ["security", "security"],
  ["tool", "tool_use"],
  ["agent", "agent_framework"],
  ["workflow", "agent_framework"],
  ["vector", "vector_database"],
  ["embedding", "embedding_retrieval"],
  ["rerank", "reranking"],
  ["observability", "observability"],
  ["tracing", "observability"],
  ["knowledge graph", "knowledge_graph"],
  ["graph", "knowledge_graph"]
];

const fixedSources = [
  // Agent memory and context.
  ["LangGraph Memory Overview", "https://docs.langchain.com/oss/javascript/langgraph/memory", "en", "official_doc", "agent_memory", "high", "p0"],
  ["LangGraph Persistence", "https://docs.langchain.com/oss/javascript/langgraph/persistence", "en", "official_doc", "agent_memory", "high", "p0"],
  ["LangGraph Memory Concepts", "https://langchain-ai.github.io/langgraph/concepts/memory/", "en", "official_doc", "agent_memory", "high", "p0"],
  ["LangGraph Persistence Concepts", "https://langchain-ai.github.io/langgraph/concepts/persistence/", "en", "official_doc", "agent_memory", "high", "p1"],
  ["LangMem SDK Launch", "https://www.langchain.com/blog/langmem-sdk-launch", "en", "product_blog", "agent_memory", "medium", "p1"],
  ["GitHub Copilot Memory Public Preview", "https://github.blog/changelog/2026-01-15-agentic-memory-for-github-copilot-is-in-public-preview/", "en", "product_changelog", "agent_memory", "high", "p0"],
  ["Building an Agentic Memory System for GitHub Copilot", "https://github.blog/ai-and-ml/github-copilot/building-an-agentic-memory-system-for-github-copilot/", "en", "engineering_blog", "agent_memory", "high", "p0"],
  ["OpenAI Memory FAQ", "https://help.openai.com/en/articles/8590148-memory-faq", "en", "official_doc", "agent_memory", "high", "p0"],
  ["Mem0 Platform Overview", "https://docs.mem0.ai/overview", "en", "official_doc", "agent_memory", "medium", "p1"],
  ["Zep Documentation", "https://help.getzep.com/", "en", "official_doc", "agent_memory", "medium", "p1"],
  ["Letta Documentation", "https://docs.letta.com/", "en", "official_doc", "agent_memory", "medium", "p1"],
  ["A memory architecture for agentic system", "https://gist.github.com/spikelab/7551c6368e23caa06a4056350f6b2db3", "en", "engineering_blog", "agent_memory", "low", "p2"],
  ["Agent Memory System Design", "https://eastondev.com/blog/zh/posts/ai/agent-memory-system/", "zh-CN", "engineering_blog", "agent_memory", "medium", "p1"],
  ["AI Agent 记忆管理：长期记忆与知识治理实战", "https://eastondev.com/blog/zh/posts/ai/20260413-ai-agent-memory/", "zh-CN", "engineering_blog", "agent_memory", "medium", "p1"],
  ["LangGraph 推出长期记忆支持", "https://blog.langchain.org.cn/launching-long-term-memory-support-in-langgraph/", "zh-CN", "translated_blog", "agent_memory", "medium", "p1"],

  // Agent frameworks.
  ["OpenAI Agents SDK Guide", "https://platform.openai.com/docs/guides/agents-sdk/", "en", "official_doc", "agent_framework", "high", "p0"],
  ["OpenAI Agents SDK JS Agents Guide", "https://openai.github.io/openai-agents-js/guides/agents/", "en", "official_doc", "agent_framework", "high", "p0"],
  ["OpenAI Agents SDK Python", "https://openai.github.io/openai-agents-python/", "en", "official_doc", "agent_framework", "high", "p0"],
  ["The Next Evolution of the Agents SDK", "https://openai.com/index/the-next-evolution-of-the-agents-sdk", "en", "product_blog", "agent_framework", "high", "p1"],
  ["Microsoft AutoGen Repository", "https://github.com/microsoft/autogen", "en", "github_repo", "agent_framework", "high", "p0"],
  ["Microsoft Agent Framework Documentation", "https://learn.microsoft.com/en-us/agent-framework/", "en", "official_doc", "agent_framework", "high", "p1"],
  ["Semantic Kernel Documentation", "https://learn.microsoft.com/en-us/semantic-kernel/overview/", "en", "official_doc", "agent_framework", "high", "p1"],
  ["Google Agent Development Kit", "https://google.github.io/adk-docs/", "en", "official_doc", "agent_framework", "high", "p1"],
  ["Google Genkit Documentation", "https://firebase.google.com/docs/genkit", "en", "official_doc", "agent_framework", "high", "p1"],
  ["CrewAI Documentation", "https://docs.crewai.com/", "en", "official_doc", "agent_framework", "medium", "p1"],
  ["Pydantic AI Documentation", "https://ai.pydantic.dev/", "en", "official_doc", "agent_framework", "medium", "p1"],
  ["Agno Documentation", "https://docs.agno.com/", "en", "official_doc", "agent_framework", "medium", "p1"],
  ["Dify Documentation", "https://docs.dify.ai/", "en", "official_doc", "agent_framework", "medium", "p1"],
  ["Dify 中文文档", "https://docs.dify.ai/zh-hans", "zh-CN", "official_doc", "agent_framework", "medium", "p1"],
  ["Qwen Agent Repository", "https://github.com/QwenLM/Qwen-Agent", "en", "github_repo", "agent_framework", "high", "p1"],
  ["Qwen Agent Function Calling", "https://github.com/QwenLM/Qwen-Agent/blob/main/README.md", "en", "github_repo", "agent_framework", "medium", "p1"],
  ["ModelScope AgentScope", "https://github.com/modelscope/agentscope", "en", "github_repo", "agent_framework", "medium", "p1"],
  ["AgentScope Documentation", "https://doc.agentscope.io/", "en", "official_doc", "agent_framework", "medium", "p1"],
  ["CAMEL AI Documentation", "https://docs.camel-ai.org/", "en", "official_doc", "agent_framework", "medium", "p1"],

  // RAG and retrieval.
  ["LlamaIndex Introduction to RAG", "https://docs.llamaindex.ai/en/stable/understanding/rag/", "en", "official_doc", "rag", "high", "p0"],
  ["LlamaIndex RAG Workflow with Reranking", "https://docs.llamaindex.ai/en/stable/examples/workflow/rag/", "en", "official_doc", "rag", "high", "p1"],
  ["LlamaIndex Query Engine", "https://docs.llamaindex.ai/en/stable/module_guides/deploying/query_engine/", "en", "official_doc", "rag", "high", "p1"],
  ["LlamaIndex Node Parser Modules", "https://docs.llamaindex.ai/en/stable/module_guides/loading/node_parsers/", "en", "official_doc", "rag", "high", "p1"],
  ["LangChain RAG Tutorial", "https://python.langchain.com/docs/tutorials/rag/", "en", "official_doc", "rag", "high", "p0"],
  ["LangChain Retrieval Concept", "https://python.langchain.com/docs/concepts/retrieval/", "en", "official_doc", "rag", "high", "p1"],
  ["Haystack Repository", "https://github.com/deepset-ai/haystack", "en", "github_repo", "rag", "high", "p0"],
  ["Haystack Documentation", "https://docs.haystack.deepset.ai/docs/intro", "en", "official_doc", "rag", "high", "p0"],
  ["Milvus RAG Documentation", "https://milvus.io/docs/integrate_with_langchain.md", "en", "official_doc", "rag", "medium", "p1"],
  ["Milvus 中文文档", "https://milvus.io/docs/zh", "zh-CN", "official_doc", "vector_database", "medium", "p1"],
  ["Qdrant RAG Guide", "https://qdrant.tech/documentation/overview/", "en", "official_doc", "vector_database", "medium", "p1"],
  ["Weaviate Hybrid Search", "https://weaviate.io/developers/weaviate/search/hybrid", "en", "official_doc", "vector_database", "medium", "p1"],
  ["Pinecone Hybrid Search", "https://docs.pinecone.io/guides/search/hybrid-search", "en", "official_doc", "vector_database", "medium", "p1"],
  ["Elasticsearch BM25", "https://www.elastic.co/guide/en/elasticsearch/reference/current/index-modules-similarity.html", "en", "official_doc", "lexical_retrieval", "medium", "p1"],
  ["Elasticsearch Reciprocal Rank Fusion", "https://www.elastic.co/guide/en/elasticsearch/reference/current/rrf.html", "en", "official_doc", "hybrid_retrieval", "medium", "p1"],

  // Evaluation and harness.
  ["RAGAS Documentation", "https://docs.ragas.io/en/stable/howtos/applications/evaluate-and-improve-rag/", "en", "official_doc", "eval_harness", "high", "p0"],
  ["RAGAS Metrics", "https://docs.ragas.io/en/stable/concepts/metrics/available_metrics/", "en", "official_doc", "eval_harness", "high", "p0"],
  ["DeepEval Introduction", "https://deepeval.com/docs/introduction", "en", "official_doc", "eval_harness", "high", "p0"],
  ["DeepEval RAG Evaluation", "https://deepeval.com/docs/guides-rag-evaluation", "en", "official_doc", "eval_harness", "high", "p0"],
  ["OpenAI Evals Repository", "https://github.com/openai/evals", "en", "github_repo", "eval_harness", "high", "p1"],
  ["Inspect AI Documentation", "https://inspect.aisi.org.uk/", "en", "official_doc", "eval_harness", "high", "p1"],
  ["Promptfoo Documentation", "https://www.promptfoo.dev/docs/intro/", "en", "official_doc", "eval_harness", "medium", "p1"],
  ["LangSmith Evaluation", "https://docs.smith.langchain.com/evaluation", "en", "official_doc", "eval_harness", "high", "p1"],
  ["Phoenix Evaluation", "https://docs.arize.com/phoenix/evaluation", "en", "official_doc", "eval_harness", "medium", "p1"],
  ["Giskard Documentation", "https://docs.giskard.ai/", "en", "official_doc", "eval_harness", "medium", "p1"],
  ["SWE-bench", "https://www.swebench.com/", "en", "benchmark", "eval_harness", "high", "p1"],
  ["SWE-bench Repository", "https://github.com/SWE-bench/SWE-bench", "en", "github_repo", "eval_harness", "high", "p1"],
  ["GAIA Benchmark", "https://huggingface.co/datasets/gaia-benchmark/GAIA", "en", "benchmark", "eval_harness", "high", "p1"],
  ["AgentBench Repository", "https://github.com/THUDM/AgentBench", "en", "github_repo", "eval_harness", "high", "p1"],
  ["RAGAS 论文解读", "https://docs.ragas.io/en/stable/", "zh-CN", "official_doc", "eval_harness", "medium", "p1"],
  ["RAG 系统效果评估框架与工具", "https://developer.volcengine.com/articles/7529428812854427699", "zh-CN", "engineering_blog", "eval_harness", "medium", "p1"],

  // Harness engineering.
  ["AutoHarness Repository", "https://github.com/aiming-lab/AutoHarness", "en", "github_repo", "harness_engineering", "medium", "p1"],
  ["Awesome Harness Engineering", "https://github.com/ai-boost/awesome-harness-engineering", "en", "github_repo", "harness_engineering", "medium", "p1"],
  ["Agent Harness: How AI Agents Are Benchmarked", "https://www.envisioning.com/vocab/agent-harness", "en", "reference_article", "harness_engineering", "low", "p2"],
  ["Harness Engineering: The Discipline That Determines Whether Your AI Agents Actually Work", "https://tianpan.co/blog/2026-02-17-harness-engineering-agent-first-software-development", "en", "engineering_blog", "harness_engineering", "medium", "p1"],
  ["Harness AI SWE-bench Verified", "https://www.harness.io/blog/harness-excels-in-swe-bench-verified", "en", "product_blog", "harness_engineering", "medium", "p1"],
  ["AI Engineering Harness Repository", "https://github.com/adrielp/ai-engineering-harness", "en", "github_repo", "harness_engineering", "low", "p2"],
  ["Awesome Agent Harness", "https://github.com/Picrew/awesome-agent-harness", "en", "github_repo", "harness_engineering", "low", "p2"],

  // MCP, tools, and security.
  ["Model Context Protocol Specification", "https://modelcontextprotocol.io/specification/draft", "en", "official_doc", "mcp_tool_use", "high", "p0"],
  ["MCP Tools Concept", "https://modelcontextprotocol.io/docs/concepts/tools", "en", "official_doc", "mcp_tool_use", "high", "p0"],
  ["MCP Resources Concept", "https://modelcontextprotocol.io/docs/concepts/resources", "en", "official_doc", "mcp_tool_use", "high", "p1"],
  ["MCP Prompts Concept", "https://modelcontextprotocol.io/docs/concepts/prompts", "en", "official_doc", "mcp_tool_use", "high", "p1"],
  ["MCP Authorization", "https://modelcontextprotocol.io/specification/draft/basic/authorization", "en", "official_doc", "security", "high", "p1"],
  ["MCP 中文文档：Tools", "https://mcp.transdocs.org/docs/concepts/tools", "zh-CN", "translated_doc", "mcp_tool_use", "medium", "p1"],
  ["MCP Security Best Practices", "https://modelcontextprotocol.io/specification/draft/basic/security_best_practices", "en", "official_doc", "security", "high", "p1"],
  ["OWASP Top 10 for LLM Applications", "https://genai.owasp.org/llm-top-10/", "en", "official_doc", "security", "high", "p1"],
  ["OWASP LLM Prompt Injection", "https://genai.owasp.org/llmrisk/llm01-prompt-injection/", "en", "official_doc", "security", "high", "p1"],
  ["Microsoft AI Red Teaming", "https://learn.microsoft.com/en-us/security/ai-red-team/", "en", "official_doc", "security", "high", "p1"],

  // Knowledge graphs and observability.
  ["Neo4j GraphRAG", "https://neo4j.com/developer/genai-ecosystem/graphrag-python/", "en", "official_doc", "knowledge_graph", "medium", "p1"],
  ["LlamaIndex Knowledge Graph Index", "https://docs.llamaindex.ai/en/stable/module_guides/indexing/lpg_index_guide/", "en", "official_doc", "knowledge_graph", "medium", "p1"],
  ["Microsoft GraphRAG Repository", "https://github.com/microsoft/graphrag", "en", "github_repo", "knowledge_graph", "high", "p1"],
  ["Microsoft GraphRAG Documentation", "https://microsoft.github.io/graphrag/", "en", "official_doc", "knowledge_graph", "high", "p1"],
  ["Langfuse Documentation", "https://langfuse.com/docs", "en", "official_doc", "observability", "medium", "p1"],
  ["Arize Phoenix Documentation", "https://docs.arize.com/phoenix", "en", "official_doc", "observability", "medium", "p1"],
  ["OpenTelemetry GenAI Semantic Conventions", "https://opentelemetry.io/docs/specs/semconv/gen-ai/", "en", "official_doc", "observability", "medium", "p1"],

  // Chinese AI platform docs.
  ["通义千问 Qwen 文档", "https://qwen.readthedocs.io/zh-cn/latest/", "zh-CN", "official_doc", "agent_framework", "medium", "p1"],
  ["ModelScope 文档", "https://modelscope.cn/docs", "zh-CN", "official_doc", "agent_framework", "medium", "p1"],
  ["智谱 AI 开放平台文档", "https://open.bigmodel.cn/dev/howuse/introduction", "zh-CN", "official_doc", "agent_framework", "medium", "p1"],
  ["火山方舟大模型服务平台", "https://www.volcengine.com/docs/82379", "zh-CN", "official_doc", "agent_framework", "medium", "p1"],
  ["百度智能云千帆大模型平台", "https://cloud.baidu.com/doc/WENXINWORKSHOP/index.html", "zh-CN", "official_doc", "agent_framework", "medium", "p1"],
  ["腾讯云知识引擎原子能力", "https://cloud.tencent.com/document/product/1772", "zh-CN", "official_doc", "rag", "medium", "p1"],
  ["阿里云百炼文档", "https://help.aliyun.com/zh/model-studio/", "zh-CN", "official_doc", "agent_framework", "medium", "p1"]
];

const githubQueries = [
  { query: "agent framework llm stars:>500", topic: "agent_framework" },
  { query: "multi agent framework llm stars:>300", topic: "agent_framework" },
  { query: "rag framework retrieval augmented generation stars:>300", topic: "rag" },
  { query: "llm evaluation framework rag stars:>100", topic: "eval_harness" },
  { query: "agent benchmark llm stars:>100", topic: "eval_harness" },
  { query: "agent memory long term memory stars:>50", topic: "agent_memory" },
  { query: "model context protocol mcp server stars:>50", topic: "mcp_tool_use" },
  { query: "harness engineering agent stars:>10", topic: "harness_engineering" },
  { query: "prompt injection llm security stars:>100", topic: "security" },
  { query: "graphrag knowledge graph rag stars:>100", topic: "knowledge_graph" }
];

const githubFallbackSources = [
  ["langchain-ai/langchain", "https://github.com/langchain-ai/langchain", "agent_framework", "high"],
  ["langchain-ai/langgraph", "https://github.com/langchain-ai/langgraph", "agent_framework", "high"],
  ["run-llama/llama_index", "https://github.com/run-llama/llama_index", "rag", "high"],
  ["deepset-ai/haystack", "https://github.com/deepset-ai/haystack", "rag", "high"],
  ["microsoft/autogen", "https://github.com/microsoft/autogen", "agent_framework", "high"],
  ["microsoft/semantic-kernel", "https://github.com/microsoft/semantic-kernel", "agent_framework", "high"],
  ["google/adk-python", "https://github.com/google/adk-python", "agent_framework", "high"],
  ["crewAIInc/crewAI", "https://github.com/crewAIInc/crewAI", "agent_framework", "high"],
  ["pydantic/pydantic-ai", "https://github.com/pydantic/pydantic-ai", "agent_framework", "high"],
  ["agno-agi/agno", "https://github.com/agno-agi/agno", "agent_framework", "medium"],
  ["QwenLM/Qwen-Agent", "https://github.com/QwenLM/Qwen-Agent", "agent_framework", "medium"],
  ["modelscope/agentscope", "https://github.com/modelscope/agentscope", "agent_framework", "medium"],
  ["camel-ai/camel", "https://github.com/camel-ai/camel", "agent_framework", "medium"],
  ["Significant-Gravitas/AutoGPT", "https://github.com/Significant-Gravitas/AutoGPT", "agent_framework", "medium"],
  ["yoheinakajima/babyagi", "https://github.com/yoheinakajima/babyagi", "agent_framework", "medium"],
  ["e2b-dev/awesome-ai-agents", "https://github.com/e2b-dev/awesome-ai-agents", "agent_framework", "medium"],
  ["openai/openai-agents-python", "https://github.com/openai/openai-agents-python", "agent_framework", "high"],
  ["openai/openai-agents-js", "https://github.com/openai/openai-agents-js", "agent_framework", "high"],
  ["mem0ai/mem0", "https://github.com/mem0ai/mem0", "agent_memory", "high"],
  ["getzep/zep", "https://github.com/getzep/zep", "agent_memory", "medium"],
  ["letta-ai/letta", "https://github.com/letta-ai/letta", "agent_memory", "medium"],
  ["langchain-ai/langmem", "https://github.com/langchain-ai/langmem", "agent_memory", "medium"],
  ["supermemoryai/supermemory", "https://github.com/supermemoryai/supermemory", "agent_memory", "medium"],
  ["ragas/ragas", "https://github.com/explodinggradients/ragas", "eval_harness", "high"],
  ["confident-ai/deepeval", "https://github.com/confident-ai/deepeval", "eval_harness", "high"],
  ["openai/evals", "https://github.com/openai/evals", "eval_harness", "high"],
  ["UKGovernmentBEIS/inspect_ai", "https://github.com/UKGovernmentBEIS/inspect_ai", "eval_harness", "high"],
  ["promptfoo/promptfoo", "https://github.com/promptfoo/promptfoo", "eval_harness", "medium"],
  ["langfuse/langfuse", "https://github.com/langfuse/langfuse", "observability", "medium"],
  ["Arize-ai/phoenix", "https://github.com/Arize-ai/phoenix", "observability", "medium"],
  ["traceloop/openllmetry", "https://github.com/traceloop/openllmetry", "observability", "medium"],
  ["SWE-bench/SWE-bench", "https://github.com/SWE-bench/SWE-bench", "eval_harness", "high"],
  ["THUDM/AgentBench", "https://github.com/THUDM/AgentBench", "eval_harness", "high"],
  ["GAIA-benchmark/GAIA", "https://github.com/GAIA-benchmark/GAIA", "eval_harness", "medium"],
  ["microsoft/graphrag", "https://github.com/microsoft/graphrag", "knowledge_graph", "high"],
  ["neo4j/neo4j-graphrag-python", "https://github.com/neo4j/neo4j-graphrag-python", "knowledge_graph", "medium"],
  ["zilliztech/GraphRAG", "https://github.com/zilliztech/GraphRAG", "knowledge_graph", "medium"],
  ["milvus-io/milvus", "https://github.com/milvus-io/milvus", "vector_database", "high"],
  ["qdrant/qdrant", "https://github.com/qdrant/qdrant", "vector_database", "high"],
  ["weaviate/weaviate", "https://github.com/weaviate/weaviate", "vector_database", "high"],
  ["chroma-core/chroma", "https://github.com/chroma-core/chroma", "vector_database", "high"],
  ["pinecone-io/examples", "https://github.com/pinecone-io/examples", "vector_database", "medium"],
  ["modelcontextprotocol/servers", "https://github.com/modelcontextprotocol/servers", "mcp_tool_use", "high"],
  ["modelcontextprotocol/typescript-sdk", "https://github.com/modelcontextprotocol/typescript-sdk", "mcp_tool_use", "high"],
  ["modelcontextprotocol/python-sdk", "https://github.com/modelcontextprotocol/python-sdk", "mcp_tool_use", "high"],
  ["anthropics/anthropic-cookbook", "https://github.com/anthropics/anthropic-cookbook", "tool_use", "medium"],
  ["openai/openai-cookbook", "https://github.com/openai/openai-cookbook", "tool_use", "high"],
  ["NVIDIA/garak", "https://github.com/NVIDIA/garak", "security", "medium"],
  ["protectai/rebuff", "https://github.com/protectai/rebuff", "security", "medium"],
  ["microsoft/promptbench", "https://github.com/microsoft/promptbench", "security", "medium"],
  ["aiming-lab/AutoHarness", "https://github.com/aiming-lab/AutoHarness", "harness_engineering", "medium"],
  ["ai-boost/awesome-harness-engineering", "https://github.com/ai-boost/awesome-harness-engineering", "harness_engineering", "medium"],
  ["adrielp/ai-engineering-harness", "https://github.com/adrielp/ai-engineering-harness", "harness_engineering", "low"],
  ["Picrew/awesome-agent-harness", "https://github.com/Picrew/awesome-agent-harness", "harness_engineering", "low"]
];

const arxivQueries = [
  { query: 'all:"agent memory"', topic: "agent_memory" },
  { query: 'all:"long-term memory" AND all:"agent"', topic: "agent_memory" },
  { query: 'all:"agentic RAG"', topic: "agentic_rag" },
  { query: 'all:"retrieval augmented generation" AND all:"evaluation"', topic: "eval_harness" },
  { query: 'all:"tool use" AND all:"large language model"', topic: "tool_use" },
  { query: 'all:"prompt injection" AND all:"large language model"', topic: "security" },
  { query: 'all:"knowledge graph" AND all:"retrieval augmented generation"', topic: "knowledge_graph" },
  { query: 'all:"LLM agent" AND all:"benchmark"', topic: "eval_harness" }
];

const cnSearchSources = [
  ["RAG 技术综述与实践", "https://developer.aliyun.com/article/1500266", "rag"],
  ["大模型 RAG 检索增强生成实践", "https://cloud.tencent.com/developer/article/2359818", "rag"],
  ["向量数据库与 RAG 应用实践", "https://zilliz.com.cn/blog", "vector_database"],
  ["Milvus RAG 实践教程", "https://milvus.io/docs/zh/integrate_with_langchain.md", "rag"],
  ["Milvus 混合搜索中文文档", "https://milvus.io/docs/zh/hybrid_search_with_milvus.md", "hybrid_retrieval"],
  ["Milvus 单向量搜索中文文档", "https://milvus.io/docs/zh/single-vector-search.md", "vector_database"],
  ["Milvus 全文检索中文文档", "https://milvus.io/docs/zh/full-text-search.md", "lexical_retrieval"],
  ["Milvus Rerank 中文文档", "https://milvus.io/docs/zh/reranking.md", "reranking"],
  ["Milvus Embeddings 中文文档", "https://milvus.io/docs/zh/embeddings.md", "embedding_retrieval"],
  ["Dify RAG 知识库文档", "https://docs.dify.ai/zh-hans/guides/knowledge-base", "rag"],
  ["Dify 工作流中文文档", "https://docs.dify.ai/zh-hans/guides/workflow", "agent_framework"],
  ["Dify Agent 中文文档", "https://docs.dify.ai/zh-hans/guides/agent", "agent_framework"],
  ["Dify 监控中文文档", "https://docs.dify.ai/zh-hans/guides/monitoring", "observability"],
  ["Dify 工具中文文档", "https://docs.dify.ai/zh-hans/guides/tools", "tool_use"],
  ["LLM 应用评估实践", "https://developer.volcengine.com/articles/7529428812854427699", "eval_harness"],
  ["MCP 协议中文介绍", "https://mcp.transdocs.org/", "mcp_tool_use"],
  ["MCP 工具中文规范", "https://mcp.transdocs.org/specification/draft/server/tools", "mcp_tool_use"],
  ["MCP 资源中文规范", "https://mcp.transdocs.org/specification/draft/server/resources", "mcp_tool_use"],
  ["MCP 提示词中文规范", "https://mcp.transdocs.org/specification/draft/server/prompts", "mcp_tool_use"],
  ["提示词注入安全风险", "https://owasp.org/www-project-top-10-for-large-language-model-applications/", "security"],
  ["AI Agent 记忆系统设计", "https://jiangren.com.au/en/wiki/ai-agent-guide/section/design-patterns/memory", "agent_memory"],
  ["AI Agent 记忆管理实战", "https://htmlpage.cn/topics/ai/ai-agent-memory-management-practice", "agent_memory"],
  ["agent 长期中期短期记忆调研", "https://www.flandre.ltd/agent-memory/", "agent_memory"],
  ["AI Agent 的长期记忆工程取舍", "https://www.phppan.com/tag/rag/", "agent_memory"],
  ["Ragas 大模型评测框架深度调研指南", "https://www.cnblogs.com/yangykaifa/p/19616131", "eval_harness"],
  ["Python LLM 评估的 DeepEval / RAGAS 框架", "https://www.php.cn/faq/2124695.html", "eval_harness"],
  ["Agentic RAG 中文论文解读", "https://hub.baai.ac.cn/view/41937", "agentic_rag"],
  ["大模型 Agent 论文整理", "https://blog.csdn.net/libaiup/article/details/150003750", "agent_framework"],
  ["模型上下文协议中文百科", "https://zh.wikipedia.org/wiki/%E6%A8%A1%E5%9E%8B%E4%B8%8A%E4%B8%8B%E6%96%87%E5%8D%8F%E8%AE%AE", "mcp_tool_use"],
  ["检索增强生成中文百科", "https://zh.wikipedia.org/wiki/%E6%AA%A2%E7%B4%A2%E5%A2%9E%E5%BC%B7%E7%94%9F%E6%88%90", "rag"],
  ["可检索性中文百科", "https://zh.wikipedia.org/wiki/%E5%8F%AF%E6%A3%80%E7%B4%A2%E6%80%A7", "rag"],
  ["AI Agent 智能体技术发展报告", "https://www.sdecu.com/virtual_attach_file.vsb?afc=SoRlzPL4fRnzf2Ml7LiU47DnzN4U47rPn7QfMNLYn778LR90gihFp2hmCIa0L1yinSyiMYyiLmGsMlnfM8nkLRGaL778o7-Yoz94nzL4M4WFnRM7UNlaU4AFLlnVozV2gjfNQmOeo4x4Q2rm6590qIbtpYyYMR7Pg478LzvsLSbw62I8c&e=.pdf&nid=141771&oid=2123883912&tid=2411", "agent_framework"],
  ["大模型上下文工程指南", "https://www.cdut.edu.cn/__local/4/A7/81/EA807C0CAAAF77FDAC03EC61C0B_FF6614F6_68E2A6.pdf", "agent_memory"],
  ["RAG 方案优化与性能评估", "https://www.calsp.cn/wp-content/uploads/2024/05/3.%E8%83%A1%E4%BA%AE%E3%80%8ARAG%E6%96%B9%E6%A1%88%E4%BC%98%E5%8C%96%E4%B8%8E%E6%80%A7%E8%83%BD%E8%AF%84%E4%BC%B0%E3%80%8B.pdf", "eval_harness"],
  ["仿真领域 Agentic RAG 论文", "https://www.china-simulation.com/EN/article/downloadArticleFile.do?attachType=PDF&id=3837", "agentic_rag"],
  ["医学大模型 Agent 综述 PDF", "https://www.biomedrxiv.org.cn/article/pdf/display/10.12201/bmr.202509.00063", "agent_framework"],
  ["通义千问文档：快速开始", "https://qwen.readthedocs.io/zh-cn/latest/getting_started/quickstart.html", "agent_framework"],
  ["通义千问 Agent 仓库", "https://github.com/QwenLM/Qwen-Agent", "agent_framework"],
  ["通义千问 Agent README", "https://github.com/QwenLM/Qwen-Agent/blob/main/README.md", "tool_use"],
  ["ModelScope 文档：快速开始", "https://modelscope.cn/docs/intro/quickstart", "agent_framework"],
  ["ModelScope 文档：模型下载", "https://modelscope.cn/docs/models/download", "agent_framework"],
  ["AgentScope 中文主页", "https://github.com/agentscope-ai/agentscope", "agent_framework"],
  ["智谱 AI 智能体开发", "https://open.bigmodel.cn/dev/howuse/agent", "agent_framework"],
  ["智谱 AI 工具调用", "https://open.bigmodel.cn/dev/howuse/functioncall", "tool_use"],
  ["火山方舟知识库", "https://www.volcengine.com/docs/82379/1263482", "rag"],
  ["火山方舟应用实验室", "https://www.volcengine.com/docs/82379/1263481", "agent_framework"],
  ["百度千帆应用接入", "https://cloud.baidu.com/doc/WENXINWORKSHOP/s/flfmc9do2", "agent_framework"],
  ["百度千帆函数调用", "https://cloud.baidu.com/doc/WENXINWORKSHOP/s/clntwmv7t", "tool_use"],
  ["腾讯云大模型知识引擎", "https://cloud.tencent.com/document/product/1772/115969", "rag"],
  ["腾讯云大模型知识引擎知识库", "https://cloud.tencent.com/document/product/1772/115970", "rag"],
  ["阿里云百炼应用开发", "https://help.aliyun.com/zh/model-studio/user-guide/application-development", "agent_framework"],
  ["阿里云百炼知识库", "https://help.aliyun.com/zh/model-studio/user-guide/knowledge-base", "rag"],
  ["阿里云百炼插件调用", "https://help.aliyun.com/zh/model-studio/user-guide/plugin", "tool_use"],
  ["阿里云百炼模型调用", "https://help.aliyun.com/zh/model-studio/user-guide/model-calling", "agent_framework"],
  ["阿里云百炼应用评测", "https://help.aliyun.com/zh/model-studio/user-guide/application-evaluation", "eval_harness"],
  ["火山方舟模型评测", "https://www.volcengine.com/docs/82379/1263483", "eval_harness"],
  ["腾讯云大模型知识引擎问答", "https://cloud.tencent.com/document/product/1772/115971", "rag"],
  ["百度千帆知识库", "https://cloud.baidu.com/doc/WENXINWORKSHOP/s/llq07mec1", "rag"],
  ["扣子 Bot 开发文档", "https://www.coze.cn/docs/developer_guides/coze_api_overview", "agent_framework"],
  ["扣子知识库文档", "https://www.coze.cn/docs/guides/knowledge", "rag"],
  ["扣子插件文档", "https://www.coze.cn/docs/guides/plugin", "tool_use"],
  ["RAGFlow 开源项目", "https://github.com/infiniflow/ragflow", "rag"],
  ["FastGPT 开源知识库项目", "https://github.com/labring/FastGPT", "rag"],
  ["MaxKB 开源知识库项目", "https://github.com/1Panel-dev/MaxKB", "rag"],
  ["QAnything 本地知识库问答", "https://github.com/netease-youdao/QAnything", "rag"],
  ["Datawhale LLM Universe", "https://github.com/datawhalechina/llm-universe", "rag"],
  ["Datawhale Self LLM", "https://github.com/datawhalechina/self-llm", "agent_framework"],
  ["MetaGPT 多智能体框架", "https://github.com/geekan/MetaGPT", "agent_framework"],
  ["InternLM Lagent", "https://github.com/InternLM/lagent", "agent_framework"],
  ["InternLM Tutorial", "https://github.com/InternLM/Tutorial", "agent_framework"],
  ["FlagEmbedding 检索向量模型", "https://github.com/FlagOpen/FlagEmbedding", "embedding_retrieval"],
  ["OpenBMB AgentVerse", "https://github.com/OpenBMB/AgentVerse", "agent_framework"],
  ["OpenBMB BMTools", "https://github.com/OpenBMB/BMTools", "tool_use"],
  ["THUDM ChatGLM3 工具调用", "https://github.com/THUDM/ChatGLM3", "tool_use"],
  ["DB-GPT 开源数据应用开发框架", "https://github.com/eosphoros-ai/DB-GPT", "agent_framework"],
  ["OpenCompass 大模型评测", "https://github.com/open-compass/opencompass", "eval_harness"]
].map(([title, url, topic]) => [title, url, "zh-CN", "engineering_blog", topic, "medium", "p2"]);

function inferTopic(text, fallback = "agent_framework") {
  const lower = text.toLowerCase();
  for (const [keyword, topic] of topicByKeyword) {
    if (lower.includes(keyword)) return topic;
  }
  return fallback;
}

function makeId(prefix, index) {
  return `${prefix}-${String(index).padStart(3, "0")}`;
}

function normalizeUrl(url) {
  return url.replace(/\/+$/, "");
}

function normalizeUrlKey(url) {
  return normalizeUrl(String(url).trim()).toLowerCase();
}

function makeCandidate({ id, title, url, language, sourceType, topic, quality, priority, method, reason }) {
  return {
    id,
    title: title.trim(),
    url: normalizeUrl(url.trim()),
    language,
    source_type: sourceType,
    topic_hint: topic,
    quality_hint: quality,
    freshness_hint: "current",
    collection_method: method,
    collected_reason: reason,
    ingest_priority: priority
  };
}

async function fetchJson(url) {
  const response = await fetch(url, {
    headers: {
      "User-Agent": "SuperAgentSystem knowledge benchmark collector"
    }
  });
  if (!response.ok) {
    throw new Error(`${response.status} ${response.statusText} for ${url}`);
  }
  return response.json();
}

async function collectGithub() {
  const out = githubFallbackSources.map((source, index) =>
    makeCandidate({
      id: makeId("source-github-fallback", index + 1),
      title: source[0],
      url: source[1],
      language: "en",
      sourceType: "github_repo",
      topic: source[2],
      quality: source[3],
      priority: source[3] === "high" ? "p0" : "p1",
      method: "github_static_fallback",
      reason: "静态 GitHub fallback 池，用于避免匿名 GitHub Search API 限流导致候选池不可复现。"
    })
  );
  let i = out.length + 1;
  for (const item of githubQueries) {
    const url = `https://api.github.com/search/repositories?q=${encodeURIComponent(item.query)}&sort=stars&order=desc&per_page=18`;
    try {
      const data = await fetchJson(url);
      for (const repo of data.items ?? []) {
        out.push(
          makeCandidate({
            id: makeId("source-github", i++),
            title: repo.full_name,
            url: repo.html_url,
            language: "en",
            sourceType: "github_repo",
            topic: item.topic,
            quality: repo.stargazers_count > 5000 ? "high" : repo.stargazers_count > 500 ? "medium" : "low",
            priority: repo.stargazers_count > 5000 ? "p0" : "p1",
            method: "github_search",
            reason: `GitHub 搜索 ${item.query} 的高星真实项目，用于模拟用户自然收集项目 README、docs、issues 和 examples。`
          })
        );
      }
    } catch (error) {
      process.stderr.write(`[warn] GitHub query failed: ${item.query}: ${error.message}\n`);
    }
  }
  return out;
}

async function collectArxiv() {
  const out = [];
  let i = 1;
  for (const item of arxivQueries) {
    const url = `https://export.arxiv.org/api/query?search_query=${encodeURIComponent(item.query)}&start=0&max_results=18&sortBy=submittedDate&sortOrder=descending`;
    try {
      const response = await fetch(url, { headers: { "User-Agent": "SuperAgentSystem knowledge benchmark collector" } });
      if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
      const xml = await response.text();
      const entries = xml.match(/<entry>[\s\S]*?<\/entry>/g) ?? [];
      for (const entry of entries) {
        const title = decodeXml((entry.match(/<title>([\s\S]*?)<\/title>/)?.[1] ?? "").replace(/\s+/g, " ").trim());
        const idUrl = entry.match(/<id>(.*?)<\/id>/)?.[1]?.trim();
        if (!title || !idUrl) continue;
        out.push(
          makeCandidate({
            id: makeId("source-arxiv", i++),
            title,
            url: idUrl,
            language: "en",
            sourceType: "paper",
            topic: item.topic,
            quality: "medium",
            priority: "p1",
            method: "arxiv_api",
            reason: `arXiv 搜索 ${item.query} 的近期论文，用于覆盖论文类自然知识来源。`
          })
        );
      }
    } catch (error) {
      process.stderr.write(`[warn] arXiv query failed: ${item.query}: ${error.message}\n`);
    }
  }
  return out;
}

function decodeXml(text) {
  return text
    .replaceAll("&amp;", "&")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&quot;", '"')
    .replaceAll("&apos;", "'");
}

async function main() {
  const fixed = [...fixedSources, ...cnSearchSources].map((source, index) =>
    makeCandidate({
      id: makeId("source-fixed", index + 1),
      title: source[0],
      url: source[1],
      language: source[2],
      sourceType: source[3],
      topic: source[4],
      quality: source[5],
      priority: source[6],
      method: "curated_seed",
      reason: source[2] === "zh-CN" ? "中文用户调研 AI 工程、RAG、memory、MCP 或评测时可能自然打开。" : "真实用户调研 AI 工程、RAG、memory、MCP、评测或 harness engineering 时可能自然打开。"
    })
  );

  const github = await collectGithub();
  const arxiv = await collectArxiv();
  const merged = [];
  const seen = new Set();

  const selectedPool = [
    ...fixed,
    ...arxiv.slice(0, 60),
    ...github.slice(0, Math.max(0, targetDocuments - fixed.length - Math.min(arxiv.length, 60) + 30)),
    ...arxiv.slice(60),
    ...github
  ];

  for (const candidate of selectedPool) {
    const key = normalizeUrlKey(candidate.url);
    if (blockedUrls.has(key)) continue;
    if (seen.has(key)) continue;
    seen.add(key);
    merged.push({ ...candidate, topic_hint: inferTopic(`${candidate.title} ${candidate.url}`, candidate.topic_hint) });
    if (merged.length >= targetDocuments) break;
  }

  const reindexed = merged.map((candidate, index) => ({
    ...candidate,
    id: makeId("source-ai-dev", index + 1)
  }));

  const result = {
    schema_version: "ai-dev-source-candidates.v1",
    purpose: "自然语料候选池。只记录真实采集属性，不预先写文档关系；关系由后续治理评测层标注和系统发现。",
    generated_at: new Date().toISOString(),
    target_scale: {
      documents: "250-300",
      english_ratio: "65%-75%",
      chinese_ratio: "25%-35%"
    },
    collection_rules: [
      "不为了建立关系反向挑选文档。",
      "优先真实用户调研时会自然打开的资料。",
      "完全重复 URL 不保留；相似但视角不同的资料可以保留。",
      "保留少量低质量或干扰资料，用于测试治理降权和 no-answer 边界。",
      "候选项不得包含 related_to、supports、same_as、contradicts 等关系字段。"
    ],
    collection_plan: {
      fixed_seed_sources: fixed.length,
      github_search_sources: github.length,
      arxiv_sources: arxiv.length,
      selected_documents: reindexed.length,
      target_documents: targetDocuments
    },
    candidates: reindexed
  };

  await fs.writeFile(outputPath, `${JSON.stringify(result, null, 2)}\n`, "utf8");
  process.stdout.write(
    JSON.stringify(
      {
        ok: true,
        output: outputPath.pathname,
        candidates: reindexed.length,
        fixed: fixed.length,
        github: github.length,
        arxiv: arxiv.length,
        by_language: countBy(reindexed, "language"),
        by_topic: countBy(reindexed, "topic_hint"),
        by_type: countBy(reindexed, "source_type")
      },
      null,
      2
    )
  );
}

function countBy(items, key) {
  return items.reduce((acc, item) => {
    acc[item[key]] = (acc[item[key]] ?? 0) + 1;
    return acc;
  }, {});
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

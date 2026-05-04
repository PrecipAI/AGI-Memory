# 知识平台 AI 真实测试说明

## 1. 这几个文件分别是干什么的

### 资料池定义

- [ai-domain-corpus.v1.md](D:/workspace/projects/SuperAgentSystem-main/tests/knowledge-benchmark/ai-domain-corpus.v1.md)
  - 第一轮 AI 方向测试资料池说明
  - 解释为什么选这 8 份资料
  - 说明每份资料主要测什么能力

- [ai-domain-corpus.v1.json](D:/workspace/projects/SuperAgentSystem-main/tests/knowledge-benchmark/ai-domain-corpus.v1.json)
  - 机器可读的资料池清单
  - 供后续自动化脚本和测试扩展使用

### 真实导入测试

- [ai-real-ingest-cases.v1.json](D:/workspace/projects/SuperAgentSystem-main/tests/knowledge-benchmark/ai-real-ingest-cases.v1.json)
  - 第一轮真实导入测试清单
  - 定义每份资料的来源、主题、导入方式和预期信号

### 真实检索测试

- [ai-real-retrieval-benchmark.v1.json](D:/workspace/projects/SuperAgentSystem-main/tests/knowledge-benchmark/ai-real-retrieval-benchmark.v1.json)
  - 第一轮真实问题集
  - 目前问题正文为了更贴近英文原始资料，主测试使用英文问句
  - 中文问题建议后续作为跨语种边界测试单独补充

### 真实评测脚本

- [run-knowledge-real-eval.mjs](D:/workspace/projects/SuperAgentSystem-main/scripts/run-knowledge-real-eval.mjs)
  - 自动执行：
    - 抓取网页
    - 导入知识
    - 触发治理
    - 运行检索
    - 运行边界测试
    - 检查 console 接口
    - 输出报告

### 报告输出

- [ai-real-eval-report.json](D:/workspace/projects/SuperAgentSystem-main/tests/knowledge-benchmark/reports/ai-real-eval-report.json)
  - 第一轮真实测试结果报告

## 2. 现在是怎么做“导入”的

当前导入不是直接把网页原文完整入库，而是走一条“网页正文抽取 -> 文档导入 -> section -> candidate -> governance”的链路。

### 当前导入入口

接口：

- `POST /internal/knowledge/documents/ingest`

对应实现：

- [knowledgeDocumentIngest.ts](D:/workspace/projects/SuperAgentSystem-main/services/memory-service/src/knowledgeDocumentIngest.ts)

### 当前真实测试里的网页导入方式

在真实评测脚本中：

- 先抓目标网页 HTML
- 去掉 `script / style / noscript / svg`
- 粗提取 `<body>` 中的可见文本
- 做简单去重和空白压缩
- 在正文前面补：
  - 标题
  - `Source URL`

也就是说，**当前第一版不是通用爬虫/阅读器级别导入**，而是一个可用的正文抽取版本。

### 导入支持什么

当前 `knowledge document ingest` 支持：

- `local_file`
  - 本地 `Markdown/TXT`
- `inline_text`
  - 直接传文本

真实测试脚本目前用的是：

- 先抓网页
- 再用 `inline_text` 方式送进导入接口

## 3. 导入后，知识会变成什么样

导入后不会只是一条“原文记录”，而是会变成几类对象。

### 第一层：文档载体

- `kp_document`
  - 表示一篇资料
  - 保存标题、来源、语言、元数据

### 第二层：章节/分段

- `kp_section`
  - 把文档拆成多个 section
  - 当前按 `paragraph` 或 `markdown` 模式切分

### 第三层：证据

- `kp_evidence`
  - 每个 section 会对应 evidence
  - 后面 fact 和 relation 可以挂到 evidence 上

### 第四层：候选记忆

- 每个 section 会被提升成一条 `memory_candidate`
  - 不是直接写成正式知识
  - 而是先进候选池

### 第五层：治理后的正式知识

治理后会生成：

- `kp_fact`
- `kp_entity`
- `kp_relation`
- `kp_context_bundle`
- 必要时 `kp_review_queue`

## 4. 导入后做了什么处理

### 4.1 文档和 section 落库

导入时先做：

1. 创建或复用 `kp_document`
2. 切分 section
3. 创建或复用 `kp_section`
4. 为每个 section 建 `kp_evidence`

### 4.2 section 提升为 candidate

每个 section 会转成一条 `memory_candidate`，附带：

- `document_id`
- `section_id`
- `section_key`
- `document_title`
- `evidence_id`
- `memory_domain`

### 4.3 只对新 candidate 触发治理

这次我专门做了一个约束：

- 导入后不会把整库未处理 candidate 全扫一遍
- 只会把这次新产生的 `candidate_ids` 传给治理

对应实现：

- [knowledgeGovernance.ts](D:/workspace/projects/SuperAgentSystem-main/services/memory-service/src/knowledgeGovernance.ts)

### 4.4 治理阶段做什么

治理现在会做：

1. 读取 candidate
2. 做基础归类
3. 落 `document / section / evidence`
4. 用 model worker 做轻量分析
5. 生成 `entity`
6. 生成 `fact`
7. 建关系：
  - `fact -> entity` (`about`)
  - `fact -> section` (`derived_from`)
  - `fact -> evidence` (`evidenced_by`)
8. 需要时写入 `review queue`
9. 生成一次 `context bundle`

## 5. 当前检索是怎么做的

当前检索入口：

- `POST /internal/knowledge/retrieve`

对应实现：

- [knowledgeRetrieve.ts](D:/workspace/projects/SuperAgentSystem-main/services/memory-service/src/knowledgeRetrieve.ts)

当前检索做的是：

1. 先走原有 memory baseline
2. 查 `entity`
3. 查 `fact`
4. 查 `relation`
5. 查 `evidence`
6. 查 `section`
7. 组装成结构化 bundle

当前为了让第一轮真实评测能跑起来，我补了一个轻量回退：

- 如果整句 query 命不中
- 会抽几个关键词重试

但这仍然只是第一版，**当前瓶颈还是 ranking / relevance，不是 ingest**。

## 6. 当前测试里最重要的结论

### 已经打通的

- 真实网页资料可抓取并导入
- 文档会变成 `document / section / evidence / candidate`
- governance 会处理这些 candidate
- 检索会返回 `facts / relations / evidence / sections`
- console 能看到 documents / overview / graph

### 当前主要短板

- 检索相关性和排序还不够强
- 跨主题问题容易召回到不够精准的文档
- 空内容导入目前虽然能失败，但还是 `500 INTERNAL_ERROR`
- 中文跨语种检索还没单独优化

## 7. 你看这些文件时建议先看什么

如果你想快速理解现状，建议先看：

1. [README.zh-CN.md](D:/workspace/projects/SuperAgentSystem-main/tests/knowledge-benchmark/README.zh-CN.md)
2. [ai-domain-corpus.v1.md](D:/workspace/projects/SuperAgentSystem-main/tests/knowledge-benchmark/ai-domain-corpus.v1.md)
3. [ai-real-eval-report.json](D:/workspace/projects/SuperAgentSystem-main/tests/knowledge-benchmark/reports/ai-real-eval-report.json)

如果你想看代码怎么实现，再看：

1. [knowledgeDocumentIngest.ts](D:/workspace/projects/SuperAgentSystem-main/services/memory-service/src/knowledgeDocumentIngest.ts)
2. [knowledgeGovernance.ts](D:/workspace/projects/SuperAgentSystem-main/services/memory-service/src/knowledgeGovernance.ts)
3. [knowledgeRetrieve.ts](D:/workspace/projects/SuperAgentSystem-main/services/memory-service/src/knowledgeRetrieve.ts)
4. [run-knowledge-real-eval.mjs](D:/workspace/projects/SuperAgentSystem-main/scripts/run-knowledge-real-eval.mjs)

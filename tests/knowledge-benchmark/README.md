# AI 知识库真实评测集

这个目录用于验证统一长期知识系统的真实导入、治理和召回能力。

## 文件

- `ai-real-ingest-cases.v1.json`：8 份 AI 方向真实资料导入集。
- `ai-real-retrieval-benchmark.v1.json`：10 条召回问题和期望命中文档。
- `source-cache/`：真实网页抓取缓存，避免每次测试都依赖公网稳定性。
- `reports/ai-real-eval-report.json`：机器可读测试结果。
- `reports/ai-real-eval-report.md`：中文人工审查报告。

## 运行

```powershell
$env:PGPASSWORD='postgres'
$env:MARKITDOWN_BIN='C:\Users\Administrator\AppData\Local\Programs\Python\Python311\Scripts\markitdown.exe'
npm run eval:knowledge:real
```

默认复用 `source-cache`。如需重新抓取公网资料：

```powershell
$env:KNOWLEDGE_EVAL_REFRESH_SOURCES='1'
npm run eval:knowledge:real
```

## 当前评测口径

- 导入链路：真实资料 -> Markdown -> document / section / evidence / candidate / fact。
- 召回链路：BM25 + hashing vector + RRF。
- 边界检查：重复导入、MarkItDown adapter、空内容错误。

当前代码已接入 fastembed + Milvus。若本机没有可连接的 Milvus，报告中的 `vector_engine` 会显示 `hashing_vector_v1_fallback_after_milvus_error`，表示自动降级到旧 baseline。

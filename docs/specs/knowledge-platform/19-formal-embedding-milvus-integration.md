# 正式 Embedding 与 Milvus 接入说明

## 1. 当前结论

知识平台的正式 embedding 代码路径已经接入：
- embedding provider：HTTP embedding service
- embedding model：`BAAI/bge-m3`
- embedding dimension：`1024`
- vector database：Milvus
- vector index：HNSW + COSINE
- collection：`super_agent_knowledge_sections_http_baai_bge_m3_1024`

PostgreSQL 仍负责：
- document
- section
- evidence
- fact
- entity
- relation
- governance metadata

Milvus 负责：
- section embedding
- 向量索引
- topK vector search

## 2. 运行时配置

```env
KNOWLEDGE_EMBEDDING_PROVIDER=http
KNOWLEDGE_EMBEDDING_MODEL=BAAI/bge-m3
KNOWLEDGE_EMBEDDING_DIMENSIONS=1024
KNOWLEDGE_EMBEDDING_HTTP_URL=http://127.0.0.1:8921/embed
KNOWLEDGE_EMBEDDING_HTTP_TIMEOUT_MS=180000
KNOWLEDGE_EMBEDDING_REQUIRED=0
MILVUS_ADDRESS=127.0.0.1:19530
MILVUS_KNOWLEDGE_COLLECTION=super_agent_knowledge_sections_http_baai_bge_m3_1024
MILVUS_USERNAME=
MILVUS_PASSWORD=
MILVUS_SSL=0
```

如果要强制 Milvus 必须可用：

```env
KNOWLEDGE_EMBEDDING_REQUIRED=1
```

## 3. 验证命令

先验证 Milvus 向量后端：

```powershell
npm run verify:knowledge:milvus
```

再跑完整真实评测：

```powershell
$env:PGPASSWORD='postgres'
$env:MARKITDOWN_BIN='C:\Users\Administrator\AppData\Local\Programs\Python\Python311\Scripts\markitdown.exe'
npm run eval:knowledge:real
```

## 4. 当前机器状态

当前机器已经完成 WSL2 + Ubuntu 22.04 + Docker Engine + Milvus standalone + bge-m3 embedding service 验证。

安装结果：
- WSL：`2.6.3.0`
- Ubuntu：`22.04.1 LTS`
- Docker Engine：`29.4.1`
- Docker Compose：`v5.1.3`
- Milvus：`milvusdb/milvus:v2.5.4`
- etcd：WSL 宿主 systemd 服务，`etcd v3.5.16`
- MinIO：`minio/minio:RELEASE.2023-03-20T20-16-18Z`
- embedding service：Python HTTP service，`BAAI/bge-m3`

本机特殊点：
- Docker registry 访问 `auth.docker.io` / `quay.io` 不稳定，所以没有使用 etcd 容器。
- etcd 改为 WSL 宿主 systemd 服务，避免继续卡在镜像下载。
- Milvus 和 MinIO 使用 Docker host network。
- WSL host network 端口不会稳定映射到 Windows `127.0.0.1`，Windows 侧测试应使用 WSL IP。

本次可用地址：

```powershell
$env:MILVUS_ADDRESS='172.21.205.29:19530'
```

注意：WSL IP 可能随 WSL 重启变化。重新获取：

```powershell
wsl.exe -d Ubuntu -- hostname -I
```

由于 WSL 会在没有前台进程时自动休眠，本机测试前需要保持 WSL 存活：

```powershell
Start-Process wsl.exe -WindowStyle Hidden -ArgumentList '-d Ubuntu -- bash -lc "while true; do sleep 3600; done"'
```

然后启动 Milvus：

```powershell
wsl.exe -d Ubuntu -- bash -lc 'systemctl start docker etcd; cd /root/milvus && docker compose up -d && docker compose ps'
```

检查健康：

```powershell
wsl.exe -d Ubuntu -- bash -lc 'curl -fsS http://127.0.0.1:9091/healthz && echo'
```

Windows 侧检查：

```powershell
Invoke-WebRequest -Uri 'http://172.21.205.29:9091/healthz' -UseBasicParsing
```

启动 embedding service：

```powershell
cd D:\workspace\projects\SuperAgentSystem-main\services\embedding-service
.\.venv\Scripts\python.exe .\server.py
```

检查 embedding service：

```powershell
npm run verify:embedding-service
```

## 5. 已验证结果

Milvus 后端验证通过：

```powershell
$env:MILVUS_ADDRESS='172.21.205.29:19530'
npm run verify:knowledge:milvus
```

验证结果：

```json
{
  "ok": true,
  "address": "172.21.205.29:19530",
  "collection": "super_agent_knowledge_sections_verify",
  "embedding_model": "fast-bge-small-en-v1.5",
  "dimension": 384,
  "result_count": 2,
  "top_result": {
    "score": 0.7324526309967041,
    "section_id": "verify-1"
  }
}
```

真实知识库评测通过：

```powershell
$env:DB_URL='postgresql://postgres:postgres@127.0.0.1:55432/super_agent_system'
$env:MILVUS_ADDRESS='172.21.205.29:19530'
npm run eval:knowledge:real
```

最新报告：

```text
D:\workspace\projects\SuperAgentSystem-main\tests\knowledge-benchmark\reports\ai-real-eval-report.md
```

核心指标：
- corpus_size：`8`
- retrieval_case_count：`10`
- ingest_success_rate：`1`
- Hit@1：`0.5`
- Hit@3：`0.7`
- Hit@5：`0.9`
- must_have_pass_rate：`0.7`
- ingest_p50_latency_ms：`11033.265`
- ingest_p95_latency_ms：`12562.117`
- retrieve_p50_latency_ms：`167.599`
- retrieve_p95_latency_ms：`249.787`
- vector_engine：`milvus:super_agent_knowledge_sections_http_baai_bge_m3_1024:http:BAAI/bge-m3`

这表示：
- 正式 embedding 已生效。
- Milvus 写入和检索链路已生效。
- 真实评测没有走 hashing fallback。
- bge-m3 直接替换后没有自动提升当前小测试集指标，说明主要瓶颈在 section/document 聚合、rerank、分段、摘要层和图谱治理召回。

## 6. fallback 行为

因此当前真实评测会显示：

```text
vector_engine = hashing_vector_v1_fallback_after_milvus_error
```

这表示：
- 业务代码已走 Milvus 优先路径。
- 但运行环境没有可连接的 Milvus。
- 系统自动降级到旧的 hashing vector baseline，避免导入和召回中断。

## 7. 后续接入 Milvus 的最小条件

需要提供任一可连接 Milvus：
- 本机 Docker / WSL 跑 Milvus standalone。
- 局域网 Milvus endpoint。
- 云端 Milvus / Zilliz endpoint。

只要 `MILVUS_ADDRESS` 可连，`npm run verify:knowledge:milvus` 应该通过；随后真实评测报告里的 `vector_engine` 应该变成：

```text
milvus:super_agent_knowledge_sections:fastembed:fast-bge-small-en-v1.5
```

当前正式目标口径为：

```text
milvus:super_agent_knowledge_sections_http_baai_bge_m3_1024:http:BAAI/bge-m3
```

## 8. 尚未完成

还没有完成：
- 将 WSL/Milvus 启动流程产品化为仓库脚本。
- Milvus 与 hashing baseline 的正式横向指标对比。
- 图搜索召回。
- 结构化导航召回。
- Hit@1 优化。

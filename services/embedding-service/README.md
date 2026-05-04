# Embedding Service

本服务是知识平台的正式 embedding adapter。Node 业务服务不直接加载 embedding 模型，只通过 HTTP 调用本服务。

默认模型：

```text
BAAI/bge-m3
```

默认接口：

```text
POST http://127.0.0.1:8921/embed
GET  http://127.0.0.1:8921/health
```

## 安装

```powershell
cd D:\workspace\projects\SuperAgentSystem-main\services\embedding-service
python -m venv .venv
.\.venv\Scripts\python.exe -m pip install -U pip
.\.venv\Scripts\python.exe -m pip install -r requirements.txt
```

## 启动

```powershell
.\.venv\Scripts\python.exe .\server.py
```

## 环境变量

```env
EMBEDDING_SERVICE_HOST=127.0.0.1
EMBEDDING_SERVICE_PORT=8921
EMBEDDING_MODEL=BAAI/bge-m3
EMBEDDING_BATCH_SIZE=8
EMBEDDING_MAX_LENGTH=8192
EMBEDDING_USE_FP16=0
```

CPU 环境建议先用 `EMBEDDING_USE_FP16=0`。如果后续部署到支持半精度的 GPU，再切成 `1`。

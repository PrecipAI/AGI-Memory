from __future__ import annotations

import json
import os
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from typing import Any

MODEL_NAME = os.environ.get("EMBEDDING_MODEL", "BAAI/bge-m3")
HOST = os.environ.get("EMBEDDING_SERVICE_HOST", "127.0.0.1")
PORT = int(os.environ.get("EMBEDDING_SERVICE_PORT", "8921"))
BATCH_SIZE = int(os.environ.get("EMBEDDING_BATCH_SIZE", "8"))
MAX_LENGTH = int(os.environ.get("EMBEDDING_MAX_LENGTH", "8192"))
USE_FP16 = os.environ.get("EMBEDDING_USE_FP16", "0") == "1"

_model: Any | None = None


def get_model() -> Any:
    global _model
    if _model is None:
        from FlagEmbedding import BGEM3FlagModel

        _model = BGEM3FlagModel(MODEL_NAME, use_fp16=USE_FP16)
    return _model


def to_float_vectors(raw: Any) -> list[list[float]]:
    if isinstance(raw, dict):
        raw = raw.get("dense_vecs")
    if raw is None:
        raise ValueError("embedding model returned no dense vectors")
    if hasattr(raw, "tolist"):
        raw = raw.tolist()
    return [[float(value) for value in vector] for vector in raw]


def embed(texts: list[str]) -> list[list[float]]:
    model = get_model()
    result = model.encode(
        texts,
        batch_size=BATCH_SIZE,
        max_length=MAX_LENGTH,
        return_dense=True,
        return_sparse=False,
        return_colbert_vecs=False,
    )
    return to_float_vectors(result)


class Handler(BaseHTTPRequestHandler):
    server_version = "SuperAgentEmbeddingService/0.1"

    def do_GET(self) -> None:
        if self.path != "/health":
            self.send_json(404, {"error": "not_found"})
            return
        self.send_json(200, {
            "ok": True,
            "model": MODEL_NAME,
            "dimensions": 1024,
            "loaded": _model is not None,
        })

    def do_POST(self) -> None:
        if self.path != "/embed":
            self.send_json(404, {"error": "not_found"})
            return
        try:
            length = int(self.headers.get("content-length", "0"))
            payload = json.loads(self.rfile.read(length).decode("utf-8"))
            texts = payload.get("texts")
            if not isinstance(texts, list) or not all(isinstance(item, str) for item in texts):
                self.send_json(400, {"error": "texts must be a string array"})
                return
            vectors = embed(texts)
            self.send_json(200, {
                "model": MODEL_NAME,
                "dimensions": 1024,
                "vectors": vectors,
            })
        except Exception as error:
            self.send_json(500, {
                "error": "embedding_failed",
                "message": str(error),
            })

    def log_message(self, format: str, *args: Any) -> None:
        return

    def send_json(self, status: int, payload: dict[str, Any]) -> None:
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("content-type", "application/json; charset=utf-8")
        self.send_header("content-length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)


def main() -> None:
    server = ThreadingHTTPServer((HOST, PORT), Handler)
    print(json.dumps({
        "ok": True,
        "service": "embedding-service",
        "host": HOST,
        "port": PORT,
        "model": MODEL_NAME,
        "dimensions": 1024,
        "use_fp16": USE_FP16,
    }, ensure_ascii=False))
    server.serve_forever()


if __name__ == "__main__":
    main()

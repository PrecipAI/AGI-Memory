const endpoint = process.env.KNOWLEDGE_EMBEDDING_HTTP_URL || "http://127.0.0.1:8921/embed";

const response = await fetch(endpoint, {
  method: "POST",
  headers: {
    "content-type": "application/json"
  },
  body: JSON.stringify({
    input_type: "query",
    texts: [
      "长期知识系统为什么需要治理和证据溯源？",
      "Why does a long-term memory system need evidence grounding?"
    ],
    model: process.env.KNOWLEDGE_EMBEDDING_MODEL || "BAAI/bge-m3"
  }),
  signal: AbortSignal.timeout(Number(process.env.KNOWLEDGE_EMBEDDING_HTTP_TIMEOUT_MS || 180_000))
});

if (!response.ok) {
  throw new Error(`embedding service failed: ${response.status} ${await response.text()}`);
}

const payload = await response.json();
if (!Array.isArray(payload.vectors) || payload.vectors.length !== 2) {
  throw new Error(`invalid embedding service payload: ${JSON.stringify(payload)}`);
}

for (const [index, vector] of payload.vectors.entries()) {
  if (!Array.isArray(vector) || vector.length !== 1024) {
    throw new Error(`vector ${index} dimension mismatch: ${Array.isArray(vector) ? vector.length : "not-array"}`);
  }
}

process.stdout.write(JSON.stringify({
  ok: true,
  endpoint,
  model: payload.model,
  dimensions: payload.dimensions,
  vector_count: payload.vectors.length
}, null, 2));
process.stdout.write("\n");

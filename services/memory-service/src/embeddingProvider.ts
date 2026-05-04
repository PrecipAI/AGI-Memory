const DEFAULT_MODEL = "BAAI/bge-m3";
const DEFAULT_DIMENSIONS = 1024;

export function getEmbeddingConfig() {
  const model = process.env.KNOWLEDGE_EMBEDDING_MODEL || DEFAULT_MODEL;
  return {
    provider: "http",
    model,
    dimensions: Number(process.env.KNOWLEDGE_EMBEDDING_DIMENSIONS || DEFAULT_DIMENSIONS),
    engine: `http:${model}`
  };
}

export async function embedKnowledgePassages(texts: string[]): Promise<number[][]> {
  if (texts.length === 0) {
    return [];
  }
  return embedWithHttpService("passage", texts);
}

export async function embedKnowledgeQuery(text: string): Promise<number[]> {
  const [vector] = await embedWithHttpService("query", [text]);
  if (!vector) {
    throw new Error("HTTP embedding service returned no query vector");
  }
  return vector;
}

async function embedWithHttpService(inputType: "query" | "passage", texts: string[]): Promise<number[][]> {
  const endpoint = process.env.KNOWLEDGE_EMBEDDING_HTTP_URL || "http://127.0.0.1:8921/embed";
  const config = getEmbeddingConfig();
  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "content-type": "application/json"
    },
    body: JSON.stringify({
      input_type: inputType,
      texts,
      model: config.model
    }),
    signal: AbortSignal.timeout(Number(process.env.KNOWLEDGE_EMBEDDING_HTTP_TIMEOUT_MS || 180_000))
  });

  if (!response.ok) {
    throw new Error(`HTTP embedding service failed: ${response.status} ${await response.text()}`);
  }

  const payload = await response.json() as {
    model?: string;
    dimensions?: number;
    vectors?: unknown;
  };
  if (!Array.isArray(payload.vectors)) {
    throw new Error(`HTTP embedding service returned invalid payload: ${JSON.stringify(payload)}`);
  }

  return payload.vectors.map((vector, index) => {
    if (!Array.isArray(vector)) {
      throw new Error(`HTTP embedding vector at index ${index} is not an array`);
    }
    const normalized = vector.map((value) => Number(value));
    if (normalized.length !== config.dimensions) {
      throw new Error(`HTTP embedding vector dimension mismatch: expected ${config.dimensions}, got ${normalized.length}`);
    }
    return normalized;
  });
}

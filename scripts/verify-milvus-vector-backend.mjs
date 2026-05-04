import net from "node:net";
import process from "node:process";
import {
  DataType,
  IndexType,
  MetricType,
  MilvusClient
} from "@zilliz/milvus2-sdk-node";
import {
  embedKnowledgePassages,
  embedKnowledgeQuery,
  getEmbeddingConfig
} from "../services/memory-service/dist/services/memory-service/src/embeddingProvider.js";

const address = process.env.MILVUS_ADDRESS || "127.0.0.1:19530";
const collectionName = process.env.MILVUS_VERIFY_COLLECTION || "super_agent_knowledge_sections_verify";
const embedding = getEmbeddingConfig();
const modelName = embedding.model;
const dimension = embedding.dimensions;

await assertReachable(address);

const queryVector = await embedKnowledgeQuery("query: memory retrieval validation");
const passageVectors = await embedKnowledgePassages([
  "passage: Milvus stores section embeddings for knowledge retrieval.",
  "passage: PostgreSQL stores documents, facts, and governance metadata."
]);

const client = new MilvusClient({
  address,
  username: process.env.MILVUS_USERNAME,
  password: process.env.MILVUS_PASSWORD,
  ssl: process.env.MILVUS_SSL === "1"
});

const exists = await client.hasCollection({
  collection_name: collectionName,
  timeout: 3000
});
if (exists.value) {
  await client.dropCollection({
    collection_name: collectionName,
    timeout: 5000
  });
}

await ensureOk(
  client.createCollection({
    collection_name: collectionName,
    fields: [
      {
        name: "id",
        data_type: DataType.VarChar,
        is_primary_key: true,
        max_length: 128
      },
      {
        name: "section_id",
        data_type: DataType.VarChar,
        max_length: 64
      },
      {
        name: "vector",
        data_type: DataType.FloatVector,
        dim: dimension
      }
    ]
  }),
  "createCollection"
);

await ensureOk(
  client.createIndex({
    collection_name: collectionName,
    field_name: "vector",
    index_name: "idx_vector_hnsw_cosine",
    index_type: IndexType.HNSW,
    metric_type: MetricType.COSINE,
    params: {
      M: 16,
      efConstruction: 128
    }
  }),
  "createIndex"
);

await ensureOk(
  client.loadCollectionSync({
    collection_name: collectionName,
    timeout: 5000
  }),
  "loadCollection"
);

await ensureOk(
  client.upsert({
    collection_name: collectionName,
    data: [
      {
        id: "verify-1",
        section_id: "verify-1",
        vector: passageVectors[0]
      },
      {
        id: "verify-2",
        section_id: "verify-2",
        vector: passageVectors[1]
      }
    ],
    timeout: 5000
  }).then((result) => result.status),
  "upsert"
);

await client.flushSync({
  collection_names: [collectionName],
  timeout: 5000
});

const search = await client.search({
  collection_name: collectionName,
  data: queryVector,
  anns_field: "vector",
  limit: 2,
  metric_type: MetricType.COSINE,
  params: {
    ef: 64
  },
  output_fields: ["section_id"],
  timeout: 5000
});

await ensureOk(Promise.resolve(search.status), "search");

process.stdout.write(JSON.stringify({
  ok: true,
  address,
  collection: collectionName,
  embedding_provider: embedding.provider,
  embedding_engine: embedding.engine,
  embedding_model: modelName,
  dimension,
  result_count: Array.isArray(search.results) ? search.results.length : 0,
  top_result: Array.isArray(search.results) ? search.results[0] : null
}, null, 2));
process.stdout.write("\n");

async function ensureOk(statusPromise, label) {
  const status = await statusPromise;
  const ok = status?.error_code === "Success" || status?.error_code === 0 || status?.error_code === "0";
  if (!ok) {
    throw new Error(`${label} failed: ${JSON.stringify(status)}`);
  }
}

async function assertReachable(rawAddress) {
  const parsed = parseAddress(rawAddress);
  await new Promise((resolve, reject) => {
    const socket = net.connect(parsed);
    const timeout = setTimeout(() => {
      socket.destroy();
      reject(new Error(`Milvus is not reachable at ${parsed.host}:${parsed.port}`));
    }, Number(process.env.MILVUS_CONNECT_TIMEOUT_MS || 1000));
    socket.once("connect", () => {
      clearTimeout(timeout);
      socket.end();
      resolve();
    });
    socket.once("error", (error) => {
      clearTimeout(timeout);
      reject(new Error(`Milvus is not reachable at ${parsed.host}:${parsed.port}: ${error.message}`));
    });
  });
}

function parseAddress(rawAddress) {
  if (/^https?:\/\//i.test(rawAddress)) {
    const url = new URL(rawAddress);
    return {
      host: url.hostname,
      port: Number(url.port || (url.protocol === "https:" ? 443 : 80))
    };
  }
  const [host, port] = rawAddress.split(":");
  return {
    host: host || "127.0.0.1",
    port: Number(port || 19530)
  };
}

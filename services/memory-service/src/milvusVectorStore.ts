import {
  DataType,
  IndexType,
  MetricType,
  MilvusClient
} from "@zilliz/milvus2-sdk-node";
import net from "node:net";
import { getEmbeddingConfig } from "./embeddingProvider.js";

export type MilvusSectionRecord = {
  tenantId: string;
  scope: string;
  sectionId: string;
  documentId: string;
  contentHash?: string | null;
  vector: number[];
};

export type MilvusSectionHit = {
  sectionId: string;
  score: number;
};

let clientPromise: Promise<MilvusClient> | null = null;
let collectionReadyPromise: Promise<void> | null = null;

function getMilvusAddress(): string {
  return process.env.MILVUS_ADDRESS || "127.0.0.1:19530";
}

function getCollectionName(): string {
  return process.env.MILVUS_KNOWLEDGE_COLLECTION || `super_agent_knowledge_sections_${embeddingCollectionSuffix()}`;
}

function statusOk(status: unknown): boolean {
  const normalized = status as { error_code?: string | number; reason?: string };
  return normalized.error_code === "Success" || normalized.error_code === 0 || normalized.error_code === "0";
}

async function getClient(): Promise<MilvusClient> {
  await assertMilvusTcpReachable();
  if (!clientPromise) {
    clientPromise = Promise.resolve(new MilvusClient({
      address: getMilvusAddress(),
      username: process.env.MILVUS_USERNAME,
      password: process.env.MILVUS_PASSWORD,
      ssl: process.env.MILVUS_SSL === "1"
    }));
  }
  return clientPromise;
}

async function assertMilvusTcpReachable(): Promise<void> {
  const address = getMilvusAddress();
  const parsed = parseMilvusAddress(address);
  await new Promise<void>((resolve, reject) => {
    const socket = net.connect({
      host: parsed.host,
      port: parsed.port
    });
    const timeout = setTimeout(() => {
      socket.destroy();
      reject(new Error(`Milvus is not reachable at ${parsed.host}:${parsed.port}`));
    }, Number(process.env.MILVUS_CONNECT_TIMEOUT_MS || 800));
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

function parseMilvusAddress(address: string): { host: string; port: number } {
  if (/^https?:\/\//i.test(address)) {
    const url = new URL(address);
    return {
      host: url.hostname,
      port: Number(url.port || (url.protocol === "https:" ? 443 : 80))
    };
  }
  const [host, port] = address.split(":");
  return {
    host: host || "127.0.0.1",
    port: Number(port || 19530)
  };
}

function quoteFilterValue(value: string): string {
  return `"${value.replace(/\\/g, "\\\\").replace(/"/g, "\\\"")}"`;
}

export function milvusVectorEngineName(): string {
  return `milvus:${getCollectionName()}:${getEmbeddingConfig().engine}`;
}

function embeddingCollectionSuffix(): string {
  const embedding = getEmbeddingConfig();
  return `${embedding.provider}_${embedding.model}_${embedding.dimensions}`
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

export async function ensureMilvusKnowledgeCollection(): Promise<void> {
  if (collectionReadyPromise) {
    return collectionReadyPromise;
  }

  collectionReadyPromise = (async () => {
    const client = await getClient();
    const collectionName = getCollectionName();
    const embedding = getEmbeddingConfig();
    const exists = await client.hasCollection({
      collection_name: collectionName,
      timeout: 3000
    });

    if (!exists.value) {
      const createStatus = await client.createCollection({
        collection_name: collectionName,
        fields: [
          {
            name: "id",
            data_type: DataType.VarChar,
            is_primary_key: true,
            max_length: 128
          },
          {
            name: "tenant_id",
            data_type: DataType.VarChar,
            max_length: 128
          },
          {
            name: "scope",
            data_type: DataType.VarChar,
            max_length: 128
          },
          {
            name: "section_id",
            data_type: DataType.VarChar,
            max_length: 64
          },
          {
            name: "document_id",
            data_type: DataType.VarChar,
            max_length: 64
          },
          {
            name: "content_hash",
            data_type: DataType.VarChar,
            max_length: 128
          },
          {
            name: "embedding_model",
            data_type: DataType.VarChar,
            max_length: 128
          },
          {
            name: "embedding_engine",
            data_type: DataType.VarChar,
            max_length: 160
          },
          {
            name: "vector",
            data_type: DataType.FloatVector,
            dim: embedding.dimensions
          }
        ]
      } as never);
      if (!statusOk(createStatus)) {
        throw new Error(`Milvus create collection failed: ${JSON.stringify(createStatus)}`);
      }

      const indexStatus = await client.createIndex({
        collection_name: collectionName,
        field_name: "vector",
        index_name: "idx_vector_hnsw_cosine",
        index_type: IndexType.HNSW,
        metric_type: MetricType.COSINE,
        params: {
          M: 16,
          efConstruction: 128
        }
      } as never);
      if (!statusOk(indexStatus)) {
        throw new Error(`Milvus create index failed: ${JSON.stringify(indexStatus)}`);
      }
    }

    const loadStatus = await client.loadCollectionSync({
      collection_name: collectionName,
      timeout: 5000
    });
    if (!statusOk(loadStatus)) {
      throw new Error(`Milvus load collection failed: ${JSON.stringify(loadStatus)}`);
    }
  })();

  return collectionReadyPromise;
}

export async function upsertMilvusSectionEmbeddings(records: MilvusSectionRecord[]): Promise<void> {
  if (records.length === 0) {
    return;
  }
  await ensureMilvusKnowledgeCollection();
  const client = await getClient();
  const embedding = getEmbeddingConfig();
  const response = await client.upsert({
    collection_name: getCollectionName(),
    data: records.map((record) => ({
      id: record.sectionId,
      tenant_id: record.tenantId,
      scope: record.scope,
      section_id: record.sectionId,
      document_id: record.documentId,
      content_hash: record.contentHash ?? "",
      embedding_model: embedding.model,
      embedding_engine: embedding.engine,
      vector: record.vector
    })),
    timeout: 10_000
  });
  if (!statusOk(response.status)) {
    throw new Error(`Milvus upsert failed: ${JSON.stringify(response.status)}`);
  }
  await client.flushSync({
    collection_names: [getCollectionName()],
    timeout: 10_000
  });
}

export async function searchMilvusSections(input: {
  tenantId: string;
  scope: string;
  queryVector: number[];
  limit: number;
}): Promise<MilvusSectionHit[]> {
  await ensureMilvusKnowledgeCollection();
  const client = await getClient();
  const embedding = getEmbeddingConfig();
  const response = await client.search({
    collection_name: getCollectionName(),
    data: input.queryVector,
    anns_field: "vector",
    limit: input.limit,
    metric_type: MetricType.COSINE,
    params: {
      ef: Math.max(64, input.limit * 8)
    },
    filter: [
      `tenant_id == ${quoteFilterValue(input.tenantId)}`,
      `scope == ${quoteFilterValue(input.scope)}`,
      `embedding_model == ${quoteFilterValue(embedding.model)}`
    ].join(" && "),
    output_fields: ["section_id"],
    timeout: 10_000
  } as never);

  if (!statusOk(response.status)) {
    throw new Error(`Milvus search failed: ${JSON.stringify(response.status)}`);
  }

  const results = Array.isArray(response.results) ? response.results : [];
  return results
    .map((item) => item as { section_id?: string; score?: number; distance?: number })
    .filter((item) => typeof item.section_id === "string")
    .map((item) => ({
      sectionId: item.section_id!,
      score: Number(item.score ?? item.distance ?? 0)
    }));
}

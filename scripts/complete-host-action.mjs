import process from "node:process";

const MEMORY_SERVICE_URL = process.env.MEMORY_SERVICE_URL || "http://127.0.0.1:3101";

async function main() {
  const [objectType, objectId, ...summaryParts] = process.argv.slice(2);
  const summary = summaryParts.join(" ");

  if (!objectType || !objectId) {
    console.error("用法: node complete-host-action.mjs <rule|skill> <objectId> [summary]");
    process.exit(1);
  }

  const body = { status: "done" };
  if (summary) body.summary = summary;

  const res = await fetch(`${MEMORY_SERVICE_URL}/internal/host-actions/${objectType}/${objectId}/status`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-tenant-id": "tenant-local",
      "x-scope": "memory.validation"
    },
    body: JSON.stringify(body)
  });

  if (!res.ok) {
    throw new Error(`complete host action failed: ${res.status} ${await res.text()}`);
  }

  console.log(`✅ 已将 ${objectType}/${objectId} 标记为 done`);
  if (summary) console.log(`📝 summary: ${summary}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

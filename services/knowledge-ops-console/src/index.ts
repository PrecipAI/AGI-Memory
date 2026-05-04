import { buildKnowledgeOpsConsoleApp } from "./app.js";

const port = Number(process.env.KNOWLEDGE_OPS_CONSOLE_PORT || 3210);
const host = process.env.KNOWLEDGE_OPS_CONSOLE_HOST || "127.0.0.1";
const app = buildKnowledgeOpsConsoleApp();

app
  .listen({ port, host })
  .then(() => {
    console.log(`knowledge-ops-console listening on http://${host}:${port}`);
  })
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });

import { buildTaskOrchestratorApp } from "./app.js";

const app = buildTaskOrchestratorApp();
const port = Number(process.env.PORT || 3001);
const host = process.env.HOST || "127.0.0.1";

app.listen({ port, host }).catch((error) => {
  console.error(error);
  process.exit(1);
});

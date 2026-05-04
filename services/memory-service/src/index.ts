import { buildMemoryServiceApp } from "./app.js";

const app = buildMemoryServiceApp();
const port = Number(process.env.PORT || 3101);
const host = process.env.HOST || "127.0.0.1";

app.listen({ port, host }).catch((error) => {
  console.error(error);
  process.exit(1);
});

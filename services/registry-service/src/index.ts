import { buildRegistryServiceApp } from "./app.js";

const app = buildRegistryServiceApp();
const port = Number(process.env.PORT || 3002);
const host = process.env.HOST || "127.0.0.1";

app.listen({ port, host }).catch((error) => {
  console.error(error);
  process.exit(1);
});

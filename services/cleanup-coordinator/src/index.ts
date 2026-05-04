import { buildCleanupCoordinatorApp } from "./app.js";

const app = buildCleanupCoordinatorApp();
const port = Number(process.env.PORT || 3005);
const host = process.env.HOST || "127.0.0.1";

app.listen({ port, host }).catch((error) => {
  console.error(error);
  process.exit(1);
});

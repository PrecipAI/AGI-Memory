import { buildDlqReplayControllerApp } from "./app.js";

const app = buildDlqReplayControllerApp();
const port = Number(process.env.PORT || 3007);
const host = process.env.HOST || "127.0.0.1";

app.listen({ port, host }).catch((error) => {
  console.error(error);
  process.exit(1);
});

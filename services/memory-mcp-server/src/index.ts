#!/usr/bin/env node

import { runCli } from "./cli.js";

void (async () => {
  const exitCode = await runCli(["start"]);
  process.exit(exitCode);
})();

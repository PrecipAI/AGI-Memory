import path from "node:path";
import { rm } from "node:fs/promises";

const targetArg = process.argv[2];

if (!targetArg) {
  process.stderr.write("Usage: node ./scripts/clean-dist.mjs <path>\n");
  process.exit(1);
}

const targetPath = path.resolve(process.cwd(), targetArg);

for (let attempt = 1; attempt <= 5; attempt += 1) {
  try {
    await rm(targetPath, {
      recursive: true,
      force: true,
      maxRetries: 10,
      retryDelay: 100
    });
    process.exit(0);
  } catch (error) {
    if (attempt === 5) {
      throw error;
    }
    await new Promise((resolve) => {
      setTimeout(resolve, attempt * 200);
    });
  }
}

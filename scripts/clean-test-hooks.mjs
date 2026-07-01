import { readdir, unlink } from "node:fs/promises";
import path from "node:path";

const gatesDir = path.join(process.cwd(), ".trae", "gates");
const files = await readdir(gatesDir);
let count = 0;
for (const file of files) {
  if (file.startsWith("host-rule-") && file.endsWith(".hook.ts")) {
    await unlink(path.join(gatesDir, file));
    count++;
  }
}
console.log(`deleted ${count} test hook files`);

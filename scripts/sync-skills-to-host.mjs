import { readdir, stat, mkdir, copyFile } from "node:fs/promises";
import path from "node:path";
import os from "node:os";

const sourceDir = path.join(process.cwd(), "skills");
const targetDir = path.join(os.homedir(), ".trae-cn", "skills");

async function syncSkill(skillDir) {
  const skillKey = path.basename(skillDir);
  const sourceFile = path.join(skillDir, "SKILL.md");
  const targetSkillDir = path.join(targetDir, skillKey);
  const targetFile = path.join(targetSkillDir, "SKILL.md");

  const s = await stat(sourceFile).catch(() => null);
  if (!s) {
    console.log(`skip: ${skillKey} (no SKILL.md)`);
    return false;
  }

  await mkdir(targetSkillDir, { recursive: true });
  await copyFile(sourceFile, targetFile);
  console.log(`synced: ${skillKey} → ${targetFile}`);
  return true;
}

async function main() {
  const entries = await readdir(sourceDir);
  let count = 0;
  for (const entry of entries) {
    const fullPath = path.join(sourceDir, entry);
    const s = await stat(fullPath);
    if (s.isDirectory()) {
      const ok = await syncSkill(fullPath);
      if (ok) count++;
    }
  }
  console.log(`\ntotal synced: ${count}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

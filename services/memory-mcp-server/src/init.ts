import path from "node:path";
import {
  buildClientTemplateFiles,
  buildInitReadme,
  defaultMemoryMcpConfig,
  ensureDir,
  pathExists,
  resolveConfigPath,
  writeJsonFile,
  writeTextFile
} from "./config.js";

export type InitFileResult = {
  status: "CREATE" | "SKIP" | "OVERWRITE";
  path: string;
};

export type InitializeMemoryMcpOptions = {
  cwd: string;
  configPathInput?: string;
  force: boolean;
};

export type InitializeMemoryMcpResult = {
  status: "INITIALIZED";
  configDir: string;
  configPath: string;
  files: InitFileResult[];
};

export async function initializeMemoryMcp(options: InitializeMemoryMcpOptions): Promise<InitializeMemoryMcpResult> {
  const configPath = resolveConfigPath(options.cwd, options.configPathInput);
  const configDir = path.dirname(configPath);
  const clientDir = path.join(configDir, "clients");
  const relativeConfigPath = path.relative(options.cwd, configPath) || path.basename(configPath);
  const results: InitFileResult[] = [];

  await ensureDir(clientDir);

  await writeManagedJsonFile({
    filePath: configPath,
    payload: defaultMemoryMcpConfig,
    force: options.force,
    results
  });

  for (const template of buildClientTemplateFiles(configPath)) {
    if (template.kind === "json") {
      await writeManagedJsonFile({
        filePath: path.join(clientDir, template.fileName),
        payload: template.payload,
        force: options.force,
        results
      });
    } else {
      await writeManagedTextFile({
        filePath: path.join(clientDir, template.fileName),
        payload: String(template.payload),
        force: options.force,
        results
      });
    }
  }

  await writeManagedTextFile({
    filePath: path.join(configDir, "README.md"),
    payload: buildInitReadme(relativeConfigPath),
    force: options.force,
    results
  });

  return {
    status: "INITIALIZED",
    configDir,
    configPath,
    files: results
  };
}

async function writeManagedJsonFile(options: {
  filePath: string;
  payload: unknown;
  force: boolean;
  results: InitFileResult[];
}) {
  const exists = await pathExists(options.filePath);
  if (exists && !options.force) {
    options.results.push({
      status: "SKIP",
      path: options.filePath
    });
    return;
  }

  await writeJsonFile(options.filePath, options.payload);
  options.results.push({
    status: exists ? "OVERWRITE" : "CREATE",
    path: options.filePath
  });
}

async function writeManagedTextFile(options: {
  filePath: string;
  payload: string;
  force: boolean;
  results: InitFileResult[];
}) {
  const exists = await pathExists(options.filePath);
  if (exists && !options.force) {
    options.results.push({
      status: "SKIP",
      path: options.filePath
    });
    return;
  }

  await writeTextFile(options.filePath, options.payload);
  options.results.push({
    status: exists ? "OVERWRITE" : "CREATE",
    path: options.filePath
  });
}

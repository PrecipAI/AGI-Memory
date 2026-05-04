import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export type MarkdownConversionInput = {
  sourceType: "markitdown_file" | "markitdown_url";
  filePath?: string;
  sourceUri?: string;
  timeoutMs?: number;
};

export type MarkdownConversionResult = {
  content: string;
  converter: string;
};

export async function convertWithMarkItDown(input: MarkdownConversionInput): Promise<MarkdownConversionResult> {
  const target = input.sourceType === "markitdown_file" ? input.filePath : input.sourceUri;
  if (!target) {
    throw new Error(`${input.sourceType === "markitdown_file" ? "file_path" : "source_uri"} is required when source_type=${input.sourceType}`);
  }

  const command = process.env.MARKITDOWN_BIN || "markitdown";
  try {
    const result = await execFileAsync(command, [target], {
      encoding: "utf8",
      maxBuffer: 16 * 1024 * 1024,
      timeout: input.timeoutMs ?? 60_000,
      windowsHide: true
    });
    const content = result.stdout.trim();
    if (!content) {
      throw new Error(`MarkItDown returned empty markdown for ${target}`);
    }
    return {
      content,
      converter: "markitdown-v0.1.5"
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`MarkItDown conversion failed for ${target}: ${message}`);
  }
}

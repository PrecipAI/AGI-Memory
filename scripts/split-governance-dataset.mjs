import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const sourcePath = process.argv[2];
if (!sourcePath) {
  throw new Error("Usage: node ./scripts/split-governance-dataset.mjs <dataset-with-expected.json>");
}

const absoluteSourcePath = path.resolve(sourcePath);
const dataset = JSON.parse(fs.readFileSync(absoluteSourcePath, "utf8"));
assert.ok(Array.isArray(dataset.cases), "dataset.cases must be an array");
for (const testCase of dataset.cases) {
  assert.ok(testCase.id, "case.id is required");
  assert.ok(testCase.input, `case ${testCase.id} must include input`);
  assert.ok(testCase.expected, `case ${testCase.id} must include expected`);
}

const dir = path.dirname(absoluteSourcePath);
const basename = path.basename(absoluteSourcePath, ".json");
const inputOnlyPath = path.join(dir, `${basename}.inputs.json`);
const answerKeyPath = path.join(dir, `${basename}.answer-key.json`);

const inputOnly = {
  version: `${dataset.version ?? basename}.inputs`,
  source_dataset: absoluteSourcePath,
  description: `${dataset.description ?? "Governance dataset"} Input-only split for hidden expected evaluation.`,
  cases: dataset.cases.map((testCase) => ({
    id: testCase.id,
    category: testCase.category,
    input: testCase.input
  }))
};

const answerKey = {
  version: `${dataset.version ?? basename}.answer-key`,
  source_dataset: absoluteSourcePath,
  description: `${dataset.description ?? "Governance dataset"} Hidden answer key.`,
  cases: dataset.cases.map((testCase) => ({
    id: testCase.id,
    category: testCase.category,
    expected: testCase.expected
  }))
};

fs.writeFileSync(inputOnlyPath, `${JSON.stringify(inputOnly, null, 2)}\n`, "utf8");
fs.writeFileSync(answerKeyPath, `${JSON.stringify(answerKey, null, 2)}\n`, "utf8");

process.stdout.write(`${JSON.stringify({ input_only: inputOnlyPath, answer_key: answerKeyPath, total: dataset.cases.length }, null, 2)}\n`);

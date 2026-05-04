import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

const rootDir = process.cwd();
const casesPath =
  process.argv[2] ??
  path.join(rootDir, "tests", "knowledge-benchmark", "benchmark-cases.v1.json");
const reportPath =
  process.argv[3] ??
  path.join(rootDir, "tests", "knowledge-benchmark", "reports", "memory-baseline-report.json");

const memoryServiceUrl = process.env.MEMORY_SERVICE_URL ?? "http://127.0.0.1:3101";
const tenantId = process.env.DEFAULT_TENANT_ID ?? "tenant-local";
const scope = process.env.DEFAULT_SCOPE ?? "memory.validation";

const cases = JSON.parse(await readFile(casesPath, "utf8"));
const results = [];
const contractChecks = [];

contractChecks.push(await runMissingFingerprintStatusCheck());
contractChecks.push(await runMissingFingerprintCheck());

for (const testCase of cases) {
  const startedAt = process.hrtime.bigint();
  const response = await fetch(new URL("/internal/memory/retrieve", memoryServiceUrl), {
    method: "POST",
    headers: buildHeaders(`bench-${testCase.id}`),
    body: JSON.stringify({
      task_request_id: "00000000-0000-4000-8000-000000009999",
      query: testCase.query,
      runtime_summary: {
        query: testCase.query,
        scene: testCase.scene
      },
      fingerprint: testCase.fingerprint,
      fingerprint_status: testCase.fingerprint_status,
      include_factual: testCase.include_factual,
      include_procedural: testCase.include_procedural,
      limit: 10
    })
  });
  const endedAt = process.hrtime.bigint();
  const latencyMs = Number(endedAt - startedAt) / 1_000_000;
  const payload = await response.json();

  const bucketItems = Array.isArray(payload[testCase.expected_bucket]) ? payload[testCase.expected_bucket] : [];
  const titles = bucketItems.map((item) => String(item.title ?? item.skill_key ?? item.id ?? ""));

  const hitIndex = findFirstHitIndex(titles, testCase.expected_titles);
  const hitAt1 = hitIndex === 0;
  const hitAt3 = hitIndex >= 0 && hitIndex < 3;
  const hitAt5 = hitIndex >= 0 && hitIndex < 5;
  const mrr = hitIndex >= 0 ? 1 / (hitIndex + 1) : 0;
  const mustHavePassed = containsMustHaveTerms(bucketItems, testCase.must_have_terms ?? []);

  results.push({
    id: testCase.id,
    scene: testCase.scene,
    query: testCase.query,
    expected_bucket: testCase.expected_bucket,
    expected_titles: testCase.expected_titles,
    returned_titles: titles,
    hit_index: hitIndex,
    hit_at_1: hitAt1,
    hit_at_3: hitAt3,
    hit_at_5: hitAt5,
    mrr,
    must_have_passed: mustHavePassed,
    latency_ms: Number(latencyMs.toFixed(3)),
    gates: payload.gates ?? null
  });
}

const latencies = results.map((item) => item.latency_ms).sort((a, b) => a - b);
const summary = {
  total_cases: results.length,
  hit_at_1: ratio(results.filter((item) => item.hit_at_1).length, results.length),
  hit_at_3: ratio(results.filter((item) => item.hit_at_3).length, results.length),
  hit_at_5: ratio(results.filter((item) => item.hit_at_5).length, results.length),
  avg_mrr: average(results.map((item) => item.mrr)),
  must_have_pass_rate: ratio(results.filter((item) => item.must_have_passed).length, results.length),
  p50_latency_ms: percentile(latencies, 0.5),
  p95_latency_ms: percentile(latencies, 0.95)
};

const report = {
  benchmark_name: "current-memory-baseline",
  memory_service_url: memoryServiceUrl,
  tenant_id: tenantId,
  scope,
  generated_at: new Date().toISOString(),
  contract_checks: contractChecks,
  summary,
  results
};

await mkdir(path.dirname(reportPath), { recursive: true });
await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);

function buildHeaders(label) {
  return {
    "content-type": "application/json",
    "x-tenant-id": tenantId,
    "x-scope": scope,
    "x-trace-id": `trace-${label}-${Date.now()}`,
    "idempotency-key": `bench:${label}:${Date.now()}`
  };
}

async function runMissingFingerprintStatusCheck() {
  const response = await fetch(new URL("/internal/memory/retrieve", memoryServiceUrl), {
    method: "POST",
    headers: buildHeaders("missing-status"),
    body: JSON.stringify({
      task_request_id: "00000000-0000-4000-8000-000000009998",
      query: "contract probe missing fingerprint status",
      include_factual: true,
      include_procedural: true,
      fingerprint: "local-dev-v1"
    })
  });
  const payload = await response.json();
  return {
    id: "missing_fingerprint_status",
    ok: response.status === 400 && payload.error_code === "FINGERPRINT_STATUS_REQUIRED",
    status: response.status,
    error_code: payload.error_code ?? null
  };
}

async function runMissingFingerprintCheck() {
  const response = await fetch(new URL("/internal/memory/retrieve", memoryServiceUrl), {
    method: "POST",
    headers: buildHeaders("missing-fingerprint"),
    body: JSON.stringify({
      task_request_id: "00000000-0000-4000-8000-000000009997",
      query: "contract probe missing fingerprint",
      include_factual: true,
      include_procedural: true,
      fingerprint_status: "matched"
    })
  });
  const payload = await response.json();
  return {
    id: "missing_fingerprint",
    ok: response.status === 400 && payload.error_code === "FINGERPRINT_REQUIRED",
    status: response.status,
    error_code: payload.error_code ?? null
  };
}

function findFirstHitIndex(returnedTitles, expectedTitles) {
  for (let index = 0; index < returnedTitles.length; index += 1) {
    if (expectedTitles.includes(returnedTitles[index])) {
      return index;
    }
  }
  return -1;
}

function containsMustHaveTerms(items, terms) {
  if (terms.length === 0) {
    return true;
  }
  const haystack = JSON.stringify(items).toLowerCase();
  return terms.every((term) => haystack.includes(String(term).toLowerCase()));
}

function ratio(numerator, denominator) {
  if (denominator === 0) {
    return 0;
  }
  return Number((numerator / denominator).toFixed(4));
}

function average(values) {
  if (values.length === 0) {
    return 0;
  }
  const sum = values.reduce((acc, value) => acc + value, 0);
  return Number((sum / values.length).toFixed(4));
}

function percentile(sortedValues, p) {
  if (sortedValues.length === 0) {
    return 0;
  }
  const index = Math.min(sortedValues.length - 1, Math.max(0, Math.ceil(sortedValues.length * p) - 1));
  return Number(sortedValues[index].toFixed(3));
}

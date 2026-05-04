import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import pg from "pg";
import YAML from "yaml";
import { buildMemoryServiceApp } from "../services/memory-service/dist/services/memory-service/src/app.js";
import { buildTaskOrchestratorApp } from "../services/task-orchestrator/dist/services/task-orchestrator/src/app.js";
import { buildVerificationServiceApp } from "../services/verification-service/dist/services/verification-service/src/app.js";

const { Pool } = pg;

const rootDir = process.cwd();
const scenarioPath = path.join(rootDir, "tests", "integration", "minimal-golden-path.v1.yaml");
const defaultDbUrl =
  process.env.DB_URL ||
  `postgresql://${encodeURIComponent(process.env.PGUSER || "postgres")}${
    process.env.PGPASSWORD ? `:${encodeURIComponent(process.env.PGPASSWORD)}` : ""
  }@${process.env.PGHOST || "127.0.0.1"}:${process.env.PGPORT || "55432"}/${process.env.PGDATABASE || "super_agent_system"}`;

function getPathValue(target, pathExpression) {
  if (pathExpression === "row") {
    return target.row;
  }

  const segments = pathExpression.split(".");
  let current = target;
  for (const segment of segments) {
    if (segment === "length") {
      current = Array.isArray(current) || typeof current === "string" ? current.length : undefined;
      continue;
    }
    if (current == null) {
      return undefined;
    }
    current = current[segment];
  }
  return current;
}

function interpolate(value, variables) {
  if (typeof value === "string") {
    const matches = [...value.matchAll(/\{\{([^}]+)\}\}/g)];
    if (matches.length === 1 && matches[0][0] === value) {
      return variables[matches[0][1].trim()];
    }
    return matches.reduce((output, match) => {
      const key = match[1].trim();
      return output.replace(match[0], String(variables[key] ?? ""));
    }, value);
  }

  if (Array.isArray(value)) {
    return value.map((item) => interpolate(item, variables));
  }

  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, interpolate(item, variables)]));
  }

  return value;
}

function buildHeaders(variables, stepId) {
  return {
    "X-Tenant-Id": variables.tenant_id,
    "X-Scope": variables.scope,
    "X-Trace-Id": `${variables.trace_prefix}-${stepId}-${Date.now()}`,
    "Idempotency-Key": `idem-${stepId}-${Date.now()}`
  };
}

function getHttpApp(endpoint, apps) {
  if (endpoint.startsWith("/internal/planner") || endpoint.startsWith("/internal/resolver") || endpoint.startsWith("/internal/router")) {
    return apps.taskOrchestrator;
  }
  if (endpoint.startsWith("/internal/verifier")) {
    return apps.verificationService;
  }
  if (endpoint.startsWith("/internal/memory")) {
    return apps.memoryService;
  }
  throw new Error(`Unsupported endpoint in P1 runner: ${endpoint}`);
}

async function runSeedStep() {
  await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [path.join(rootDir, "scripts", "seed-dev.mjs")], {
      cwd: rootDir,
      env: process.env,
      stdio: "inherit"
    });
    child.on("exit", (code) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(`seed-dev.mjs exited with code ${code}`));
    });
    child.on("error", reject);
  });
}

async function fetchOne(pool, step, variables) {
  const table = step.table;
  const select = Array.isArray(step.select) && step.select.length > 0 ? step.select.join(", ") : "*";
  const whereEntries = Object.entries(interpolate(step.where ?? {}, variables));
  const whereClause =
    whereEntries.length === 0
      ? ""
      : ` WHERE ${whereEntries.map(([key], index) => `${key} = $${index + 1}`).join(" AND ")}`;
  const values = whereEntries.map(([, value]) => value);
  const sql = `SELECT ${select} FROM ${table}${whereClause} LIMIT 1`;
  const result = await pool.query(sql, values);
  assert.equal(result.rows.length, 1, `expected exactly one row from ${table}`);
  return result.rows[0];
}

async function assertTableExists(pool, tableName) {
  const result = await pool.query(
    `
      SELECT 1
      FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name = $1
    `,
    [tableName]
  );
  assert.equal(result.rowCount, 1, `expected table ${tableName} to exist`);
}

async function assertCount(pool, mode, config, variables) {
  const resolvedWhere = interpolate(config.where ?? {}, variables);
  const entries = Object.entries(resolvedWhere);
  const whereClause =
    entries.length === 0 ? "" : ` WHERE ${entries.map(([key], index) => `${key} = $${index + 1}`).join(" AND ")}`;
  const values = entries.map(([, value]) => value);
  const sql = `SELECT COUNT(*)::int AS count FROM ${config.table}${whereClause}`;
  const result = await pool.query(sql, values);
  const count = result.rows[0].count;

  if (mode === "count_eq") {
    assert.equal(count, config.value, `expected ${config.table} count to equal ${config.value}, got ${count}`);
  } else if (mode === "count_gt") {
    assert.ok(count > config.value, `expected ${config.table} count > ${config.value}, got ${count}`);
  } else if (mode === "count_gte") {
    assert.ok(count >= config.value, `expected ${config.table} count >= ${config.value}, got ${count}`);
  }
}

async function assertOneToOne(pool, config, variables) {
  const leftValue = interpolate(config.left_value, variables);
  const sql = `
    SELECT COUNT(*)::int AS count
    FROM ${config.right_table}
    WHERE ${config.right_key} = $1
  `;
  const result = await pool.query(sql, [leftValue]);
  assert.equal(result.rows[0].count, 1, `expected one-to-one projection into ${config.right_table}`);
}

async function runDbAssertions(pool, assertions, variables) {
  for (const assertion of assertions ?? []) {
    if ("table_exists" in assertion) {
      await assertTableExists(pool, assertion.table_exists);
      continue;
    }
    if ("count_eq" in assertion) {
      await assertCount(pool, "count_eq", assertion.count_eq, variables);
      continue;
    }
    if ("count_gt" in assertion) {
      await assertCount(pool, "count_gt", assertion.count_gt, variables);
      continue;
    }
    if ("count_gte" in assertion) {
      await assertCount(pool, "count_gte", assertion.count_gte, variables);
      continue;
    }
    if ("one_to_one" in assertion) {
      await assertOneToOne(pool, assertion.one_to_one, variables);
      continue;
    }
    throw new Error(`Unsupported db assertion: ${JSON.stringify(assertion)}`);
  }
}

function assertResponseAssertions(result, assertions) {
  for (const assertion of assertions ?? []) {
    if ("status" in assertion) {
      assert.equal(result.status, assertion.status, `expected status ${assertion.status}, got ${result.status}`);
      continue;
    }
    if ("exists" in assertion) {
      const value = getPathValue(result, assertion.exists);
      assert.notEqual(value, undefined, `expected ${assertion.exists} to exist`);
      assert.notEqual(value, null, `expected ${assertion.exists} to be non-null`);
      continue;
    }
    if ("eq" in assertion) {
      const actual = getPathValue(result, assertion.eq.path);
      assert.deepEqual(actual, assertion.eq.value, `expected ${assertion.eq.path} to equal ${JSON.stringify(assertion.eq.value)}`);
      continue;
    }
    if ("length_eq" in assertion) {
      const actual = getPathValue(result, assertion.length_eq.path);
      assert.ok(Array.isArray(actual) || typeof actual === "string", `${assertion.length_eq.path} is not countable`);
      assert.equal(actual.length, assertion.length_eq.value, `expected ${assertion.length_eq.path}.length to equal ${assertion.length_eq.value}`);
      continue;
    }
    if ("length_gte" in assertion) {
      const actual = getPathValue(result, assertion.length_gte.path);
      assert.ok(Array.isArray(actual) || typeof actual === "string", `${assertion.length_gte.path} is not countable`);
      assert.ok(actual.length >= assertion.length_gte.value, `expected ${assertion.length_gte.path}.length >= ${assertion.length_gte.value}`);
      continue;
    }
    throw new Error(`Unsupported response assertion: ${JSON.stringify(assertion)}`);
  }
}

async function executeScenario() {
  const scenario = YAML.parse(await readFile(scenarioPath, "utf8"));
  const pool = new Pool({ connectionString: defaultDbUrl });
  const apps = {
    taskOrchestrator: buildTaskOrchestratorApp(),
    verificationService: buildVerificationServiceApp(),
    memoryService: buildMemoryServiceApp()
  };

  const variables = {
    ...scenario.context,
    task_request_id: randomUUID()
  };
  const stepResults = [];

  try {
    for (const step of scenario.steps) {
      const startedAt = Date.now();
      let result = { status: "pending" };

      if (step.action === "db.seed") {
        await runSeedStep();
        await runDbAssertions(pool, step.assertions, variables);
        result = { status: "passed" };
      } else if (step.action === "db.fetch_one") {
        const row = await fetchOne(pool, step, variables);
        result = { status: "passed", row };
      } else if (step.action === "db.assert") {
        await runDbAssertions(pool, step.assertions, variables);
        result = { status: "passed" };
      } else if (step.action === "http.post") {
        const app = getHttpApp(step.endpoint, apps);
        const payload = interpolate(step.body ?? {}, variables);
        const response = await app.inject({
          method: "POST",
          url: step.endpoint,
          headers: buildHeaders(variables, step.id),
          payload
        });
        const body = response.body ? response.json() : null;
        result = {
          status: "passed",
          endpoint: step.endpoint,
          response: {
            statusCode: response.statusCode,
            body
          }
        };
        assertResponseAssertions(
          {
            status: response.statusCode,
            body
          },
          step.assertions
        );
      } else if (step.action === "report.write") {
        result = { status: "passed" };
      } else {
        throw new Error(`Unsupported step action: ${step.action}`);
      }

      if (step.save) {
        for (const [key, sourcePath] of Object.entries(step.save)) {
          variables[key] = getPathValue(
            {
              row: result.row,
              status: result.response?.statusCode,
              body: result.response?.body
            },
            sourcePath
          );
        }
      }

      stepResults.push({
        id: step.id,
        action: step.action,
        ok: true,
        duration_ms: Date.now() - startedAt,
        status_code: result.response?.statusCode ?? null
      });
    }

    const baselines = Object.fromEntries(
      Object.entries(scenario.gate.baselines).map(([baselineName, stepId]) => [
        baselineName,
        stepResults.some((step) => step.id === stepId && step.ok)
      ])
    );
    const gatePassed = Object.values(baselines).every(Boolean);
    const report = {
      scenario: scenario.name,
      mode: scenario.mode,
      generated_at: new Date().toISOString(),
      gate_status: gatePassed ? "PASS" : "FAIL",
      tenant_id: variables.tenant_id,
      scope: variables.scope,
      task_request_id: variables.task_request_id,
      baselines,
      steps: stepResults
    };

    const reportPath = path.join(rootDir, scenario.gate.report_path);
    await mkdir(path.dirname(reportPath), { recursive: true });
    await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
    console.log(JSON.stringify(report, null, 2));
  } catch (error) {
    const failedReport = {
      scenario: scenario.name,
      mode: scenario.mode,
      generated_at: new Date().toISOString(),
      gate_status: "FAIL",
      tenant_id: variables.tenant_id,
      scope: variables.scope,
      task_request_id: variables.task_request_id,
      failure: {
        message: error instanceof Error ? error.message : String(error)
      },
      steps: stepResults
    };
    const reportPath = path.join(rootDir, scenario.gate.report_path);
    await mkdir(path.dirname(reportPath), { recursive: true });
    await writeFile(reportPath, `${JSON.stringify(failedReport, null, 2)}\n`, "utf8");
    throw error;
  } finally {
    await Promise.all([apps.taskOrchestrator.close(), apps.verificationService.close(), apps.memoryService.close(), pool.end()]);
  }
}

await executeScenario();

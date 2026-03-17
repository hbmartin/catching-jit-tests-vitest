import { execSync } from "node:child_process";
import { mkdirSync, unlinkSync, writeFileSync } from "node:fs";
import path from "node:path";

import type { GeneratedTest } from "../generation/types.js";
import { chunk } from "../utils/concurrency.js";
import { logger } from "../utils/logger.js";

import { parseVitestJsonOutput } from "./result-parser.js";
import type { DualExecutionResult, TestResult } from "./types.js";

function writeTestFile(projectDir: string, test: GeneratedTest): string {
  const fullPath = path.join(projectDir, test.testFilePath);
  const dir = path.dirname(fullPath);
  mkdirSync(dir, { recursive: true });
  writeFileSync(fullPath, test.code, "utf-8");
  return fullPath;
}

function removeTestFile(projectDir: string, test: GeneratedTest): void {
  const fullPath = path.join(projectDir, test.testFilePath);
  try {
    unlinkSync(fullPath);
  } catch {
    // File might not exist
  }
}

function runVitest(
  projectDir: string,
  testFiles: readonly GeneratedTest[],
  timeout: number,
): TestResult[] {
  const writtenPaths: string[] = [];

  for (const test of testFiles) {
    writtenPaths.push(writeTestFile(projectDir, test));
  }

  try {
    const testPaths = testFiles.map((f) => f.testFilePath).join(" ");
    const result = execSync(
      `npx vitest run --reporter=json --no-color ${testPaths}`,
      {
        cwd: projectDir,
        timeout,
        encoding: "utf-8",
        maxBuffer: 10 * 1024 * 1024,
        env: {
          ...process.env,
          VITEST_CACHE: "false",
          VITEST_MAX_THREADS: "1",
        },
      },
    );

    return parseVitestJsonOutput(result);
  } catch (err: unknown) {
    if (
      err &&
      typeof err === "object" &&
      "stdout" in err &&
      typeof err.stdout === "string" &&
      err.stdout.length > 0
    ) {
      try {
        return parseVitestJsonOutput(err.stdout);
      } catch {
        logger.error("Failed to parse Vitest output from error");
      }
    }

    logger.error("Vitest execution failed");
    return testFiles.map((test) => ({
      testFile: test.testFilePath,
      testName: test.behaviorDescription,
      status: "failed" as const,
      failureMessage: "Vitest execution failed",
      duration: 0,
      failureAnalysis: null,
    }));
  } finally {
    for (const test of testFiles) {
      removeTestFile(projectDir, test);
    }
  }
}

function buildDefaultOutcome(test: GeneratedTest): TestResult {
  return {
    testFile: test.testFilePath,
    testName: test.behaviorDescription,
    status: "failed" as const,
    failureMessage: "No result from execution",
    duration: 0,
    failureAnalysis: null,
  };
}

function dualExecution(
  tests: readonly GeneratedTest[],
  parentDir: string,
  childDir: string,
  batchSize: number,
  testTimeout: number,
): Promise<DualExecutionResult[]> {
  const results: DualExecutionResult[] = [];
  const batches = chunk(tests, batchSize);

  for (const batch of batches) {
    logger.info(`Running batch of ${String(batch.length)} tests`);

    const parentResults = runVitest(parentDir, batch, testTimeout);
    const childResults = runVitest(childDir, batch, testTimeout);

    const batchResults = batch
      .filter((test): test is GeneratedTest => Boolean(test))
      .map((currentTest, i) => ({
        test: currentTest,
        parentOutcome: parentResults[i] ?? buildDefaultOutcome(currentTest),
        childOutcome: childResults[i] ?? buildDefaultOutcome(currentTest),
      }));

    results.push(...batchResults);
  }

  return Promise.resolve(results);
}

export { dualExecution, runVitest };

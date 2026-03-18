import { mkdir, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import type { GeneratedTest } from "../generation/types.js";
import {
  dualExecutionResultSchema,
  testResultSchema,
} from "../runtime-schemas.js";
import { chunk } from "../utils/concurrency.js";
import { logger } from "../utils/logger.js";
import { CommandError, runCommand } from "../utils/process.js";

import { parseVitestJsonOutput } from "./result-parser.js";
import type { DualExecutionResult, TestResult } from "./types.js";

interface VitestRunResult {
  readonly results: readonly TestResult[];
  readonly executionLog: string;
}

async function writeTestFile(
  projectDir: string,
  test: GeneratedTest,
): Promise<string> {
  const fullPath = path.join(projectDir, test.testFilePath);
  const dir = path.dirname(fullPath);
  await mkdir(dir, { recursive: true });
  await writeFile(fullPath, test.code, "utf-8");
  return fullPath;
}

async function removeTestFile(
  projectDir: string,
  test: GeneratedTest,
): Promise<void> {
  const fullPath = path.join(projectDir, test.testFilePath);
  try {
    await unlink(fullPath);
  } catch {
    // File might not exist
  }
}

async function runVitest(
  projectDir: string,
  testFiles: readonly GeneratedTest[],
  timeout: number,
): Promise<VitestRunResult> {
  try {
    await Promise.all(testFiles.map((test) => writeTestFile(projectDir, test)));

    const result = await runCommand(
      "npx",
      [
        "vitest",
        "run",
        "--reporter=json",
        "--no-color",
        ...testFiles.map((file) => file.testFilePath),
      ],
      {
        cwd: projectDir,
        timeout,
        maxBuffer: 10 * 1024 * 1024,
        env: {
          ...process.env,
          VITEST_CACHE: "false",
          VITEST_MAX_THREADS: "1",
        },
      },
    );

    return {
      results: parseVitestJsonOutput(result.stdout),
      executionLog: [result.stdout, result.stderr].filter(Boolean).join("\n"),
    };
  } catch (err: unknown) {
    if (err instanceof CommandError && err.stdout.length > 0) {
      try {
        return {
          results: parseVitestJsonOutput(err.stdout),
          executionLog: [err.stdout, err.stderr].filter(Boolean).join("\n"),
        };
      } catch {
        logger.error("Failed to parse Vitest output from error");
      }
    }

    logger.error("Vitest execution failed");
    let errorLog: string;
    if (err instanceof CommandError) {
      errorLog = [err.stdout, err.stderr].filter(Boolean).join("\n");
    } else if (err instanceof Error) {
      errorLog = err.message;
    } else {
      errorLog = String(err);
    }
    return {
      results: testFiles.map((test) =>
        testResultSchema.parse({
          testFile: test.testFilePath,
          testName: test.behaviorDescription,
          status: "failed" as const,
          failureMessage: "Vitest execution failed",
          duration: 0,
          failureAnalysis: null,
        }),
      ),
      executionLog: errorLog,
    };
  } finally {
    await Promise.all(
      testFiles.map((test) => removeTestFile(projectDir, test)),
    );
  }
}

function buildDefaultOutcome(test: GeneratedTest): TestResult {
  return testResultSchema.parse({
    testFile: test.testFilePath,
    testName: test.behaviorDescription,
    status: "failed" as const,
    failureMessage: "No result from execution",
    duration: 0,
    failureAnalysis: null,
  });
}

async function dualExecution(
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

    const [parentResults, childResults] = await Promise.all([
      runVitest(parentDir, batch, testTimeout),
      runVitest(childDir, batch, testTimeout),
    ]);

    const batchResults = batch
      .filter((test): test is GeneratedTest => Boolean(test))
      .map((currentTest, i) =>
        dualExecutionResultSchema.parse({
          test: currentTest,
          parentOutcome:
            parentResults.results[i] ?? buildDefaultOutcome(currentTest),
          childOutcome:
            childResults.results[i] ?? buildDefaultOutcome(currentTest),
          parentExecutionLog: parentResults.executionLog,
          childExecutionLog: childResults.executionLog,
        }),
      );

    results.push(...batchResults);
  }

  return results;
}

export { dualExecution, runVitest };

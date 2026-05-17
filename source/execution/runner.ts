import { mkdir, readFile, unlink, writeFile } from "node:fs/promises";
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
  readonly results: ReadonlyMap<string, TestResult>;
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

interface SourceOverride {
  readonly filePath: string;
  readonly code: string;
}

interface SourceOverrideBackup {
  readonly filePath: string;
  readonly originalCode: string | null;
}

function normalizeResultPath(projectDir: string, filePath: string): string {
  return path.normalize(
    path.isAbsolute(filePath) ? filePath : path.resolve(projectDir, filePath),
  );
}

async function applySourceOverride(
  projectDir: string,
  override: SourceOverride,
): Promise<SourceOverrideBackup> {
  const fullPath = path.join(projectDir, override.filePath);
  const dir = path.dirname(fullPath);
  await mkdir(dir, { recursive: true });

  let originalCode: string | null = null;
  try {
    originalCode = await readFile(fullPath, "utf-8");
  } catch {
    originalCode = null;
  }

  await writeFile(fullPath, override.code, "utf-8");

  return {
    filePath: override.filePath,
    originalCode,
  };
}

async function restoreSourceOverride(
  projectDir: string,
  backup: SourceOverrideBackup,
): Promise<void> {
  const fullPath = path.join(projectDir, backup.filePath);

  if (backup.originalCode === null) {
    try {
      await unlink(fullPath);
    } catch {
      // File might not exist
    }
    return;
  }

  await writeFile(fullPath, backup.originalCode, "utf-8");
}

function mapResultsByFile(
  projectDir: string,
  results: readonly TestResult[],
): ReadonlyMap<string, TestResult> {
  return new Map(
    results.map((result) => [
      normalizeResultPath(projectDir, result.testFile),
      result,
    ]),
  );
}

async function runVitest(
  projectDir: string,
  testFiles: readonly GeneratedTest[],
  timeout: number,
  sourceOverrides: readonly SourceOverride[] = [],
): Promise<VitestRunResult> {
  const overrideBackups: SourceOverrideBackup[] = [];

  try {
    await Promise.all(testFiles.map((test) => writeTestFile(projectDir, test)));
    for (const sourceOverride of sourceOverrides) {
      overrideBackups.push(
        await applySourceOverride(projectDir, sourceOverride),
      );
    }

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
      results: mapResultsByFile(
        projectDir,
        parseVitestJsonOutput(result.stdout),
      ),
      executionLog: [result.stdout, result.stderr].filter(Boolean).join("\n"),
    };
  } catch (err: unknown) {
    if (err instanceof CommandError && err.stdout.length > 0) {
      try {
        return {
          results: mapResultsByFile(
            projectDir,
            parseVitestJsonOutput(err.stdout),
          ),
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
      results: new Map(
        testFiles.map((test) => [
          normalizeResultPath(projectDir, test.testFilePath),
          testResultSchema.parse({
            testFile: test.testFilePath,
            testName: test.behaviorDescription,
            status: "failed" as const,
            failureMessage: "Vitest execution failed",
            duration: 0,
            failureAnalysis: null,
          }),
        ]),
      ),
      executionLog: errorLog,
    };
  } finally {
    await Promise.all(
      overrideBackups.map((backup) =>
        restoreSourceOverride(projectDir, backup),
      ),
    );
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

async function validateIntentAwareTests(
  tests: readonly GeneratedTest[],
  parentDir: string,
  timeout: number,
): Promise<GeneratedTest[]> {
  const validatedTests: GeneratedTest[] = [];

  for (const test of tests) {
    const shouldValidate =
      test.workflow === "intent-aware" && Boolean(test.mutantValidation);

    if (shouldValidate && test.mutantValidation) {
      const resultKey = normalizeResultPath(parentDir, test.testFilePath);
      const parentRun = await runVitest(parentDir, [test], timeout);
      const parentOutcome =
        parentRun.results.get(resultKey) ?? buildDefaultOutcome(test);

      if (parentOutcome.status === "passed") {
        const mutantRun = await runVitest(parentDir, [test], timeout, [
          {
            filePath: test.mutantValidation.targetFilePath,
            code: test.mutantValidation.mutantCode,
          },
        ]);
        const mutantOutcome =
          mutantRun.results.get(resultKey) ?? buildDefaultOutcome(test);

        if (mutantOutcome.status === "failed") {
          validatedTests.push(test);
        } else {
          logger.info(
            `Discarding ${test.testFilePath}: generated test does not kill inferred mutant`,
          );
        }
      } else {
        logger.info(
          `Discarding ${test.testFilePath}: generated test does not pass on parent`,
        );
      }
    } else {
      validatedTests.push(test);
    }
  }

  return validatedTests;
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
      .map((currentTest) =>
        dualExecutionResultSchema.parse({
          test: currentTest,
          parentOutcome:
            parentResults.results.get(
              normalizeResultPath(parentDir, currentTest.testFilePath),
            ) ?? buildDefaultOutcome(currentTest),
          childOutcome:
            childResults.results.get(
              normalizeResultPath(childDir, currentTest.testFilePath),
            ) ?? buildDefaultOutcome(currentTest),
          parentExecutionLog: parentResults.executionLog,
          childExecutionLog: childResults.executionLog,
        }),
      );

    results.push(...batchResults);
  }

  return results;
}

export { dualExecution, runVitest, validateIntentAwareTests };

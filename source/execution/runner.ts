import { mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import type { GeneratedTest } from "../generation/types.js";
import {
  dualExecutionResultSchema,
  testResultSchema,
} from "../runtime-schemas.js";
import { chunk } from "../utils/concurrency.js";
import { logger } from "../utils/logger.js";
import { CommandError } from "../utils/process.js";

import { runPackageManagerExec } from "./git-worktree.js";
import { parseVitestJsonOutput } from "./result-parser.js";
import type { DualExecutionResult, TestResult } from "./types.js";

interface VitestRunResult {
  readonly results: ReadonlyMap<string, TestResult>;
  readonly executionLog: string;
}

function resolveProjectPath(projectDir: string, relativePath: string): string {
  const root = path.resolve(projectDir);
  if (relativePath.trim().length === 0 || path.isAbsolute(relativePath)) {
    throw new Error(`Path must be project-relative: ${relativePath}`);
  }

  const resolved = path.resolve(root, relativePath);
  const relative = path.relative(root, resolved);
  if (
    relative === "" ||
    relative === ".." ||
    relative.startsWith(`..${path.sep}`) ||
    path.isAbsolute(relative)
  ) {
    throw new Error(`Path escapes project root: ${relativePath}`);
  }

  return resolved;
}

async function writeTestFile(
  projectDir: string,
  test: GeneratedTest,
): Promise<string> {
  const fullPath = resolveProjectPath(projectDir, test.testFilePath);
  const dir = path.dirname(fullPath);
  await mkdir(dir, { recursive: true });
  await writeFile(fullPath, test.code, "utf-8");
  return fullPath;
}

async function removeTestFile(
  projectDir: string,
  test: GeneratedTest,
): Promise<void> {
  try {
    const fullPath = resolveProjectPath(projectDir, test.testFilePath);
    await unlink(fullPath);
  } catch {
    // File might not exist, or generation may have produced an unsafe path.
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
  const fullPath = resolveProjectPath(projectDir, override.filePath);
  const dir = path.dirname(fullPath);
  await mkdir(dir, { recursive: true });

  let originalCode: string | null = null;
  try {
    originalCode = await readFile(fullPath, "utf-8");
  } catch (error) {
    const { code } = error as NodeJS.ErrnoException;
    if (code !== "ENOENT") {
      throw error;
    }
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
  const fullPath = resolveProjectPath(projectDir, backup.filePath);

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

async function restoreSourceOverrides(
  projectDir: string,
  backups: readonly SourceOverrideBackup[],
): Promise<void> {
  for (const backup of [...backups].reverse()) {
    try {
      await restoreSourceOverride(projectDir, backup);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger.warn(
        `Failed to restore source override ${backup.filePath}: ${message}`,
      );
    }
  }
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
  for (const sourceOverride of sourceOverrides) {
    resolveProjectPath(projectDir, sourceOverride.filePath);
  }

  const overrideBackups: SourceOverrideBackup[] = [];

  try {
    await Promise.all(testFiles.map((test) => writeTestFile(projectDir, test)));
    for (const sourceOverride of sourceOverrides) {
      overrideBackups.push(
        await applySourceOverride(projectDir, sourceOverride),
      );
    }

    const result = await runPackageManagerExec(
      projectDir,
      "vitest",
      [
        "run",
        "--reporter=json",
        "--no-color",
        ...testFiles.map((file) => file.testFilePath),
      ],
      {
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
    await restoreSourceOverrides(projectDir, overrideBackups);
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

interface MutantValidationGroup {
  readonly targetFilePath: string;
  readonly mutantCode: string;
  readonly tests: GeneratedTest[];
}

function createMutantValidationKey(test: GeneratedTest): string | null {
  if (test.workflow !== "intent-aware" || !test.mutantValidation) {
    return null;
  }

  return JSON.stringify([
    test.mutantValidation.targetFilePath,
    test.mutantValidation.mutantCode,
  ]);
}

async function validateIntentAwareTests(
  tests: readonly GeneratedTest[],
  parentDir: string,
  timeout: number,
): Promise<GeneratedTest[]> {
  const validatedTests = new Set<GeneratedTest>();
  const intentAwareTests: GeneratedTest[] = [];

  for (const test of tests) {
    const validationKey = createMutantValidationKey(test);
    if (validationKey && test.mutantValidation) {
      intentAwareTests.push(test);
    } else {
      validatedTests.add(test);
    }
  }

  try {
    if (intentAwareTests.length === 0) {
      return [...tests];
    }

    const parentRun = await runVitest(parentDir, intentAwareTests, timeout);
    const groups = new Map<string, MutantValidationGroup>();

    for (const test of intentAwareTests) {
      const resultKey = normalizeResultPath(parentDir, test.testFilePath);
      const parentOutcome =
        parentRun.results.get(resultKey) ?? buildDefaultOutcome(test);
      if (parentOutcome.status === "passed") {
        const validationKey = createMutantValidationKey(test);
        if (validationKey && test.mutantValidation) {
          const group = groups.get(validationKey) ?? {
            targetFilePath: test.mutantValidation.targetFilePath,
            mutantCode: test.mutantValidation.mutantCode,
            tests: [],
          };
          group.tests.push(test);
          groups.set(validationKey, group);
        }
      } else {
        logger.info(
          `Discarding ${test.testFilePath}: generated test does not pass on parent`,
        );
      }
    }

    for (const group of groups.values()) {
      const mutantRun = await runVitest(parentDir, group.tests, timeout, [
        {
          filePath: group.targetFilePath,
          code: group.mutantCode,
        },
      ]);

      for (const test of group.tests) {
        const resultKey = normalizeResultPath(parentDir, test.testFilePath);
        const mutantOutcome =
          mutantRun.results.get(resultKey) ?? buildDefaultOutcome(test);

        if (mutantOutcome.status === "failed") {
          validatedTests.add(test);
        } else {
          logger.info(
            `Discarding ${test.testFilePath}: generated test does not kill inferred mutant`,
          );
        }
      }
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.warn(
      `Intent-aware validation failed; executing generated tests without pre-validation: ${message}`,
    );
    return [...tests];
  }

  return tests.filter((test) => validatedTests.has(test));
}

async function dualExecution(
  tests: readonly GeneratedTest[],
  parentDir: string,
  childDir: string,
  batchSize: number,
  testTimeout: number,
  parallelWorktrees = true,
): Promise<DualExecutionResult[]> {
  const results: DualExecutionResult[] = [];
  const batches = chunk(tests, batchSize);

  for (const batch of batches) {
    logger.info(`Running batch of ${String(batch.length)} tests`);

    const [parentResults, childResults] = parallelWorktrees
      ? await Promise.all([
          runVitest(parentDir, batch, testTimeout),
          runVitest(childDir, batch, testTimeout),
        ])
      : [
          await runVitest(parentDir, batch, testTimeout),
          await runVitest(childDir, batch, testTimeout),
        ];

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

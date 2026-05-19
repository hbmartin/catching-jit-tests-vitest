import {
  access,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { GeneratedTest } from "../../source/generation/types.js";

const tempDirs: string[] = [];

function makeTest(
  testFilePath: string,
  overrides: Partial<GeneratedTest> = {},
): GeneratedTest {
  return {
    code: "import { it, expect } from 'vitest'; it('works', () => expect(true).toBe(true));",
    targetSymbol: "target",
    testFilePath,
    behaviorDescription: "verifies behavior",
    workflow: "intent-aware",
    generatorConfidence: 0.8,
    ...overrides,
  };
}

function makeVitestOutput(
  testFile: string,
  status: "passed" | "failed" = "passed",
): string {
  return JSON.stringify({
    testResults: [
      {
        name: testFile,
        status,
        assertionResults: [
          {
            ancestorTitles: ["suite"],
            title: "result",
            status,
            failureMessages:
              status === "failed" ? ["Expected: true\nReceived: false"] : [],
            duration: 1,
          },
        ],
      },
    ],
  });
}

afterEach(async () => {
  vi.resetModules();
  vi.clearAllMocks();
  vi.doUnmock("../../source/execution/git-worktree.js");

  await Promise.all(
    tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })),
  );
});

describe("dualExecution", () => {
  it("runs parent before child when parallel worktrees are disabled", async () => {
    const parentDir = await mkdtemp(path.join(tmpdir(), "parent-runner-"));
    const childDir = await mkdtemp(path.join(tmpdir(), "child-runner-"));
    tempDirs.push(parentDir, childDir);

    let resolveParentRun: (result: { stdout: string; stderr: string }) => void =
      () => undefined;
    const parentRun = new Promise<{ stdout: string; stderr: string }>(
      (resolve) => {
        resolveParentRun = resolve;
      },
    );
    const runCommandMock = vi
      .fn()
      .mockReturnValueOnce(parentRun)
      .mockResolvedValueOnce({
        stdout: makeVitestOutput(path.join(childDir, "test/seq.test.ts")),
        stderr: "",
      });

    vi.doMock("../../source/utils/process.js", async () => {
      const actual = await vi.importActual<
        typeof import("../../source/utils/process.js")
      >("../../source/utils/process.js");

      return {
        ...actual,
        runCommand: runCommandMock,
      };
    });

    const { dualExecution } = await import("../../source/execution/runner.js");
    const execution = dualExecution(
      [makeTest("test/seq.test.ts")],
      parentDir,
      childDir,
      1,
      1000,
      false,
    );

    await vi.waitFor(() => expect(runCommandMock).toHaveBeenCalledTimes(1));

    expect(runCommandMock).toHaveBeenNthCalledWith(
      1,
      "npm",
      expect.any(Array),
      expect.objectContaining({ cwd: parentDir }),
    );

    resolveParentRun({
      stdout: makeVitestOutput(path.join(parentDir, "test/seq.test.ts")),
      stderr: "",
    });

    await execution;

    expect(runCommandMock).toHaveBeenNthCalledWith(
      2,
      "npm",
      expect.any(Array),
      expect.objectContaining({ cwd: childDir }),
    );
  });
});

describe("validateIntentAwareTests", () => {
  it("keeps tests that pass parent and fail the inferred mutant", async () => {
    const tempDir = await mkdtemp(path.join(tmpdir(), "runner-validate-"));
    tempDirs.push(tempDir);

    const dodgyTest = makeTest("test/dodgy.jittest.test.ts", {
      workflow: "dodgy-diff",
    });
    const killingTest = makeTest("test/kills-mutant.jittest.test.ts", {
      workflow: "intent-aware",
      mutantValidation: {
        targetFilePath: "source/auth.ts",
        mutantCode: "export const isAllowed = () => false;",
      },
    });
    const survivingTest = makeTest("test/survives-mutant.jittest.test.ts", {
      workflow: "intent-aware",
      mutantValidation: {
        targetFilePath: "source/auth.ts",
        mutantCode: "export const isAllowed = () => false;",
      },
    });
    const fileResult = (test: GeneratedTest, status: "passed" | "failed") => ({
      name: path.join(tempDir, test.testFilePath),
      status,
      assertionResults: [
        {
          ancestorTitles: ["suite"],
          title: test.behaviorDescription,
          status,
          failureMessages:
            status === "failed" ? ["Expected true but received false"] : [],
          duration: 1,
        },
      ],
    });
    const runPackageManagerExecMock = vi
      .fn()
      .mockResolvedValueOnce({
        stdout: JSON.stringify({
          testResults: [
            fileResult(killingTest, "passed"),
            fileResult(survivingTest, "passed"),
          ],
        }),
        stderr: "",
      })
      .mockResolvedValueOnce({
        stdout: JSON.stringify({
          testResults: [
            fileResult(killingTest, "failed"),
            fileResult(survivingTest, "passed"),
          ],
        }),
        stderr: "",
      });

    vi.doMock("../../source/execution/git-worktree.js", () => ({
      runPackageManagerExec: runPackageManagerExecMock,
    }));

    const { validateIntentAwareTests } = await import(
      "../../source/execution/runner.js"
    );

    await expect(
      validateIntentAwareTests(
        [dodgyTest, killingTest, survivingTest],
        tempDir,
        500,
      ),
    ).resolves.toEqual([dodgyTest, killingTest]);
    expect(runPackageManagerExecMock).toHaveBeenCalledTimes(2);
  });
});

describe("runVitest", () => {
  it("indexes outcomes by file path instead of reporter order", async () => {
    const tempDir = await mkdtemp(path.join(tmpdir(), "runner-test-"));
    tempDirs.push(tempDir);
    await writeFile(
      path.join(tempDir, "package.json"),
      JSON.stringify({ packageManager: "pnpm@11.1.3" }),
      "utf-8",
    );
    const runCommandMock = vi.fn().mockResolvedValue({
      stdout: JSON.stringify({
        testResults: [
          {
            name: path.join(tempDir, "test/bad.jittest.test.ts"),
            status: "failed",
            message: "Transform failed: Unexpected token",
            assertionResults: [],
          },
          {
            name: path.join(tempDir, "test/good.jittest.test.ts"),
            status: "passed",
            assertionResults: [
              {
                ancestorTitles: ["suite"],
                title: "passes",
                status: "passed",
                failureMessages: [],
                duration: 3,
              },
            ],
          },
        ],
      }),
      stderr: "",
    });

    vi.doMock("../../source/utils/process.js", async () => {
      const actual = await vi.importActual<
        typeof import("../../source/utils/process.js")
      >("../../source/utils/process.js");

      return {
        ...actual,
        runCommand: runCommandMock,
      };
    });

    const { runVitest } = await import("../../source/execution/runner.js");
    const tests = [
      makeTest("test/good.jittest.test.ts"),
      makeTest("test/bad.jittest.test.ts"),
    ];

    const result = await runVitest(tempDir, tests, 1000);

    expect(
      result.results.get(path.join(tempDir, "test/good.jittest.test.ts"))
        ?.status,
    ).toBe("passed");
    expect(
      result.results.get(path.join(tempDir, "test/bad.jittest.test.ts"))
        ?.failureMessage,
    ).toContain("Unexpected token");
    expect(runCommandMock).toHaveBeenCalledWith(
      "pnpm",
      expect.arrayContaining(["exec", "vitest", "run"]),
      expect.objectContaining({ cwd: tempDir }),
    );
  });

  it("rejects source overrides that escape the project root", async () => {
    const tempDir = await mkdtemp(path.join(tmpdir(), "runner-test-"));
    tempDirs.push(tempDir);

    const { runVitest } = await import("../../source/execution/runner.js");
    const escapedName = `${path.basename(tempDir)}-escaped.ts`;
    const escapedPath = path.resolve(tempDir, `../${escapedName}`);

    await expect(
      runVitest(tempDir, [makeTest("test/safe.jittest.test.ts")], 1000, [
        {
          filePath: `../${escapedName}`,
          code: "export const unsafe = true;\n",
        },
      ]),
    ).rejects.toThrow("Path escapes project root");
    await expect(access(escapedPath)).rejects.toThrow();
  });

  it("rejects source overrides through symlinked directories", async () => {
    const tempDir = await mkdtemp(path.join(tmpdir(), "runner-test-"));
    const outsideDir = await mkdtemp(path.join(tmpdir(), "runner-outside-"));
    tempDirs.push(tempDir, outsideDir);
    await symlink(outsideDir, path.join(tempDir, "linked-source"), "dir");

    const { runVitest } = await import("../../source/execution/runner.js");
    const outsidePath = path.join(outsideDir, "escaped.ts");

    await expect(
      runVitest(tempDir, [makeTest("test/safe.jittest.test.ts")], 1000, [
        {
          filePath: "linked-source/escaped.ts",
          code: "export const unsafe = true;\n",
        },
      ]),
    ).rejects.toThrow("Path escapes project root");
    await expect(access(outsidePath)).rejects.toThrow();
  });

  it("surfaces source restore failures after best-effort cleanup", async () => {
    const tempDir = await mkdtemp(path.join(tmpdir(), "runner-test-"));
    const outsideDir = await mkdtemp(path.join(tmpdir(), "runner-outside-"));
    tempDirs.push(tempDir, outsideDir);

    const sourceDir = path.join(tempDir, "source");
    const sourceFile = path.join(sourceDir, "module.ts");
    const testFile = path.join(tempDir, "test/restore.jittest.test.ts");
    await mkdir(sourceDir, { recursive: true });
    await writeFile(sourceFile, "export const answer = () => 42;\n", "utf-8");

    const runCommandMock = vi.fn().mockImplementation(async () => {
      await rm(sourceDir, { recursive: true, force: true });
      await symlink(outsideDir, sourceDir, "dir");
      return {
        stdout: makeVitestOutput(testFile),
        stderr: "",
      };
    });

    vi.doMock("../../source/utils/process.js", async () => {
      const actual = await vi.importActual<
        typeof import("../../source/utils/process.js")
      >("../../source/utils/process.js");

      return {
        ...actual,
        runCommand: runCommandMock,
      };
    });

    const { runVitest } = await import("../../source/execution/runner.js");

    await expect(
      runVitest(tempDir, [makeTest("test/restore.jittest.test.ts")], 1000, [
        {
          filePath: "source/module.ts",
          code: "export const answer = () => 0;\n",
        },
      ]),
    ).rejects.toThrow("Failed to restore source overrides");
    await expect(access(testFile)).rejects.toThrow();
  });

  it("does not classify cleanup failures as parse failures after command errors", async () => {
    const tempDir = await mkdtemp(path.join(tmpdir(), "runner-test-"));
    const outsideDir = await mkdtemp(path.join(tmpdir(), "runner-outside-"));
    tempDirs.push(tempDir, outsideDir);

    const sourceDir = path.join(tempDir, "source");
    const sourceFile = path.join(sourceDir, "module.ts");
    const testFile = path.join(tempDir, "test/restore.jittest.test.ts");
    await mkdir(sourceDir, { recursive: true });
    await writeFile(sourceFile, "export const answer = () => 42;\n", "utf-8");

    const runCommandMock = vi.fn();
    vi.doMock("../../source/utils/process.js", async () => {
      const actual = await vi.importActual<
        typeof import("../../source/utils/process.js")
      >("../../source/utils/process.js");

      runCommandMock.mockImplementation(async () => {
        await rm(sourceDir, { recursive: true, force: true });
        await symlink(outsideDir, sourceDir, "dir");
        throw new actual.CommandError("Command failed: vitest", {
          stdout: makeVitestOutput(testFile, "failed"),
          stderr: "",
          exitCode: 1,
          errorCode: null,
          cause: new Error("vitest failed"),
        });
      });

      return {
        ...actual,
        runCommand: runCommandMock,
      };
    });

    const consoleErrorSpy = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);

    try {
      const { runVitest } = await import("../../source/execution/runner.js");

      await expect(
        runVitest(tempDir, [makeTest("test/restore.jittest.test.ts")], 1000, [
          {
            filePath: "source/module.ts",
            code: "export const answer = () => 0;\n",
          },
        ]),
      ).rejects.toThrow("Failed to restore source overrides");

      const errorLogs = consoleErrorSpy.mock.calls.map(([message]) =>
        String(message),
      );
      expect(errorLogs).not.toEqual(
        expect.arrayContaining([
          expect.stringContaining("Failed to parse Vitest output from error"),
        ]),
      );
      expect(errorLogs).not.toEqual(
        expect.arrayContaining([
          expect.stringContaining("Vitest execution failed"),
        ]),
      );
      expect(runCommandMock).toHaveBeenCalledTimes(1);
    } finally {
      consoleErrorSpy.mockRestore();
    }
  });
});

describe("validateIntentAwareTests", () => {
  it("batches tests by mutant, discards weak tests, and restores source files", async () => {
    const tempDir = await mkdtemp(path.join(tmpdir(), "validate-test-"));
    tempDirs.push(tempDir);

    const sourceFile = path.join(tempDir, "source/module.ts");
    await mkdir(path.dirname(sourceFile), { recursive: true });
    await writeFile(sourceFile, "export const answer = () => 42;\n", "utf-8");

    const runCommandMock = vi
      .fn()
      .mockResolvedValueOnce({
        stdout: JSON.stringify({
          testResults: [
            {
              name: path.join(tempDir, "test/kept.jittest.test.ts"),
              status: "passed",
              assertionResults: [
                {
                  ancestorTitles: ["suite"],
                  title: "passes on parent",
                  status: "passed",
                  failureMessages: [],
                  duration: 1,
                },
              ],
            },
            {
              name: path.join(tempDir, "test/dropped.jittest.test.ts"),
              status: "passed",
              assertionResults: [
                {
                  ancestorTitles: ["suite"],
                  title: "passes on parent",
                  status: "passed",
                  failureMessages: [],
                  duration: 1,
                },
              ],
            },
          ],
        }),
        stderr: "",
      })
      .mockResolvedValueOnce({
        stdout: JSON.stringify({
          testResults: [
            {
              name: path.join(tempDir, "test/kept.jittest.test.ts"),
              status: "failed",
              assertionResults: [
                {
                  ancestorTitles: ["suite"],
                  title: "fails on mutant",
                  status: "failed",
                  failureMessages: ["Expected: 42\nReceived: 0"],
                  duration: 1,
                },
              ],
            },
            {
              name: path.join(tempDir, "test/dropped.jittest.test.ts"),
              status: "passed",
              assertionResults: [
                {
                  ancestorTitles: ["suite"],
                  title: "passes on parent",
                  status: "passed",
                  failureMessages: [],
                  duration: 1,
                },
              ],
            },
          ],
        }),
        stderr: "",
      });

    vi.doMock("../../source/utils/process.js", async () => {
      const actual = await vi.importActual<
        typeof import("../../source/utils/process.js")
      >("../../source/utils/process.js");

      return {
        ...actual,
        runCommand: runCommandMock,
      };
    });

    const { validateIntentAwareTests } = await import(
      "../../source/execution/runner.js"
    );
    const tests = [
      makeTest("test/kept.jittest.test.ts", {
        mutantValidation: {
          targetFilePath: "source/module.ts",
          mutantCode: "export const answer = () => 0;\n",
        },
      }),
      makeTest("test/dropped.jittest.test.ts", {
        mutantValidation: {
          targetFilePath: "source/module.ts",
          mutantCode: "export const answer = () => 0;\n",
        },
      }),
      makeTest("test/dodgy.jittest.test.ts", {
        workflow: "dodgy-diff",
      }),
    ];

    const validated = await validateIntentAwareTests(tests, tempDir, 1000);

    expect(validated.map((test) => test.testFilePath)).toEqual([
      "test/kept.jittest.test.ts",
      "test/dodgy.jittest.test.ts",
    ]);
    expect(await readFile(sourceFile, "utf-8")).toBe(
      "export const answer = () => 42;\n",
    );
    expect(runCommandMock).toHaveBeenCalledTimes(2);
    expect(runCommandMock).toHaveBeenNthCalledWith(
      1,
      "npm",
      expect.arrayContaining([
        "test/kept.jittest.test.ts",
        "test/dropped.jittest.test.ts",
      ]),
      expect.objectContaining({ cwd: tempDir }),
    );
    expect(runCommandMock).toHaveBeenNthCalledWith(
      2,
      "npm",
      expect.arrayContaining([
        "test/kept.jittest.test.ts",
        "test/dropped.jittest.test.ts",
      ]),
      expect.objectContaining({ cwd: tempDir }),
    );
  });

  it("falls back to generated tests when mutant validation fails", async () => {
    const tempDir = await mkdtemp(path.join(tmpdir(), "validate-test-"));
    tempDirs.push(tempDir);
    const escapedName = `${path.basename(tempDir)}-escaped.ts`;
    const escapedPath = path.resolve(tempDir, `../${escapedName}`);

    const runCommandMock = vi.fn().mockResolvedValue({
      stdout: JSON.stringify({
        testResults: [
          {
            name: path.join(tempDir, "test/unsafe.jittest.test.ts"),
            status: "passed",
            assertionResults: [
              {
                ancestorTitles: ["suite"],
                title: "passes on parent",
                status: "passed",
                failureMessages: [],
                duration: 1,
              },
            ],
          },
        ],
      }),
      stderr: "",
    });

    vi.doMock("../../source/utils/process.js", async () => {
      const actual = await vi.importActual<
        typeof import("../../source/utils/process.js")
      >("../../source/utils/process.js");

      return {
        ...actual,
        runCommand: runCommandMock,
      };
    });

    const { validateIntentAwareTests } = await import(
      "../../source/execution/runner.js"
    );
    const tests = [
      makeTest("test/unsafe.jittest.test.ts", {
        mutantValidation: {
          targetFilePath: `../${escapedName}`,
          mutantCode: "export const answer = () => 0;\n",
        },
      }),
    ];

    const validated = await validateIntentAwareTests(tests, tempDir, 1000);

    expect(validated).toEqual(tests);
    expect(runCommandMock).toHaveBeenCalledTimes(1);
    await expect(access(escapedPath)).rejects.toThrow();
  });

  it("runs the parent validation once across different mutants", async () => {
    const tempDir = await mkdtemp(path.join(tmpdir(), "validate-test-"));
    tempDirs.push(tempDir);

    await mkdir(path.join(tempDir, "source"), { recursive: true });
    await writeFile(
      path.join(tempDir, "source/a.ts"),
      "export const a = () => 1;\n",
      "utf-8",
    );
    await writeFile(
      path.join(tempDir, "source/b.ts"),
      "export const b = () => 1;\n",
      "utf-8",
    );

    const runCommandMock = vi
      .fn()
      .mockResolvedValueOnce({
        stdout: JSON.stringify({
          testResults: [
            {
              name: path.join(tempDir, "test/a.jittest.test.ts"),
              status: "passed",
              assertionResults: [
                {
                  ancestorTitles: ["suite"],
                  title: "passes on parent",
                  status: "passed",
                  failureMessages: [],
                  duration: 1,
                },
              ],
            },
            {
              name: path.join(tempDir, "test/b.jittest.test.ts"),
              status: "passed",
              assertionResults: [
                {
                  ancestorTitles: ["suite"],
                  title: "passes on parent",
                  status: "passed",
                  failureMessages: [],
                  duration: 1,
                },
              ],
            },
          ],
        }),
        stderr: "",
      })
      .mockResolvedValueOnce({
        stdout: makeVitestOutput(
          path.join(tempDir, "test/a.jittest.test.ts"),
          "failed",
        ),
        stderr: "",
      })
      .mockResolvedValueOnce({
        stdout: makeVitestOutput(
          path.join(tempDir, "test/b.jittest.test.ts"),
          "failed",
        ),
        stderr: "",
      });

    vi.doMock("../../source/utils/process.js", async () => {
      const actual = await vi.importActual<
        typeof import("../../source/utils/process.js")
      >("../../source/utils/process.js");

      return {
        ...actual,
        runCommand: runCommandMock,
      };
    });

    const { validateIntentAwareTests } = await import(
      "../../source/execution/runner.js"
    );
    const tests = [
      makeTest("test/a.jittest.test.ts", {
        mutantValidation: {
          targetFilePath: "source/a.ts",
          mutantCode: "export const a = () => 0;\n",
        },
      }),
      makeTest("test/b.jittest.test.ts", {
        mutantValidation: {
          targetFilePath: "source/b.ts",
          mutantCode: "export const b = () => 0;\n",
        },
      }),
    ];

    const validated = await validateIntentAwareTests(tests, tempDir, 1000);

    expect(validated).toEqual(tests);
    expect(runCommandMock).toHaveBeenCalledTimes(3);
    expect(runCommandMock).toHaveBeenNthCalledWith(
      1,
      "npm",
      expect.arrayContaining([
        "test/a.jittest.test.ts",
        "test/b.jittest.test.ts",
      ]),
      expect.objectContaining({ cwd: tempDir }),
    );
    expect(runCommandMock).toHaveBeenNthCalledWith(
      2,
      "npm",
      expect.arrayContaining(["test/a.jittest.test.ts"]),
      expect.objectContaining({ cwd: tempDir }),
    );
    expect(runCommandMock).toHaveBeenNthCalledWith(
      3,
      "npm",
      expect.arrayContaining(["test/b.jittest.test.ts"]),
      expect.objectContaining({ cwd: tempDir }),
    );
  });
});

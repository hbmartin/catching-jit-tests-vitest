import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
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

afterEach(async () => {
  vi.resetModules();
  vi.clearAllMocks();

  await Promise.all(
    tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })),
  );
});

describe("runVitest", () => {
  it("indexes outcomes by file path instead of reporter order", async () => {
    const tempDir = await mkdtemp(path.join(tmpdir(), "runner-test-"));
    tempDirs.push(tempDir);
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
  });
});

describe("validateIntentAwareTests", () => {
  it("discards tests that do not kill the inferred mutant and restores source files", async () => {
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
          ],
        }),
        stderr: "",
      })
      .mockResolvedValueOnce({
        stdout: JSON.stringify({
          testResults: [
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
              name: path.join(tempDir, "test/dropped.jittest.test.ts"),
              status: "passed",
              assertionResults: [
                {
                  ancestorTitles: ["suite"],
                  title: "still passes on mutant",
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
  });
});

import { beforeEach, describe, expect, it, vi } from "vitest";

const { runCatchCommandMock } = vi.hoisted(() => ({
  runCatchCommandMock: vi.fn(),
}));

vi.mock("../source/commands/catch.js", () => ({
  runCatchCommand: runCatchCommandMock,
}));

import { runCli } from "../source/cli.js";
import { cliVersion } from "../source/version.js";

describe("runCli", () => {
  beforeEach(() => {
    runCatchCommandMock.mockReset();
  });

  it("prints help for empty input", async () => {
    const writeSpy = vi.spyOn(process.stdout, "write").mockReturnValue(true);

    await runCli([]);

    expect(writeSpy).toHaveBeenCalled();
    writeSpy.mockRestore();
  });

  it("prints the version", async () => {
    const writeSpy = vi.spyOn(process.stdout, "write").mockReturnValue(true);

    await runCli(["--version"]);

    expect(writeSpy).toHaveBeenCalledWith(`${cliVersion}\n`);
    writeSpy.mockRestore();
  });

  it("prints the version for the short flag", async () => {
    const writeSpy = vi.spyOn(process.stdout, "write").mockReturnValue(true);

    await runCli(["-v"]);

    expect(writeSpy).toHaveBeenCalledWith(`${cliVersion}\n`);
    writeSpy.mockRestore();
  });

  it("prints the version before dispatching subcommands", async () => {
    const writeSpy = vi.spyOn(process.stdout, "write").mockReturnValue(true);

    await runCli(["catch", "--version"]);

    expect(writeSpy).toHaveBeenCalledWith(`${cliVersion}\n`);
    expect(runCatchCommandMock).not.toHaveBeenCalled();
    writeSpy.mockRestore();
  });

  it("dispatches the catch command", async () => {
    await runCli(["catch"]);

    expect(runCatchCommandMock).toHaveBeenCalled();
  });

  it("prints catch help without dispatching the command", async () => {
    const writeSpy = vi.spyOn(process.stdout, "write").mockReturnValue(true);

    await runCli(["catch", "--help"]);

    expect(writeSpy).toHaveBeenCalled();
    expect(runCatchCommandMock).not.toHaveBeenCalled();
    writeSpy.mockRestore();
  });

  it("passes PR metadata through catch options", async () => {
    await runCli([
      "catch",
      "--pr-title",
      "Fix auth bug",
      "--pr-body",
      "Preserve login behavior",
    ]);

    expect(runCatchCommandMock).toHaveBeenCalledWith(
      expect.objectContaining({
        prTitle: "Fix auth bug",
        prBody: "Preserve login behavior",
      }),
    );
  });

  it("passes all catch scalar options through parser coercion", async () => {
    await runCli([
      "catch",
      "--base",
      "main",
      "--head",
      "feature",
      "--workflow",
      "dodgy-diff",
      "--risk-threshold",
      "0.42",
      "--tests-per-function",
      "4",
      "--timeout",
      "45000",
      "--output",
      "json",
      "--report-threshold=-0.1",
      "--feedback-path",
      ".cache/records.jsonl",
      "--context-file",
      "docs/intent.md",
      "--context-file",
      "docs/security.md",
      "--cwd",
      "/tmp/repo",
    ]);

    expect(runCatchCommandMock).toHaveBeenCalledWith(
      expect.objectContaining({
        base: "main",
        head: "feature",
        workflow: "dodgy-diff",
        riskThreshold: 0.42,
        testsPerFunction: 4,
        timeout: 45_000,
        output: "json",
        reportThreshold: -0.1,
        feedbackPath: ".cache/records.jsonl",
        contextFiles: ["docs/intent.md", "docs/security.md"],
        cwd: "/tmp/repo",
      }),
    );
  });

  it("passes execution and file filter options through catch options", async () => {
    await runCli([
      "catch",
      "--max-total-tests",
      "12",
      "--batch-size",
      "3",
      "--parallel-worktrees",
      "false",
      "--include",
      "packages/*/src/**/*.ts",
      "--exclude",
      "**/*.generated.ts",
    ]);

    expect(runCatchCommandMock).toHaveBeenCalledWith(
      expect.objectContaining({
        maxTotalTests: 12,
        batchSize: 3,
        parallelWorktrees: false,
        include: ["packages/*/src/**/*.ts"],
        exclude: ["**/*.generated.ts"],
      }),
    );
  });

  it("throws on unknown commands", async () => {
    await expect(runCli(["unknown"])).rejects.toThrow("Unknown command");
  });
});

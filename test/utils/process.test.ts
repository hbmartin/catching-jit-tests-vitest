import { afterEach, describe, expect, it, vi } from "vitest";

describe("runCommand", () => {
  afterEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
  });

  it("returns stdout and stderr on success", async () => {
    const execFileAsyncMock = vi.fn().mockResolvedValue({
      stdout: "ok",
      stderr: "",
    });

    vi.doMock("node:child_process", () => ({
      execFile: vi.fn(),
    }));
    vi.doMock("node:util", async () => {
      const actual =
        await vi.importActual<typeof import("node:util")>("node:util");

      return {
        ...actual,
        promisify: () => execFileAsyncMock,
      };
    });

    const { runCommand } = await import("../../source/utils/process.js");
    const result = await runCommand("git", ["status"], {
      cwd: ".",
    });

    expect(result).toEqual({
      stdout: "ok",
      stderr: "",
    });
  });

  it("includes stderr when wrapping failures", async () => {
    const execFileAsyncMock = vi.fn().mockRejectedValue({
      stderr: "fatal: bad revision",
      stdout: "",
      code: 128,
    });

    vi.doMock("node:child_process", () => ({
      execFile: vi.fn(),
    }));
    vi.doMock("node:util", async () => {
      const actual =
        await vi.importActual<typeof import("node:util")>("node:util");

      return {
        ...actual,
        promisify: () => execFileAsyncMock,
      };
    });

    const { runCommand } = await import("../../source/utils/process.js");

    await expect(runCommand("git", ["diff"])).rejects.toThrow(
      "fatal: bad revision",
    );
  });

  it("still wraps failures when stderr is missing", async () => {
    const execFileAsyncMock = vi.fn().mockRejectedValue({});

    vi.doMock("node:child_process", () => ({
      execFile: vi.fn(),
    }));
    vi.doMock("node:util", async () => {
      const actual =
        await vi.importActual<typeof import("node:util")>("node:util");

      return {
        ...actual,
        promisify: () => execFileAsyncMock,
      };
    });

    const { runCommand } = await import("../../source/utils/process.js");

    await expect(runCommand("git", ["diff"])).rejects.toThrow(
      "Command failed: git diff",
    );
  });

  it("normalizes string process error codes separately from numeric exit codes", async () => {
    const execFileAsyncMock = vi.fn().mockRejectedValue({
      stderr: "",
      stdout: "",
      code: "ENOENT",
    });

    vi.doMock("node:child_process", () => ({
      execFile: vi.fn(),
    }));
    vi.doMock("node:util", async () => {
      const actual =
        await vi.importActual<typeof import("node:util")>("node:util");

      return {
        ...actual,
        promisify: () => execFileAsyncMock,
      };
    });

    const { CommandError, runCommand } = await import(
      "../../source/utils/process.js"
    );

    try {
      await runCommand("pnpm", ["install"]);
      throw new Error("Expected runCommand to throw");
    } catch (error) {
      const commandError = error as InstanceType<typeof CommandError>;
      expect(error).toBeInstanceOf(CommandError);
      expect(commandError.exitCode).toBeNull();
      expect(commandError.errorCode).toBe("ENOENT");
    }
  });
});

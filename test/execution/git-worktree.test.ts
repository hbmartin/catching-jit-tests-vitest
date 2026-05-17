import { afterEach, describe, expect, it, vi } from "vitest";

describe("setupWorktrees", () => {
  afterEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
  });

  it("tries to remove the child worktree after a partial child setup failure", async () => {
    const runCommandMock = vi
      .fn()
      .mockResolvedValueOnce({ stdout: "", stderr: "" })
      .mockRejectedValueOnce(new Error("child add failed"))
      .mockResolvedValueOnce({ stdout: "", stderr: "" })
      .mockResolvedValueOnce({ stdout: "", stderr: "" });
    const mkdtempMock = vi.fn().mockResolvedValue("/tmp/jittest-123");
    const rmMock = vi.fn().mockResolvedValue(undefined);

    vi.doMock("../../source/utils/process.js", () => ({
      CommandError: class CommandError extends Error {},
      runCommand: runCommandMock,
    }));
    vi.doMock("node:fs/promises", () => ({
      access: vi.fn(),
      mkdtemp: mkdtempMock,
      readFile: vi.fn(),
      rm: rmMock,
    }));

    const { setupWorktrees } = await import(
      "../../source/execution/git-worktree.js"
    );

    await expect(
      setupWorktrees("/repo", "base-sha", "head-sha"),
    ).rejects.toThrow("child add failed");

    expect(runCommandMock).toHaveBeenNthCalledWith(
      3,
      "git",
      ["worktree", "remove", "/tmp/jittest-123/child", "--force"],
      expect.objectContaining({ cwd: "/repo" }),
    );
    expect(runCommandMock).toHaveBeenNthCalledWith(
      4,
      "git",
      ["worktree", "remove", "/tmp/jittest-123/parent", "--force"],
      expect.objectContaining({ cwd: "/repo" }),
    );
    expect(rmMock).toHaveBeenCalledWith("/tmp/jittest-123", {
      recursive: true,
      force: true,
    });
  });

  it("tries to remove both worktree paths after a partial parent setup failure", async () => {
    const runCommandMock = vi
      .fn()
      .mockRejectedValueOnce(new Error("parent add failed"))
      .mockResolvedValueOnce({ stdout: "", stderr: "" })
      .mockResolvedValueOnce({ stdout: "", stderr: "" });
    const mkdtempMock = vi.fn().mockResolvedValue("/tmp/jittest-456");
    const rmMock = vi.fn().mockResolvedValue(undefined);

    vi.doMock("../../source/utils/process.js", () => ({
      CommandError: class CommandError extends Error {},
      runCommand: runCommandMock,
    }));
    vi.doMock("node:fs/promises", () => ({
      access: vi.fn(),
      mkdtemp: mkdtempMock,
      readFile: vi.fn(),
      rm: rmMock,
    }));

    const { setupWorktrees } = await import(
      "../../source/execution/git-worktree.js"
    );

    await expect(
      setupWorktrees("/repo", "base-sha", "head-sha"),
    ).rejects.toThrow("parent add failed");

    expect(runCommandMock).toHaveBeenNthCalledWith(
      2,
      "git",
      ["worktree", "remove", "/tmp/jittest-456/child", "--force"],
      expect.objectContaining({ cwd: "/repo" }),
    );
    expect(runCommandMock).toHaveBeenNthCalledWith(
      3,
      "git",
      ["worktree", "remove", "/tmp/jittest-456/parent", "--force"],
      expect.objectContaining({ cwd: "/repo" }),
    );
    expect(rmMock).toHaveBeenCalledWith("/tmp/jittest-456", {
      recursive: true,
      force: true,
    });
  });
});

describe("buildPackageManagerExecCommand", () => {
  it("builds package-manager specific vitest exec commands", async () => {
    const { buildPackageManagerExecCommand } = await import(
      "../../source/execution/git-worktree.js"
    );

    expect(
      buildPackageManagerExecCommand("pnpm", "vitest", ["run", "a.test.ts"]),
    ).toEqual({
      command: "pnpm",
      args: ["exec", "vitest", "run", "a.test.ts"],
    });
    expect(
      buildPackageManagerExecCommand("npm", "vitest", ["run", "a.test.ts"]),
    ).toEqual({
      command: "npm",
      args: ["exec", "--", "vitest", "run", "a.test.ts"],
    });
    expect(
      buildPackageManagerExecCommand("yarn", "vitest", ["run", "a.test.ts"]),
    ).toEqual({
      command: "yarn",
      args: ["vitest", "run", "a.test.ts"],
    });
  });

  it("quotes Windows command arguments without flattening spaces", async () => {
    const { buildPackageManagerExecCommand } = await import(
      "../../source/execution/git-worktree.js"
    );

    expect(
      buildPackageManagerExecCommand(
        "npm",
        "vitest",
        ["run", "dir with spaces/a.test.ts"],
        "win32",
      ),
    ).toEqual({
      command: "cmd.exe",
      args: [
        "/d",
        "/s",
        "/c",
        '"npm" "exec" "--" "vitest" "run" "dir with spaces/a.test.ts"',
      ],
    });
  });

  it("rejects Windows command arguments with shell metacharacters", async () => {
    const { buildPackageManagerExecCommand } = await import(
      "../../source/execution/git-worktree.js"
    );

    expect(() =>
      buildPackageManagerExecCommand(
        "npm",
        "vitest",
        ["run", "safe.test.ts & del important"],
        "win32",
      ),
    ).toThrow("Unsafe Windows shell argument");
  });
});

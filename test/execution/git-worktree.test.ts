import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

const tempDirs: string[] = [];

describe("setupWorktrees", () => {
  afterEach(async () => {
    vi.resetModules();
    vi.clearAllMocks();
    vi.doUnmock("node:fs/promises");
    vi.doUnmock("../../source/utils/logger.js");
    vi.doUnmock("../../source/utils/process.js");

    await Promise.all(
      tempDirs
        .splice(0)
        .map((dir) => rm(dir, { recursive: true, force: true })),
    );
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

  it("cleans up successful worktrees and warns on best-effort cleanup failures", async () => {
    const runCommandMock = vi
      .fn()
      .mockResolvedValueOnce({ stdout: "", stderr: "" })
      .mockResolvedValueOnce({ stdout: "", stderr: "" })
      .mockRejectedValueOnce(new Error("remove parent failed"))
      .mockRejectedValueOnce(new Error("remove child failed"));
    const warnMock = vi.fn();
    const rmMock = vi.fn().mockRejectedValue(new Error("rm failed"));

    vi.doMock("../../source/utils/process.js", () => ({
      CommandError: class CommandError extends Error {},
      runCommand: runCommandMock,
    }));
    vi.doMock("../../source/utils/logger.js", () => ({
      logger: {
        info: vi.fn(),
        warn: warnMock,
      },
    }));
    vi.doMock("node:fs/promises", () => ({
      access: vi.fn().mockResolvedValue(undefined),
      mkdtemp: vi.fn().mockResolvedValue("/tmp/jittest-success"),
      readFile: vi.fn(),
      rm: rmMock,
    }));

    const { setupWorktrees } = await import(
      "../../source/execution/git-worktree.js"
    );

    const worktrees = await setupWorktrees("/repo", "base-sha", "head-sha");
    await worktrees.cleanup();

    expect(runCommandMock).toHaveBeenNthCalledWith(
      1,
      "git",
      ["worktree", "add", "/tmp/jittest-success/parent", "base-sha"],
      expect.objectContaining({ cwd: "/repo" }),
    );
    expect(runCommandMock).toHaveBeenNthCalledWith(
      2,
      "git",
      ["worktree", "add", "/tmp/jittest-success/child", "head-sha"],
      expect.objectContaining({ cwd: "/repo" }),
    );
    expect(warnMock).toHaveBeenCalledWith("Failed to remove parent worktree");
    expect(warnMock).toHaveBeenCalledWith("Failed to remove child worktree");
    expect(warnMock).toHaveBeenCalledWith("Failed to remove temp directory");
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
        '""npm" "exec" "--" "vitest" "run" "dir with spaces/a.test.ts""',
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

describe("package manager detection and execution", () => {
  afterEach(async () => {
    vi.resetModules();
    vi.clearAllMocks();
    vi.doUnmock("node:fs/promises");
    vi.doUnmock("../../source/utils/logger.js");
    vi.doUnmock("../../source/utils/process.js");

    await Promise.all(
      tempDirs
        .splice(0)
        .map((dir) => rm(dir, { recursive: true, force: true })),
    );
  });

  it("orders declared package managers before lockfile fallbacks", async () => {
    const projectDir = await mkdtemp(path.join(tmpdir(), "jittest-pm-"));
    tempDirs.push(projectDir);
    await writeFile(
      path.join(projectDir, "package.json"),
      JSON.stringify({ packageManager: "yarn@4.0.0" }),
      "utf-8",
    );
    await writeFile(path.join(projectDir, "pnpm-lock.yaml"), "", "utf-8");
    await writeFile(path.join(projectDir, "yarn.lock"), "", "utf-8");
    await writeFile(path.join(projectDir, "package-lock.json"), "", "utf-8");

    const { detectPackageManagerOrder } = await import(
      "../../source/execution/git-worktree.js"
    );

    await expect(detectPackageManagerOrder(projectDir)).resolves.toEqual({
      preferred: "yarn",
      fallbacks: ["pnpm", "npm"],
    });
  });

  it("falls back to npm when the preferred installer is missing", async () => {
    const projectDir = await mkdtemp(path.join(tmpdir(), "jittest-pm-"));
    tempDirs.push(projectDir);
    await writeFile(
      path.join(projectDir, "package.json"),
      JSON.stringify({ packageManager: "pnpm@11.1.3" }),
      "utf-8",
    );
    await writeFile(path.join(projectDir, "package-lock.json"), "{}", "utf-8");

    const runCommandMock = vi.fn();
    vi.doMock("../../source/utils/process.js", async () => {
      const actual = await vi.importActual<
        typeof import("../../source/utils/process.js")
      >("../../source/utils/process.js");
      runCommandMock
        .mockRejectedValueOnce(
          new actual.CommandError("Command failed: pnpm install", {
            stdout: "",
            stderr: "",
            exitCode: null,
            errorCode: "ENOENT",
            cause: new Error("missing pnpm"),
          }),
        )
        .mockResolvedValueOnce({ stdout: "", stderr: "" });

      return {
        ...actual,
        runCommand: runCommandMock,
      };
    });

    const { installDependencies } = await import(
      "../../source/execution/git-worktree.js"
    );

    await installDependencies(projectDir);

    expect(runCommandMock).toHaveBeenNthCalledWith(
      1,
      "pnpm",
      ["install", "--frozen-lockfile"],
      expect.objectContaining({ cwd: projectDir }),
    );
    expect(runCommandMock).toHaveBeenNthCalledWith(
      2,
      "npm",
      ["ci", "--prefer-offline"],
      expect.objectContaining({ cwd: projectDir }),
    );
  });

  it("falls back while running package executables", async () => {
    const projectDir = await mkdtemp(path.join(tmpdir(), "jittest-pm-"));
    tempDirs.push(projectDir);
    await writeFile(path.join(projectDir, "pnpm-lock.yaml"), "", "utf-8");
    await writeFile(path.join(projectDir, "package-lock.json"), "{}", "utf-8");

    const runCommandMock = vi.fn();
    vi.doMock("../../source/utils/process.js", async () => {
      const actual = await vi.importActual<
        typeof import("../../source/utils/process.js")
      >("../../source/utils/process.js");
      runCommandMock
        .mockRejectedValueOnce(
          new actual.CommandError("Command failed: pnpm exec vitest", {
            stdout: "",
            stderr: "pnpm: command not found",
            exitCode: 127,
            errorCode: null,
            cause: new Error("missing pnpm"),
          }),
        )
        .mockResolvedValueOnce({ stdout: "ok", stderr: "" });

      return {
        ...actual,
        runCommand: runCommandMock,
      };
    });

    const { runPackageManagerExec } = await import(
      "../../source/execution/git-worktree.js"
    );

    await expect(
      runPackageManagerExec(projectDir, "vitest", ["run"], { timeout: 100 }),
    ).resolves.toEqual({ stdout: "ok", stderr: "" });
    expect(runCommandMock).toHaveBeenNthCalledWith(
      2,
      "npm",
      ["exec", "--", "vitest", "run"],
      expect.objectContaining({ cwd: projectDir, timeout: 100 }),
    );
  });
});

describe("installWorktreeDependencies", () => {
  const created: string[] = [];

  afterEach(async () => {
    vi.resetModules();
    vi.clearAllMocks();
    vi.doUnmock("../../source/utils/process.js");
    await Promise.all(
      created.splice(0).map((dir) => rm(dir, { recursive: true, force: true })),
    );
  });

  const makeWorktreePair = async (
    parentLock: string,
    childLock: string,
  ): Promise<{ parentDir: string; childDir: string }> => {
    const root = await mkdtemp(path.join(tmpdir(), "jittest-wt-"));
    created.push(root);
    const parentDir = path.join(root, "parent");
    const childDir = path.join(root, "child");
    await mkdir(parentDir, { recursive: true });
    await mkdir(childDir, { recursive: true });

    for (const dir of [parentDir, childDir]) {
      await writeFile(
        path.join(dir, "package.json"),
        JSON.stringify({ packageManager: "pnpm@11.1.3" }),
        "utf-8",
      );
    }
    await writeFile(
      path.join(parentDir, "pnpm-lock.yaml"),
      parentLock,
      "utf-8",
    );
    await writeFile(path.join(childDir, "pnpm-lock.yaml"), childLock, "utf-8");

    return { parentDir, childDir };
  };

  const mockRunCommand = async () => {
    const runCommandMock = vi
      .fn()
      .mockResolvedValue({ stdout: "", stderr: "" });
    vi.doMock("../../source/utils/process.js", async () => {
      const actual = await vi.importActual<
        typeof import("../../source/utils/process.js")
      >("../../source/utils/process.js");
      return { ...actual, runCommand: runCommandMock };
    });
    return runCommandMock;
  };

  it("installs once and symlinks node_modules when lockfiles match", async () => {
    const { parentDir, childDir } = await makeWorktreePair("lock-a", "lock-a");
    await mkdir(path.join(parentDir, "node_modules"), { recursive: true });
    await writeFile(
      path.join(parentDir, "node_modules", "marker.txt"),
      "installed",
      "utf-8",
    );

    const runCommandMock = await mockRunCommand();
    const { installWorktreeDependencies } = await import(
      "../../source/execution/git-worktree.js"
    );

    await installWorktreeDependencies(parentDir, childDir, true);

    // Only the parent is installed; the child reuses it via a symlink.
    expect(runCommandMock).toHaveBeenCalledTimes(1);
    expect(runCommandMock).toHaveBeenCalledWith(
      "pnpm",
      ["install", "--frozen-lockfile"],
      expect.objectContaining({ cwd: parentDir }),
    );
    await expect(
      readFile(path.join(childDir, "node_modules", "marker.txt"), "utf-8"),
    ).resolves.toBe("installed");
  });

  it("installs both worktrees when lockfiles differ", async () => {
    const { parentDir, childDir } = await makeWorktreePair("lock-a", "lock-b");

    const runCommandMock = await mockRunCommand();
    const { installWorktreeDependencies } = await import(
      "../../source/execution/git-worktree.js"
    );

    await installWorktreeDependencies(parentDir, childDir, false);

    expect(runCommandMock).toHaveBeenCalledTimes(2);
    expect(runCommandMock).toHaveBeenCalledWith(
      "pnpm",
      ["install", "--frozen-lockfile"],
      expect.objectContaining({ cwd: parentDir }),
    );
    expect(runCommandMock).toHaveBeenCalledWith(
      "pnpm",
      ["install", "--frozen-lockfile"],
      expect.objectContaining({ cwd: childDir }),
    );
  });
});

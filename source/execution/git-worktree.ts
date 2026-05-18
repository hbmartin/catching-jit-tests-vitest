import { access, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { logger } from "../utils/logger.js";
import {
  CommandError,
  type RunCommandOptions,
  type RunCommandResult,
  runCommand,
} from "../utils/process.js";

import type { WorktreeSetup } from "./types.js";

type PackageManager = "npm" | "pnpm" | "yarn";

const packageManagerInstallArgs: Record<PackageManager, readonly string[]> = {
  npm: ["ci", "--prefer-offline"],
  pnpm: ["install", "--frozen-lockfile"],
  yarn: ["install", "--frozen-lockfile"],
};
const windowsShellUnsafePattern = /["&|<>^%!\r\n]/;

async function execInDir(
  command: string,
  args: readonly string[],
  cwd: string,
): Promise<string> {
  const result = await runCommand(command, args, {
    cwd,
    maxBuffer: 10 * 1024 * 1024,
    timeout: 120_000,
  });

  return result.stdout.trim();
}

async function removeWorktree(
  repoRoot: string,
  worktreeDir: string,
  warningMessage: string,
): Promise<void> {
  try {
    await execInDir(
      "git",
      ["worktree", "remove", worktreeDir, "--force"],
      repoRoot,
    );
  } catch {
    if (await pathExists(worktreeDir)) {
      logger.warn(warningMessage);
    }
  }
}

async function setupWorktrees(
  repoRoot: string,
  baseSha: string,
  headSha: string,
): Promise<WorktreeSetup> {
  const workDir = await mkdtemp(path.join(tmpdir(), "jittest-"));
  const parentDir = path.join(workDir, "parent");
  const childDir = path.join(workDir, "child");

  logger.info(`Setting up worktrees in ${workDir}`);

  try {
    await execInDir("git", ["worktree", "add", parentDir, baseSha], repoRoot);
    await execInDir("git", ["worktree", "add", childDir, headSha], repoRoot);
  } catch (error) {
    await removeWorktree(
      repoRoot,
      childDir,
      "Failed to remove child worktree after setup error",
    );
    await removeWorktree(
      repoRoot,
      parentDir,
      "Failed to remove parent worktree after setup error",
    );

    try {
      await rm(workDir, { recursive: true, force: true });
    } catch {
      logger.warn("Failed to remove temp directory after setup error");
    }

    throw error;
  }

  logger.info("Worktrees created, installing dependencies");

  return {
    parentDir,
    childDir,
    cleanup: async () => {
      logger.info("Cleaning up worktrees");
      await removeWorktree(
        repoRoot,
        parentDir,
        "Failed to remove parent worktree",
      );
      await removeWorktree(
        repoRoot,
        childDir,
        "Failed to remove child worktree",
      );
      try {
        await rm(workDir, { recursive: true, force: true });
      } catch {
        logger.warn("Failed to remove temp directory");
      }
    },
  };
}

async function installDependencies(projectDir: string): Promise<void> {
  logger.info(`Installing dependencies in ${projectDir}`);

  const { preferred, fallbacks } = await detectPackageManagerOrder(projectDir);
  logger.info(`Using ${preferred} to install dependencies`);

  try {
    await runPackageManagerInstall(projectDir, preferred);
    return;
  } catch (error) {
    if (!isMissingPackageManagerError(error, preferred)) {
      throw error;
    }

    let lastError: unknown = error;
    for (const fallback of fallbacks) {
      try {
        logger.info(`Falling back to ${fallback} after missing ${preferred}`);
        await runPackageManagerInstall(projectDir, fallback);
        return;
      } catch (fallbackError) {
        if (!isMissingPackageManagerError(fallbackError, fallback)) {
          throw fallbackError;
        }
        lastError = fallbackError;
      }
    }

    throw lastError;
  }
}

async function pathExists(filePath: string): Promise<boolean> {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

function parseDeclaredPackageManager(
  packageManager: unknown,
): PackageManager | null {
  if (typeof packageManager !== "string" || packageManager.length === 0) {
    return null;
  }

  const [name] = packageManager.split("@");
  if (name === "npm" || name === "pnpm" || name === "yarn") {
    return name;
  }

  return null;
}

async function readDeclaredPackageManager(
  projectDir: string,
): Promise<PackageManager | null> {
  try {
    const packageJsonPath = path.join(projectDir, "package.json");
    const packageJson = JSON.parse(
      await readFile(packageJsonPath, "utf-8"),
    ) as {
      packageManager?: unknown;
    };

    return parseDeclaredPackageManager(packageJson.packageManager);
  } catch {
    return null;
  }
}

async function findLockfileManagers(
  projectDir: string,
): Promise<PackageManager[]> {
  const managers: PackageManager[] = [];

  if (await pathExists(path.join(projectDir, "pnpm-lock.yaml"))) {
    managers.push("pnpm");
  }

  if (await pathExists(path.join(projectDir, "yarn.lock"))) {
    managers.push("yarn");
  }

  if (await pathExists(path.join(projectDir, "package-lock.json"))) {
    managers.push("npm");
  }

  return managers;
}

async function detectPackageManagerOrder(projectDir: string): Promise<{
  preferred: PackageManager;
  fallbacks: PackageManager[];
}> {
  const declared = await readDeclaredPackageManager(projectDir);
  const lockfileManagers = await findLockfileManagers(projectDir);

  if (declared || lockfileManagers.length > 0) {
    const ordered = [
      ...new Set([declared, ...lockfileManagers].filter(Boolean)),
    ] as PackageManager[];
    const [preferred = "npm", ...fallbacks] = ordered;
    return { preferred, fallbacks };
  }

  return {
    preferred: "npm",
    fallbacks: ["pnpm", "yarn"],
  };
}

function buildPackageManagerCommand(manager: PackageManager): {
  command: string;
  args: readonly string[];
} {
  return buildPackageManagerShellCommand(
    manager,
    packageManagerInstallArgs[manager],
  );
}

function buildPackageManagerShellCommand(
  manager: PackageManager,
  args: readonly string[],
  platform = process.platform,
): {
  command: string;
  args: readonly string[];
} {
  if (platform === "win32") {
    return {
      command: "cmd.exe",
      args: [
        "/d",
        "/s",
        "/c",
        `"${buildWindowsCommandLine([manager, ...args])}"`,
      ],
    };
  }

  return {
    command: manager,
    args,
  };
}

function buildPackageManagerExecCommand(
  manager: PackageManager,
  executable: string,
  args: readonly string[],
  platform = process.platform,
): {
  command: string;
  args: readonly string[];
} {
  let execArgs: readonly string[];
  if (manager === "npm") {
    execArgs = ["exec", "--", executable, ...args];
  } else if (manager === "pnpm") {
    execArgs = ["exec", executable, ...args];
  } else {
    execArgs = [executable, ...args];
  }

  return buildPackageManagerShellCommand(manager, execArgs, platform);
}

function quoteWindowsCommandArg(arg: string): string {
  if (windowsShellUnsafePattern.test(arg)) {
    throw new Error(`Unsafe Windows shell argument: ${arg}`);
  }

  return `"${arg}"`;
}

function buildWindowsCommandLine(args: readonly string[]): string {
  return args.map((arg) => quoteWindowsCommandArg(arg)).join(" ");
}

async function runPackageManagerInstall(
  projectDir: string,
  manager: PackageManager,
): Promise<void> {
  const { command, args } = buildPackageManagerCommand(manager);
  await execInDir(command, args, projectDir);
}

async function runPackageManagerExec(
  projectDir: string,
  executable: string,
  args: readonly string[],
  options: Omit<RunCommandOptions, "cwd"> = {},
): Promise<RunCommandResult> {
  const { preferred, fallbacks } = await detectPackageManagerOrder(projectDir);
  let lastError: unknown;

  for (const manager of [preferred, ...fallbacks]) {
    try {
      const command = buildPackageManagerExecCommand(manager, executable, args);
      return await runCommand(command.command, command.args, {
        ...options,
        cwd: projectDir,
      });
    } catch (error) {
      if (!isMissingPackageManagerError(error, manager)) {
        throw error;
      }
      logger.info(
        `Falling back from missing ${manager} while running ${executable}`,
      );
      lastError = error;
    }
  }

  throw lastError;
}

function isMissingPackageManagerError(
  error: unknown,
  manager: PackageManager,
): boolean {
  if (!(error instanceof CommandError)) {
    return false;
  }

  if (error.errorCode === "ENOENT") {
    return true;
  }

  const rendered = `${error.message}\n${error.stderr}`.toLowerCase();
  return (
    rendered.includes(`${manager}: command not found`) ||
    rendered.includes(`${manager}: not found`) ||
    rendered.includes(`'${manager}' is not recognized`) ||
    rendered.includes(`"${manager}" is not recognized`)
  );
}

export type { PackageManager };
export {
  buildPackageManagerExecCommand,
  detectPackageManagerOrder,
  installDependencies,
  runPackageManagerExec,
  setupWorktrees,
};

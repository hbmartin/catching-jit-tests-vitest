import { access, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { logger } from "../utils/logger.js";
import { CommandError, runCommand } from "../utils/process.js";

import type { WorktreeSetup } from "./types.js";

type PackageManager = "npm" | "pnpm" | "yarn";

const packageManagerInstallArgs: Record<PackageManager, readonly string[]> = {
  npm: ["ci", "--prefer-offline"],
  pnpm: ["install", "--frozen-lockfile"],
  yarn: ["install", "--frozen-lockfile"],
};

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

async function setupWorktrees(
  repoRoot: string,
  baseSha: string,
  headSha: string,
): Promise<WorktreeSetup> {
  const workDir = await mkdtemp(path.join(tmpdir(), "jittest-"));
  const parentDir = path.join(workDir, "parent");
  const childDir = path.join(workDir, "child");

  logger.info(`Setting up worktrees in ${workDir}`);

  let parentCreated = false;
  let childCreated = false;

  try {
    await execInDir("git", ["worktree", "add", parentDir, baseSha], repoRoot);
    parentCreated = true;
    await execInDir("git", ["worktree", "add", childDir, headSha], repoRoot);
    childCreated = true;
  } catch (error) {
    if (childCreated) {
      try {
        await execInDir(
          "git",
          ["worktree", "remove", childDir, "--force"],
          repoRoot,
        );
      } catch {
        logger.warn("Failed to remove child worktree after setup error");
      }
    }

    if (parentCreated) {
      try {
        await execInDir(
          "git",
          ["worktree", "remove", parentDir, "--force"],
          repoRoot,
        );
      } catch {
        logger.warn("Failed to remove parent worktree after setup error");
      }
    }

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
      try {
        await execInDir(
          "git",
          ["worktree", "remove", parentDir, "--force"],
          repoRoot,
        );
      } catch {
        logger.warn("Failed to remove parent worktree");
      }
      try {
        await execInDir(
          "git",
          ["worktree", "remove", childDir, "--force"],
          repoRoot,
        );
      } catch {
        logger.warn("Failed to remove child worktree");
      }
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
  const installArgs = packageManagerInstallArgs[manager];
  if (process.platform === "win32") {
    return {
      command: "cmd.exe",
      args: ["/d", "/s", "/c", [manager, ...installArgs].join(" ")],
    };
  }

  return {
    command: manager,
    args: installArgs,
  };
}

async function runPackageManagerInstall(
  projectDir: string,
  manager: PackageManager,
): Promise<void> {
  const { command, args } = buildPackageManagerCommand(manager);
  await execInDir(command, args, projectDir);
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

export { installDependencies, setupWorktrees };

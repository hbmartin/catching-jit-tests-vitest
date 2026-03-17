import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { logger } from "../utils/logger.js";
import { runCommand } from "../utils/process.js";

import type { WorktreeSetup } from "./types.js";

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

  await execInDir("git", ["worktree", "add", parentDir, baseSha], repoRoot);
  await execInDir("git", ["worktree", "add", childDir, headSha], repoRoot);

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
  try {
    await execInDir("npm", ["ci", "--prefer-offline"], projectDir);
    return;
  } catch {
    try {
      await execInDir("pnpm", ["install", "--frozen-lockfile"], projectDir);
      return;
    } catch {
      await execInDir("yarn", ["install", "--frozen-lockfile"], projectDir);
    }
  }
}

export { installDependencies, setupWorktrees };

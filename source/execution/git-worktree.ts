import { execSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { logger } from "../utils/logger.js";

import type { WorktreeSetup } from "./types.js";

function execInDir(command: string, cwd: string): string {
  return execSync(command, {
    cwd,
    encoding: "utf-8",
    maxBuffer: 10 * 1024 * 1024,
    timeout: 120_000,
  }).trim();
}

function setupWorktrees(
  repoRoot: string,
  baseSha: string,
  headSha: string,
): WorktreeSetup {
  const workDir = mkdtempSync(path.join(tmpdir(), "jittest-"));
  const parentDir = path.join(workDir, "parent");
  const childDir = path.join(workDir, "child");

  logger.info(`Setting up worktrees in ${workDir}`);

  execInDir(`git worktree add "${parentDir}" ${baseSha}`, repoRoot);
  execInDir(`git worktree add "${childDir}" ${headSha}`, repoRoot);

  logger.info("Worktrees created, installing dependencies");

  return {
    parentDir,
    childDir,
    cleanup: () => {
      logger.info("Cleaning up worktrees");
      try {
        execInDir(`git worktree remove "${parentDir}" --force`, repoRoot);
      } catch {
        logger.warn("Failed to remove parent worktree");
      }
      try {
        execInDir(`git worktree remove "${childDir}" --force`, repoRoot);
      } catch {
        logger.warn("Failed to remove child worktree");
      }
      try {
        rmSync(workDir, { recursive: true, force: true });
      } catch {
        logger.warn("Failed to remove temp directory");
      }
      return Promise.resolve();
    },
  };
}

function installDependencies(projectDir: string): void {
  logger.info(`Installing dependencies in ${projectDir}`);
  try {
    execInDir("npm ci --prefer-offline", projectDir);
  } catch {
    try {
      execInDir("pnpm install --frozen-lockfile", projectDir);
    } catch {
      execInDir("yarn install --frozen-lockfile", projectDir);
    }
  }
}

export { installDependencies, setupWorktrees };

import { access, readFile } from "node:fs/promises";
import path from "node:path";
import type { ChangedFile, DiffContext } from "../diff/types.js";

import { truncateContext } from "./intent-context.js";
import type { ProjectContext } from "./types.js";

async function pathExists(filePath: string): Promise<boolean> {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

function collectAvailableImports(
  diff: DiffContext,
  file: ChangedFile,
): readonly string[] {
  const imports = new Set(file.changedExports);

  for (const symbol of diff.changedSymbols) {
    if (symbol.filePath === file.path && symbol.exportType !== "internal") {
      imports.add(symbol.name);
    }
  }

  return [...imports].sort((a, b) => a.localeCompare(b));
}

async function readExistingTests(
  repoRoot: string,
  existingTestFile: string | null,
): Promise<string | null> {
  if (!existingTestFile) {
    return null;
  }

  try {
    return truncateContext(
      await readFile(path.join(repoRoot, existingTestFile), "utf-8"),
    );
  } catch {
    return null;
  }
}

async function resolveProjectContext(
  repoRoot: string,
  diff: DiffContext,
  file: ChangedFile,
): Promise<{
  existingTests: string | null;
  projectContext: ProjectContext;
}> {
  const tsConfigCandidates = ["tsconfig.json", "tsconfig.build.json"];
  let tsConfigPath: string | null = null;

  for (const candidate of tsConfigCandidates) {
    if (await pathExists(path.join(repoRoot, candidate))) {
      tsConfigPath = candidate;
      break;
    }
  }

  const packageJsonPath = (await pathExists(
    path.join(repoRoot, "package.json"),
  ))
    ? "package.json"
    : null;

  return {
    existingTests: await readExistingTests(repoRoot, file.existingTestFile),
    projectContext: {
      availableImports: collectAvailableImports(diff, file),
      tsConfigPath,
      packageJsonPath,
    },
  };
}

export { resolveProjectContext };

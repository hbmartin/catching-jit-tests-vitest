import { execSync } from "node:child_process";
import path from "node:path";

import type {
  ChangedFile,
  ChangedFunction,
  ChangedSymbol,
  DiffContext,
  DiffHunk,
} from "./types.js";

const hunkHeaderRegex = /^@@ -(\d+),?(\d*) \+(\d+),?(\d*) @@/;

function parseHunks(diffText: string): DiffHunk[] {
  const hunks: DiffHunk[] = [];
  const lines = diffText.split("\n");
  let currentHunk: DiffHunk | null = null;
  const contentLines: string[] = [];

  for (const line of lines) {
    const match = hunkHeaderRegex.exec(line);
    if (match) {
      if (currentHunk) {
        hunks.push({
          ...currentHunk,
          content: contentLines.join("\n"),
        });
        contentLines.length = 0;
      }
      currentHunk = {
        header: line,
        oldStart: Number.parseInt(match[1] ?? "0", 10),
        oldLines: Number.parseInt(match[2] ?? "1", 10),
        newStart: Number.parseInt(match[3] ?? "0", 10),
        newLines: Number.parseInt(match[4] ?? "1", 10),
        content: "",
      };
    } else if (currentHunk) {
      contentLines.push(line);
    }
  }

  if (currentHunk) {
    hunks.push({
      ...currentHunk,
      content: contentLines.join("\n"),
    });
  }

  return hunks;
}

function execGit(command: string, cwd?: string): string {
  return execSync(command, {
    cwd,
    encoding: "utf-8",
    maxBuffer: 10 * 1024 * 1024,
  }).trim();
}

function getChangedFilePaths(
  baseSha: string,
  headSha: string,
  cwd?: string,
): string[] {
  const output = execGit(`git diff --name-only ${baseSha}...${headSha}`, cwd);
  if (output.length === 0) {
    return [];
  }
  return output.split("\n").filter((f) => f.length > 0);
}

function getFileDiff(
  baseSha: string,
  headSha: string,
  filePath: string,
  cwd?: string,
): string {
  return execGit(`git diff ${baseSha}...${headSha} -- ${filePath}`, cwd);
}

function getFileAtCommit(
  sha: string,
  filePath: string,
  cwd?: string,
): string | null {
  try {
    return execGit(`git show ${sha}:${filePath}`, cwd);
  } catch {
    return null;
  }
}

function findExistingTestFile(filePath: string, cwd?: string): string | null {
  const { dir, name } = path.parse(filePath);
  const candidates = [
    path.join(dir, `${name}.test.ts`),
    path.join(dir, `${name}.spec.ts`),
    path.join("test", ...dir.split(path.sep).slice(1), `${name}.test.ts`),
    path.join("tests", ...dir.split(path.sep).slice(1), `${name}.test.ts`),
  ];

  for (const candidate of candidates) {
    try {
      const resolvedCwd = cwd ?? ".";
      execSync(`test -f ${path.join(resolvedCwd, candidate)}`, {
        encoding: "utf-8",
      });
      return candidate;
    } catch {
      // File doesn't exist, try next candidate
    }
  }

  return null;
}

const symbolDetectionPatterns: readonly {
  regex: RegExp;
  kind: ChangedSymbol["kind"];
}[] = [
  { regex: /(?:export\s+)?function\s+(\w+)/, kind: "function" },
  { regex: /(?:export\s+)?class\s+(\w+)/, kind: "class" },
  { regex: /(?:export\s+)?(?:const|let)\s+(\w+)/, kind: "variable" },
  { regex: /(?:export\s+)?type\s+(\w+)/, kind: "type" },
  { regex: /(?:export\s+)?interface\s+(\w+)/, kind: "interface" },
];

const sensitivityPatterns: ReadonlyArray<{
  pattern: RegExp;
  field:
    | "touchesAuth"
    | "touchesPayments"
    | "touchesDataModel"
    | "touchesAccessControl";
}> = [
  { pattern: /auth|login|session|token|jwt|oauth/i, field: "touchesAuth" },
  {
    pattern: /payment|billing|charge|stripe|subscription/i,
    field: "touchesPayments",
  },
  { pattern: /database|migration|schema|model/i, field: "touchesDataModel" },
  {
    pattern: /permission|role|rbac|acl|access/i,
    field: "touchesAccessControl",
  },
];

function detectSensitivity(
  filePath: string,
  diffContent: string,
): {
  touchesAuth: boolean;
  touchesPayments: boolean;
  touchesDataModel: boolean;
  touchesAccessControl: boolean;
} {
  const combined = `${filePath}\n${diffContent}`;
  return {
    touchesAuth: sensitivityPatterns.some(
      (p) => p.field === "touchesAuth" && p.pattern.test(combined),
    ),
    touchesPayments: sensitivityPatterns.some(
      (p) => p.field === "touchesPayments" && p.pattern.test(combined),
    ),
    touchesDataModel: sensitivityPatterns.some(
      (p) => p.field === "touchesDataModel" && p.pattern.test(combined),
    ),
    touchesAccessControl: sensitivityPatterns.some(
      (p) => p.field === "touchesAccessControl" && p.pattern.test(combined),
    ),
  };
}

function buildChangedFunctions(
  filePath: string,
  baseSha: string,
  headSha: string,
  hunks: readonly DiffHunk[],
  cwd?: string,
): ChangedFunction[] {
  const parentSource = getFileAtCommit(baseSha, filePath, cwd);
  const childSource = getFileAtCommit(headSha, filePath, cwd);

  if (!(parentSource && childSource)) {
    return [];
  }

  const functionRegex = /(?:export\s+)?(?:async\s+)?function\s+(\w+)/g;
  const functions: ChangedFunction[] = [];

  let match = functionRegex.exec(parentSource);
  while (match) {
    const fnName = match[1] ?? "unknown";
    functions.push({
      name: fnName,
      filePath,
      parentSource,
      childSource,
      hunks: [...hunks],
      signature: match[0],
      requiredImports: [],
      hasCoverage: false,
    });
    match = functionRegex.exec(parentSource);
  }

  return functions;
}

function extractChangedSymbols(
  filePath: string,
  diffContent: string,
): ChangedSymbol[] {
  const symbols: ChangedSymbol[] = [];
  const addedLines = diffContent
    .split("\n")
    .filter((l) => l.startsWith("+") && !l.startsWith("+++"))
    .map((l) => l.slice(1));

  const patterns = symbolDetectionPatterns;

  for (const line of addedLines) {
    for (const { regex, kind } of patterns) {
      const match = regex.exec(line);
      if (match?.[1]) {
        const isExported = line.includes("export");
        let exportType: ChangedSymbol["exportType"] = "internal";
        if (isExported) {
          exportType = line.includes("default") ? "default" : "named";
        }
        symbols.push({
          name: match[1],
          kind,
          filePath,
          exportType,
        });
      }
    }
  }

  return symbols;
}

function extractDiff(
  baseSha: string,
  headSha: string,
  prMeta: DiffContext["pr"],
  cwd?: string,
): DiffContext {
  const rawDiff = execGit(`git diff ${baseSha}...${headSha}`, cwd);

  const changedPaths = getChangedFilePaths(baseSha, headSha, cwd);
  const tsFiles = changedPaths.filter(
    (f) =>
      f.endsWith(".ts") &&
      !f.endsWith(".test.ts") &&
      !f.endsWith(".spec.ts") &&
      !f.includes("node_modules"),
  );

  const allSymbols: ChangedSymbol[] = [];
  const files: ChangedFile[] = tsFiles.map((filePath) => {
    const fileDiff = getFileDiff(baseSha, headSha, filePath, cwd);
    const hunks = parseHunks(fileDiff);
    const sensitivity = detectSensitivity(filePath, fileDiff);
    const symbols = extractChangedSymbols(filePath, fileDiff);
    allSymbols.push(...symbols);

    const changedFunctions = buildChangedFunctions(
      filePath,
      baseSha,
      headSha,
      hunks,
      cwd,
    );

    return {
      path: filePath,
      hunks,
      existingTestFile: findExistingTestFile(filePath, cwd),
      changedExports: symbols
        .filter((s) => s.exportType !== "internal")
        .map((s) => s.name),
      changedFunctions,
      ...sensitivity,
    };
  });

  return {
    rawDiff,
    pr: prMeta,
    files,
    riskScore: 0,
    changedSymbols: allSymbols,
  };
}

export {
  execGit,
  extractChangedSymbols,
  extractDiff,
  findExistingTestFile,
  getChangedFilePaths,
  getFileAtCommit,
  getFileDiff,
  parseHunks,
};

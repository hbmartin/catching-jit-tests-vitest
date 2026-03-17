import { access } from "node:fs/promises";
import path from "node:path";

import { CommandError, runCommand } from "../utils/process.js";

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

async function execGit(args: readonly string[], cwd?: string): Promise<string> {
  const result = await runCommand("git", args, {
    cwd,
    maxBuffer: 10 * 1024 * 1024,
  });

  return result.stdout.trimEnd();
}

async function getChangedFilePaths(
  baseSha: string,
  headSha: string,
  cwd?: string,
): Promise<string[]> {
  const output = await execGit(
    ["diff", "--name-only", `${baseSha}...${headSha}`],
    cwd,
  );
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
): Promise<string> {
  return execGit(["diff", `${baseSha}...${headSha}`, "--", filePath], cwd);
}

async function getFileAtCommit(
  sha: string,
  filePath: string,
  cwd?: string,
): Promise<string | null> {
  try {
    return await execGit(["show", `${sha}:${filePath}`], cwd);
  } catch (error) {
    if (error instanceof CommandError) {
      return null;
    }

    throw error;
  }
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function findExistingTestFile(
  filePath: string,
  cwd = ".",
): Promise<string | null> {
  const { dir, name } = path.parse(filePath);
  const candidates = [
    path.join(dir, `${name}.test.ts`),
    path.join(dir, `${name}.spec.ts`),
    path.join("test", ...dir.split(path.sep).slice(1), `${name}.test.ts`),
    path.join("tests", ...dir.split(path.sep).slice(1), `${name}.test.ts`),
  ];

  for (const candidate of candidates) {
    if (await fileExists(path.join(cwd, candidate))) {
      return candidate;
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

async function buildChangedFunctions(
  filePath: string,
  baseSha: string,
  headSha: string,
  hunks: readonly DiffHunk[],
  cwd?: string,
): Promise<ChangedFunction[]> {
  const [parentSource, childSource] = await Promise.all([
    getFileAtCommit(baseSha, filePath, cwd),
    getFileAtCommit(headSha, filePath, cwd),
  ]);

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

async function extractDiff(
  baseSha: string,
  headSha: string,
  prMeta: DiffContext["pr"],
  cwd?: string,
): Promise<DiffContext> {
  const rawDiff = await execGit(["diff", `${baseSha}...${headSha}`], cwd);

  const changedPaths = await getChangedFilePaths(baseSha, headSha, cwd);
  const tsFiles = changedPaths.filter(
    (f) =>
      f.endsWith(".ts") &&
      !f.endsWith(".test.ts") &&
      !f.endsWith(".spec.ts") &&
      !f.includes("node_modules"),
  );

  const parsedFiles = await Promise.all(
    tsFiles.map(async (filePath) => {
      const fileDiff = await getFileDiff(baseSha, headSha, filePath, cwd);
      const hunks = parseHunks(fileDiff);
      const sensitivity = detectSensitivity(filePath, fileDiff);
      const symbols = extractChangedSymbols(filePath, fileDiff);
      const [existingTestFile, changedFunctions] = await Promise.all([
        findExistingTestFile(filePath, cwd ?? "."),
        buildChangedFunctions(filePath, baseSha, headSha, hunks, cwd),
      ]);

      return {
        file: {
          path: filePath,
          hunks,
          existingTestFile,
          changedExports: symbols
            .filter((s) => s.exportType !== "internal")
            .map((s) => s.name),
          changedFunctions,
          ...sensitivity,
        } satisfies ChangedFile,
        symbols,
      };
    }),
  );

  const files = parsedFiles.map((entry) => entry.file);
  const allSymbols = parsedFiles.flatMap((entry) => entry.symbols);

  return {
    rawDiff,
    pr: prMeta,
    files,
    riskScore: 0,
    riskFactors: {
      sensitivityScore: 0,
      complexityScore: 0,
      coverageGap: 0,
      defectHistory: 0,
    },
    riskReasons: [],
    changedSymbols: allSymbols,
  };
}

function extractDiffContext(options: {
  baseRef: string;
  headRef: string;
  cwd: string;
}): Promise<DiffContext> {
  return extractDiff(
    options.baseRef,
    options.headRef,
    {
      title: "",
      body: "",
      branch: options.headRef,
      baseSha: options.baseRef,
      headSha: options.headRef,
    },
    options.cwd,
  );
}

export {
  execGit,
  extractChangedSymbols,
  extractDiff,
  extractDiffContext,
  findExistingTestFile,
  getChangedFilePaths,
  getFileAtCommit,
  getFileDiff,
  parseHunks,
};

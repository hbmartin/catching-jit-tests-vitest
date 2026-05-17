import { stat } from "node:fs/promises";
import path from "node:path";
import picomatch from "picomatch";

import { defaultExcludePatterns, defaultIncludePatterns } from "../config.js";
import { CommandError, runCommand } from "../utils/process.js";

import { analyzeFileChanges } from "./ast-analyzer.js";
import type {
  ChangedFile,
  ChangedFunction,
  ChangedSymbol,
  DiffContext,
  DiffHunk,
  FunctionInfo,
} from "./types.js";

const hunkHeaderRegex = /^@@ -(\d+),?(\d*) \+(\d+),?(\d*) @@/;
const globOptions = { dot: true } as const;
interface DiffFileFilters {
  readonly include: readonly string[];
  readonly exclude: readonly string[];
}

function parseHunkLineCount(value: string | undefined): number {
  if (value === undefined || value.length === 0) {
    return 1;
  }

  return Number.parseInt(value, 10);
}

function globToRegExp(pattern: string): RegExp {
  return picomatch.makeRe(pattern.replaceAll("\\", "/"), globOptions);
}

function matchesAnyGlob(
  filePath: string,
  patterns: readonly string[],
): boolean {
  const normalizedPath = filePath.replaceAll("\\", "/");
  return picomatch.isMatch(
    normalizedPath,
    patterns.map((pattern) => pattern.replaceAll("\\", "/")),
    globOptions,
  );
}

function matchesFileFilters(
  filePath: string,
  filters: Partial<DiffFileFilters> = {},
): boolean {
  const includePatterns =
    filters.include && filters.include.length > 0
      ? filters.include
      : defaultIncludePatterns;
  const excludePatterns =
    filters.exclude && filters.exclude.length > 0
      ? filters.exclude
      : defaultExcludePatterns;

  return (
    matchesAnyGlob(filePath, includePatterns) &&
    !matchesAnyGlob(filePath, excludePatterns)
  );
}

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
        oldLines: parseHunkLineCount(match[2]),
        newStart: Number.parseInt(match[3] ?? "0", 10),
        newLines: parseHunkLineCount(match[4]),
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
    const fileStats = await stat(filePath);
    return fileStats.isFile();
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

  if (!childSource) {
    return [];
  }

  const parentText = parentSource ?? "";
  const childText = childSource;
  const analysis = analyzeFileChanges(parentText, childText, filePath);
  const parentFunctions = indexFunctionsByMatchKey(analysis.parentFunctions);
  const childFunctions = indexFunctionsByMatchKey(analysis.childFunctions);

  return resolveChangedFunctions({
    filePath,
    modifiedFunctions: analysis.modifiedFunctions,
    parentFunctions,
    childFunctions,
    parentText,
    childText,
    hunks,
  });
}

function indexFunctionsByMatchKey(
  functions: readonly FunctionInfo[],
): Map<string, FunctionInfo> {
  return new Map(functions.map((fn) => [fn.matchKey, fn]));
}

function resolveChangedFunctions(input: {
  filePath: string;
  modifiedFunctions: readonly FunctionInfo[];
  parentFunctions: ReadonlyMap<string, FunctionInfo>;
  childFunctions: ReadonlyMap<string, FunctionInfo>;
  parentText: string;
  childText: string;
  hunks: readonly DiffHunk[];
}): ChangedFunction[] {
  return input.modifiedFunctions.map((fn) => {
    const parentMatch = input.parentFunctions.get(fn.matchKey);
    const childMatch = input.childFunctions.get(fn.matchKey) ?? fn;

    return {
      name: fn.name,
      filePath: input.filePath,
      parentSource: parentMatch?.body ?? "",
      childSource: childMatch.body,
      parentFileSource: input.parentText,
      childFileSource: input.childText,
      hunks: [...input.hunks],
      signature: childMatch.signature,
      requiredImports: [],
      hasCoverage: false,
    };
  });
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
          exportType = line.includes("export default ") ? "default" : "named";
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
  filters: Partial<DiffFileFilters> = {},
): Promise<DiffContext> {
  const changedPaths = await getChangedFilePaths(baseSha, headSha, cwd);
  const matchedFiles = changedPaths.filter((filePath) =>
    matchesFileFilters(filePath, filters),
  );

  const parsedFiles = await Promise.all(
    matchedFiles.map(async (filePath) => {
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
        fileDiff,
      };
    }),
  );

  const rawDiff = parsedFiles.map((entry) => entry.fileDiff).join("\n");
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
  prTitle?: string;
  prBody?: string;
  include?: readonly string[];
  exclude?: readonly string[];
}): Promise<DiffContext> {
  return extractDiff(
    options.baseRef,
    options.headRef,
    {
      title: options.prTitle ?? "",
      body: options.prBody ?? "",
      branch: options.headRef,
      baseSha: options.baseRef,
      headSha: options.headRef,
    },
    options.cwd,
    {
      include: options.include,
      exclude: options.exclude,
    },
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
  globToRegExp,
  matchesFileFilters,
  parseHunks,
  resolveChangedFunctions,
};

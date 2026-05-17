import { describe, expect, it } from "vitest";
import {
  extractChangedSymbols,
  parseHunks,
  resolveChangedFunctions,
} from "../../source/diff/extractor.js";
import type { FunctionInfo } from "../../source/diff/types.js";

describe("parseHunks", () => {
  it("parses a simple unified diff", () => {
    const diff = `--- a/file.ts
+++ b/file.ts
@@ -1,5 +1,6 @@
 line1
-line2
+line2modified
+newline
 line3
 line4`;

    const hunks = parseHunks(diff);
    expect(hunks).toHaveLength(1);
    expect(hunks[0]?.oldStart).toBe(1);
    expect(hunks[0]?.oldLines).toBe(5);
    expect(hunks[0]?.newStart).toBe(1);
    expect(hunks[0]?.newLines).toBe(6);
    expect(hunks[0]?.content).toContain("-line2");
    expect(hunks[0]?.content).toContain("+line2modified");
  });

  it("handles multiple hunks", () => {
    const diff = `@@ -1,3 +1,3 @@
 a
-b
+c
 d
@@ -10,3 +10,3 @@
 x
-y
+z
 w`;

    const hunks = parseHunks(diff);
    expect(hunks).toHaveLength(2);
    expect(hunks[0]?.oldStart).toBe(1);
    expect(hunks[1]?.oldStart).toBe(10);
  });

  it("returns empty array for empty diff", () => {
    const hunks = parseHunks("");
    expect(hunks).toHaveLength(0);
  });

  it("defaults omitted single-line hunk counts to one", () => {
    const diff = `@@ -5 +5 @@
 old
-old
+new`;

    const hunks = parseHunks(diff);
    expect(hunks[0]?.oldLines).toBe(1);
    expect(hunks[0]?.newLines).toBe(1);
  });
});

describe("extractChangedSymbols", () => {
  it("detects added functions", () => {
    const diffContent = `+export function newHelper(x: number): string {
+  return String(x);
+}`;

    const symbols = extractChangedSymbols(
      "source/utils/helper.ts",
      diffContent,
    );
    expect(symbols).toHaveLength(1);
    expect(symbols[0]?.name).toBe("newHelper");
    expect(symbols[0]?.kind).toBe("function");
    expect(symbols[0]?.exportType).toBe("named");
  });

  it("detects added classes", () => {
    const diffContent = `+export class UserService {
+  private readonly db: Database;
+}`;

    const symbols = extractChangedSymbols(
      "source/services/user.ts",
      diffContent,
    );
    expect(symbols).toHaveLength(1);
    expect(symbols[0]?.name).toBe("UserService");
    expect(symbols[0]?.kind).toBe("class");
  });

  it("detects internal (non-exported) symbols", () => {
    const diffContent = "+function internalHelper() {}";

    const symbols = extractChangedSymbols("source/utils.ts", diffContent);
    expect(symbols).toHaveLength(1);
    expect(symbols[0]?.exportType).toBe("internal");
  });

  it("ignores unchanged lines", () => {
    const diffContent = ` function existing() {}
-function removed() {}`;

    const symbols = extractChangedSymbols("source/file.ts", diffContent);
    expect(symbols).toHaveLength(0);
  });

  it("does not treat named exports containing default as default exports", () => {
    const diffContent = "+export function defaultHandler() {}";

    const symbols = extractChangedSymbols("source/file.ts", diffContent);
    expect(symbols[0]?.exportType).toBe("named");
  });
});

describe("resolveChangedFunctions", () => {
  it("matches duplicate function names by occurrence key", () => {
    const modifiedFunctions: FunctionInfo[] = [
      {
        name: "helper",
        matchKey: "helper:2",
        body: 'function helper() { return "three"; }',
        signature: "function helper()",
        startLine: 10,
        endLine: 12,
      },
    ];
    const parentFunctions = new Map<string, FunctionInfo>([
      [
        "helper:1",
        {
          name: "helper",
          matchKey: "helper:1",
          body: 'function helper() { return "one"; }',
          signature: "function helper()",
          startLine: 2,
          endLine: 4,
        },
      ],
      [
        "helper:2",
        {
          name: "helper",
          matchKey: "helper:2",
          body: 'function helper() { return "two"; }',
          signature: "function helper()",
          startLine: 10,
          endLine: 12,
        },
      ],
    ]);
    const childFunctions = new Map<string, FunctionInfo>([
      [
        "helper:1",
        {
          name: "helper",
          matchKey: "helper:1",
          body: 'function helper() { return "one"; }',
          signature: "function helper()",
          startLine: 2,
          endLine: 4,
        },
      ],
      [
        "helper:2",
        {
          name: "helper",
          matchKey: "helper:2",
          body: 'function helper() { return "three"; }',
          signature: "function helper()",
          startLine: 10,
          endLine: 12,
        },
      ],
    ]);

    const changedFunctions = resolveChangedFunctions({
      filePath: "source/file.ts",
      modifiedFunctions,
      parentFunctions,
      childFunctions,
      parentText: "parent source",
      childText: "child source",
      hunks: [],
    });

    expect(changedFunctions[0]?.parentSource).toContain(`return "two"`);
    expect(changedFunctions[0]?.childSource).toContain(`return "three"`);
  });
});

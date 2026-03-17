import { describe, expect, it } from "vitest";

import {
  extractChangedSymbols,
  parseHunks,
} from "../../source/diff/extractor.js";

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
});

describe("extractChangedSymbols", () => {
  it("detects added functions", () => {
    const diffContent = `+export function newHelper(x: number): string {
+  return String(x);
+}`;

    const symbols = extractChangedSymbols("source/utils/helper.ts", diffContent);
    expect(symbols).toHaveLength(1);
    expect(symbols[0]?.name).toBe("newHelper");
    expect(symbols[0]?.kind).toBe("function");
    expect(symbols[0]?.exportType).toBe("named");
  });

  it("detects added classes", () => {
    const diffContent = `+export class UserService {
+  private readonly db: Database;
+}`;

    const symbols = extractChangedSymbols("source/services/user.ts", diffContent);
    expect(symbols).toHaveLength(1);
    expect(symbols[0]?.name).toBe("UserService");
    expect(symbols[0]?.kind).toBe("class");
  });

  it("detects internal (non-exported) symbols", () => {
    const diffContent = `+function internalHelper() {}`;

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
});

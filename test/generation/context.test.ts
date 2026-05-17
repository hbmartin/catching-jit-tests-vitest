import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

import type { ChangedFile, DiffContext } from "../../source/diff/types.js";
import { resolveProjectContext } from "../../source/generation/context.js";
import { maxContextFileBytes } from "../../source/generation/intent-context.js";

function makeDiff(): DiffContext {
  return {
    rawDiff: "",
    pr: { title: "", body: "", branch: "", baseSha: "", headSha: "" },
    files: [],
    riskScore: 0,
    changedSymbols: [],
  };
}

function makeFile(existingTestFile: string | null): ChangedFile {
  return {
    path: "source/example.ts",
    hunks: [],
    existingTestFile,
    changedExports: [],
    changedFunctions: [],
    touchesAuth: false,
    touchesPayments: false,
    touchesDataModel: false,
    touchesAccessControl: false,
  };
}

describe("resolveProjectContext", () => {
  it("bounds existing test content before prompt insertion", async () => {
    const repoRoot = await mkdtemp(path.join(tmpdir(), "jittest-context-"));
    const testPath = path.join(repoRoot, "test", "example.test.ts");
    await mkdir(path.dirname(testPath), { recursive: true });
    await writeFile(testPath, "x".repeat(maxContextFileBytes + 1), "utf-8");

    const result = await resolveProjectContext(
      repoRoot,
      makeDiff(),
      makeFile("test/example.test.ts"),
    );

    expect(result.existingTests).toContain("[truncated]");
    expect(
      Buffer.byteLength(
        result.existingTests?.split("\n...[truncated]")[0] ?? "",
        "utf8",
      ),
    ).toBeLessThanOrEqual(maxContextFileBytes);
  });
});

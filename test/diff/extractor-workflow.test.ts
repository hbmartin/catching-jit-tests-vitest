import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

const tempDirs: string[] = [];

afterEach(async () => {
  vi.resetModules();
  vi.clearAllMocks();

  await Promise.all(
    tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })),
  );
});

describe("extractDiffContext", () => {
  it("builds a filtered diff context from git output", async () => {
    const repoRoot = await mkdtemp(path.join(tmpdir(), "jittest-extractor-"));
    tempDirs.push(repoRoot);
    await mkdir(path.join(repoRoot, "source"), { recursive: true });
    await writeFile(
      path.join(repoRoot, "source", "auth.test.ts"),
      "it('covers auth', () => {});\n",
      "utf-8",
    );

    const parentSource = `export function canLogin(user: { active: boolean; role?: string }): boolean {
  return user.active;
}
`;
    const childSource = `export function canLogin(user: { active: boolean; role?: string }): boolean {
  return user.active && user.role === "admin";
}
`;
    const fileDiff = `diff --git a/source/auth.ts b/source/auth.ts
--- a/source/auth.ts
+++ b/source/auth.ts
@@ -1,3 +1,3 @@
-export function canLogin(user: { active: boolean; role?: string }): boolean {
+export function canLogin(user: { active: boolean; role?: string }): boolean {
-  return user.active;
+  return user.active && user.role === "admin";
 }
`;
    const runCommandMock = vi.fn(
      async (_command: string, args: readonly string[]) => {
        if (args[0] === "diff" && args[1] === "--name-only") {
          return {
            stdout: "source/auth.ts\nsource/auth.test.ts\ndocs/readme.md\n",
            stderr: "",
          };
        }

        if (args[0] === "diff" && args.includes("--")) {
          return {
            stdout: fileDiff,
            stderr: "",
          };
        }

        if (args[0] === "show" && args[1] === "base:source/auth.ts") {
          return {
            stdout: parentSource,
            stderr: "",
          };
        }

        if (args[0] === "show" && args[1] === "head:source/auth.ts") {
          return {
            stdout: childSource,
            stderr: "",
          };
        }

        throw new Error(`Unexpected git args: ${args.join(" ")}`);
      },
    );

    vi.doMock("../../source/utils/process.js", async () => {
      const actual = await vi.importActual<
        typeof import("../../source/utils/process.js")
      >("../../source/utils/process.js");

      return {
        ...actual,
        runCommand: runCommandMock,
      };
    });

    const { extractDiffContext } = await import(
      "../../source/diff/extractor.js"
    );
    const result = await extractDiffContext({
      baseRef: "base",
      headRef: "head",
      cwd: repoRoot,
      prTitle: "Restrict login",
      prBody: "Require admins",
      include: ["source/**/*.ts"],
      exclude: ["**/*.test.ts"],
    });

    expect(result.pr).toMatchObject({
      title: "Restrict login",
      body: "Require admins",
      branch: "head",
      baseSha: "base",
      headSha: "head",
    });
    expect(result.files).toHaveLength(1);
    expect(result.files[0]).toMatchObject({
      path: "source/auth.ts",
      existingTestFile: "source/auth.test.ts",
      changedExports: ["canLogin"],
      touchesAuth: true,
      touchesAccessControl: true,
    });
    expect(result.files[0]?.hunks).toHaveLength(1);
    expect(result.files[0]?.changedFunctions[0]).toMatchObject({
      name: "canLogin",
      parentSource: expect.stringContaining("return user.active;"),
      childSource: expect.stringContaining('user.role === "admin"'),
    });
    expect(result.changedSymbols).toEqual([
      {
        name: "canLogin",
        kind: "function",
        filePath: "source/auth.ts",
        exportType: "named",
      },
    ]);
    expect(result.rawDiff).toContain("source/auth.ts");
  });
});

describe("getFileAtCommit", () => {
  it("returns null for git show command errors", async () => {
    vi.doMock("../../source/utils/process.js", async () => {
      const actual = await vi.importActual<
        typeof import("../../source/utils/process.js")
      >("../../source/utils/process.js");

      return {
        ...actual,
        runCommand: vi.fn().mockRejectedValue(
          new actual.CommandError("Command failed: git show", {
            stdout: "",
            stderr: "fatal: path not found",
            exitCode: 128,
            errorCode: null,
            cause: new Error("missing"),
          }),
        ),
      };
    });

    const { getFileAtCommit } = await import("../../source/diff/extractor.js");

    await expect(getFileAtCommit("base", "missing.ts", "/repo")).resolves.toBe(
      null,
    );
  });
});

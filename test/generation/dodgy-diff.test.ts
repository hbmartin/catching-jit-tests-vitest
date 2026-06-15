import { describe, expect, it, vi } from "vitest";

import type { JiTTestConfig } from "../../source/config.js";
import type { DiffContext } from "../../source/diff/types.js";
import { dodgyDiffWorkflow } from "../../source/generation/dodgy-diff.js";
import type { LLMClient } from "../../source/utils/llm-client.js";

const makeLLM = (): LLMClient =>
  ({
    complete: vi.fn().mockResolvedValue({
      content:
        "```typescript\nit('detects the behavior change', () => {});\n```",
      usage: {
        inputTokens: 1,
        outputTokens: 1,
      },
    }),
    isBudgetExhausted: vi.fn().mockReturnValue(false),
  }) as unknown as LLMClient;

const diff: DiffContext = {
  rawDiff: "-return user.active;\n+return false;",
  pr: {
    title: "Change auth behavior",
    body: "",
    branch: "feature",
    baseSha: "base",
    headSha: "head",
  },
  files: [
    {
      path: "source/auth.ts",
      hunks: [
        {
          header: "@@ -1,3 +1,3 @@",
          oldStart: 1,
          oldLines: 3,
          newStart: 1,
          newLines: 3,
          content: "-return user.active;\n+return false;",
        },
      ],
      existingTestFile: null,
      changedExports: ["isAllowed"],
      changedFunctions: [
        {
          name: "isAllowed",
          filePath: "source/auth.ts",
          parentSource:
            "export function isAllowed(user: { active: boolean }) { return user.active; }",
          childSource:
            "export function isAllowed(user: { active: boolean }) { return false; }",
          parentFileSource:
            "export function isAllowed(user: { active: boolean }) { return user.active; }",
          childFileSource:
            "export function isAllowed(user: { active: boolean }) { return false; }",
          hunks: [],
          signature: "function isAllowed(user: { active: boolean })",
          requiredImports: [],
          hasCoverage: false,
        },
      ],
      touchesAuth: true,
      touchesPayments: false,
      touchesDataModel: false,
      touchesAccessControl: true,
    },
  ],
  riskScore: 1,
  changedSymbols: [
    {
      name: "isAllowed",
      kind: "function",
      filePath: "source/auth.ts",
      exportType: "named",
    },
  ],
};

describe("dodgyDiffWorkflow", () => {
  it("generates tagged candidates for every changed function", async () => {
    const tests = await dodgyDiffWorkflow(diff, process.cwd(), makeLLM(), {
      testsPerFunction: 2,
    } as JiTTestConfig);

    expect(tests).toHaveLength(2);
    expect(tests.every((test) => test.workflow === "dodgy-diff")).toBe(true);
    expect(tests[0]?.behaviorDescription).toContain("Change in isAllowed");
    expect(tests[0]?.testFilePath).toMatch(
      /^source\/auth\.[a-f0-9]{8}\.jittest\.test\.ts$/,
    );
  });
});

import { afterEach, describe, expect, it, vi } from "vitest";

import type { JiTTestConfig } from "../../source/config.js";
import type { DiffContext } from "../../source/diff/types.js";
import type { InferredRisk } from "../../source/generation/types.js";
import type { LLMClient } from "../../source/utils/llm-client.js";

afterEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
});

const makeRisk = (overrides: Partial<InferredRisk> = {}): InferredRisk => ({
  id: "risk-1",
  description: "Admin access can be bypassed",
  targetSymbol: "AuthService.isAllowed",
  filePath: null,
  severity: "high",
  mutantHint: "return true",
  ...overrides,
});

const makeDiff = (risksTargetFile = true): DiffContext => ({
  rawDiff: "+return user.role === 'admin';",
  additionalContext: "Security policy requires admin checks.",
  pr: {
    title: "Tighten access",
    body: "Only admins should pass.",
    branch: "feature",
    baseSha: "base",
    headSha: "head",
  },
  files: [
    {
      path: "source/auth.ts",
      hunks: [],
      existingTestFile: null,
      changedExports: ["isAllowed"],
      changedFunctions: risksTargetFile
        ? [
            {
              name: "AuthService.isAllowed",
              filePath: "source/auth.ts",
              parentSource:
                "export function isAllowed(user: { role: string }) { return true; }",
              childSource:
                "export function isAllowed(user: { role: string }) { return user.role === 'admin'; }",
              parentFileSource:
                "export function isAllowed(user: { role: string }) { return true; }",
              childFileSource:
                "export function isAllowed(user: { role: string }) { return user.role === 'admin'; }",
              hunks: [],
              signature: "function isAllowed(user: { role: string })",
              requiredImports: [],
              hasCoverage: false,
            },
          ]
        : [],
      touchesAuth: true,
      touchesPayments: false,
      touchesDataModel: false,
      touchesAccessControl: true,
    },
  ],
  riskScore: 1,
  changedSymbols: risksTargetFile
    ? [
        {
          name: "isAllowed",
          kind: "function",
          filePath: "source/auth.ts",
          exportType: "named",
        },
      ]
    : [],
});

const makeLLM = (risks: readonly InferredRisk[]): LLMClient => {
  const completions = [
    "```typescript\nexport function isAllowed(user: { role: string }) { return true; }\n```",
    "```typescript\nit('rejects non-admin users', () => {});\n```",
  ];

  return {
    completeJson: vi.fn().mockResolvedValue({
      intent: "Restrict access to admins",
      risks,
    }),
    complete: vi.fn().mockImplementation(async () => ({
      content: completions.shift() ?? "it('passes', () => {});",
      usage: {
        inputTokens: 1,
        outputTokens: 1,
      },
    })),
  } as unknown as LLMClient;
};

describe("inferDiffRisks", () => {
  it("returns an empty inference when the model response fails", async () => {
    const { inferDiffRisks } = await import(
      "../../source/generation/intent-aware.js"
    );
    const llm = {
      completeJson: vi.fn().mockRejectedValue(new Error("bad json")),
    } as unknown as LLMClient;

    await expect(inferDiffRisks(makeDiff(), llm)).resolves.toEqual({
      intent: "",
      risks: [],
    });
  });
});

describe("intentAwareWorkflow", () => {
  it("skips generation when no risks are inferred", async () => {
    const { intentAwareWorkflow } = await import(
      "../../source/generation/intent-aware.js"
    );

    const tests = await intentAwareWorkflow(
      makeDiff(),
      process.cwd(),
      makeLLM([]),
      { testsPerFunction: 1 } as JiTTestConfig,
    );

    expect(tests).toEqual([]);
  });

  it("generates intent-aware tests for normalized risk targets", async () => {
    const getFileAtCommitMock = vi
      .fn()
      .mockResolvedValue(
        "export function isAllowed(user: { role: string }) { return user.role === 'admin'; }",
      );
    vi.doMock("../../source/diff/extractor.js", async () => {
      const actual = await vi.importActual<
        typeof import("../../source/diff/extractor.js")
      >("../../source/diff/extractor.js");

      return {
        ...actual,
        getFileAtCommit: getFileAtCommitMock,
      };
    });

    const { intentAwareWorkflow } = await import(
      "../../source/generation/intent-aware.js"
    );
    const tests = await intentAwareWorkflow(
      makeDiff(),
      process.cwd(),
      makeLLM([makeRisk()]),
      { testsPerFunction: 1 } as JiTTestConfig,
    );

    expect(getFileAtCommitMock).toHaveBeenCalledWith(
      "base",
      "source/auth.ts",
      process.cwd(),
    );
    expect(tests).toHaveLength(1);
    expect(tests[0]).toMatchObject({
      workflow: "intent-aware",
      inferredIntent: "Restrict access to admins",
      mutantValidation: {
        targetFilePath: "source/auth.ts",
      },
    });
    expect(tests[0]?.behaviorDescription).toContain(
      "[Risk: Admin access can be bypassed]",
    );
  });

  it("falls back to the head source when the base source is unavailable", async () => {
    const getFileAtCommitMock = vi
      .fn()
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(
        "export function isAllowed(user: { role: string }) { return user.role === 'admin'; }",
      );
    vi.doMock("../../source/diff/extractor.js", async () => {
      const actual = await vi.importActual<
        typeof import("../../source/diff/extractor.js")
      >("../../source/diff/extractor.js");

      return {
        ...actual,
        getFileAtCommit: getFileAtCommitMock,
      };
    });

    const { intentAwareWorkflow } = await import(
      "../../source/generation/intent-aware.js"
    );
    const tests = await intentAwareWorkflow(
      makeDiff(),
      process.cwd(),
      makeLLM([makeRisk({ targetSymbol: "isAllowed" })]),
      { testsPerFunction: 1 } as JiTTestConfig,
    );

    expect(getFileAtCommitMock).toHaveBeenNthCalledWith(
      1,
      "base",
      "source/auth.ts",
      process.cwd(),
    );
    expect(getFileAtCommitMock).toHaveBeenNthCalledWith(
      2,
      "head",
      "source/auth.ts",
      process.cwd(),
    );
    expect(tests).toHaveLength(1);
  });

  it("returns no tests when an explicit risk file path excludes the changed file", async () => {
    const getFileAtCommitMock = vi.fn();
    vi.doMock("../../source/diff/extractor.js", async () => {
      const actual = await vi.importActual<
        typeof import("../../source/diff/extractor.js")
      >("../../source/diff/extractor.js");

      return {
        ...actual,
        getFileAtCommit: getFileAtCommitMock,
      };
    });

    const { intentAwareWorkflow } = await import(
      "../../source/generation/intent-aware.js"
    );
    const tests = await intentAwareWorkflow(
      makeDiff(),
      process.cwd(),
      makeLLM([makeRisk({ filePath: "source/other.ts" })]),
      { testsPerFunction: 1 } as JiTTestConfig,
    );

    expect(tests).toEqual([]);
    expect(getFileAtCommitMock).not.toHaveBeenCalled();
  });

  it("returns no tests when a risk target cannot be matched", async () => {
    const { intentAwareWorkflow } = await import(
      "../../source/generation/intent-aware.js"
    );

    const tests = await intentAwareWorkflow(
      makeDiff(false),
      process.cwd(),
      makeLLM([makeRisk({ targetSymbol: "missingTarget" })]),
      { testsPerFunction: 1 } as JiTTestConfig,
    );

    expect(tests).toEqual([]);
  });
});

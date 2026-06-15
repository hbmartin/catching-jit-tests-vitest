import { describe, expect, it, vi } from "vitest";

import {
  computeInlineDiff,
  deriveTestFilePath,
  extractCodeBlock,
  shouldUseBoundedInlineDiff,
  synthesizeMultipleTests,
  synthesizeTest,
} from "../../source/generation/test-synthesizer.js";
import type { TestSynthesisRequest } from "../../source/generation/types.js";
import type { LLMClient } from "../../source/utils/llm-client.js";

const makeRequest = (
  overrides: Partial<TestSynthesisRequest> = {},
): TestSynthesisRequest => ({
  targetSource:
    "export function isAllowed(user: { active: boolean }) { return user.active; }",
  targetPath: "source/auth.ts",
  fullFileSource:
    "export function isAllowed(user: { active: boolean }) { return false; }",
  existingTests: "it('covers existing behavior', () => {});",
  targetBehavior: {
    kind: "mutant",
    mutantDiff: "-return user.active;\n+return false;",
    mutantDescription: "Boolean behavior changed",
  },
  projectContext: {
    availableImports: ["isAllowed"],
    tsConfigPath: "tsconfig.json",
    packageJsonPath: "package.json",
  },
  targetSymbol: "isAllowed",
  workflow: "dodgy-diff",
  candidateKey: "source/auth.ts:isAllowed",
  ...overrides,
});

const makeLLM = (responses: Array<string | Error>): LLMClient => {
  const complete = vi.fn().mockImplementation(async () => {
    const response = responses.shift();
    if (response instanceof Error) {
      throw response;
    }

    return {
      content: response ?? "it('passes', () => {});",
      usage: {
        inputTokens: 1,
        outputTokens: 1,
      },
    };
  });

  return {
    complete,
    isBudgetExhausted: vi.fn().mockReturnValue(false),
  } as unknown as LLMClient;
};

describe("shouldUseBoundedInlineDiff", () => {
  it("switches to the bounded diff path for large inputs", () => {
    expect(shouldUseBoundedInlineDiff(500, 500)).toBe(true);
    expect(shouldUseBoundedInlineDiff(20, 20)).toBe(false);
  });
});

describe("computeInlineDiff", () => {
  it("uses the LCS path for small edits", () => {
    expect(computeInlineDiff("a\nb\nc", "a\nx\nc\nd")).toBe(
      " a\n-b\n+x\n c\n+d",
    );
  });

  it("preserves shared prefix and suffix when diffing large files", () => {
    const prefix = Array.from({ length: 250 }, (_, index) => `start-${index}`);
    const suffix = Array.from({ length: 250 }, (_, index) => `end-${index}`);
    const parent = [...prefix, "old-value", ...suffix].join("\n");
    const child = [...prefix, "new-value", ...suffix].join("\n");

    const diff = computeInlineDiff(parent, child);

    expect(diff).toContain(" start-0");
    expect(diff).toContain("-old-value");
    expect(diff).toContain("+new-value");
    expect(diff).toContain(" end-249");
  });
});

describe("extractCodeBlock", () => {
  it("extracts typed and generic fenced blocks", () => {
    expect(extractCodeBlock("```typescript\nconst x = 1;\n```")).toBe(
      "const x = 1;",
    );
    expect(extractCodeBlock("```\nconst y = 2;\n```")).toBe("const y = 2;");
  });

  it("falls back to trimmed raw text", () => {
    expect(extractCodeBlock("  const z = 3;  ")).toBe("const z = 3;");
  });
});

describe("deriveTestFilePath", () => {
  it("places generated tests beside the target source", () => {
    expect(deriveTestFilePath("source/auth.ts", "abc123")).toBe(
      "source/auth.abc123.jittest.test.ts",
    );
  });
});

describe("synthesizeTest", () => {
  it("builds a generated test from fenced model output", async () => {
    const llm = makeLLM([
      "```typescript\nimport { describe, it } from 'vitest';\nit('kills the mutant', () => {});\n```",
    ]);

    const result = await synthesizeTest(makeRequest(), llm);

    expect(result).toMatchObject({
      code: "import { describe, it } from 'vitest';\nit('kills the mutant', () => {});",
      targetSymbol: "isAllowed",
      behaviorDescription: "Boolean behavior changed",
      workflow: "dodgy-diff",
      generatorConfidence: 0.7,
    });
    expect(result?.testFilePath).toMatch(
      /^source\/auth\.[a-f0-9]{8}\.jittest\.test\.ts$/,
    );
  });

  it("uses risk descriptions for risk-targeted synthesis", async () => {
    const llm = makeLLM(["it('covers risk', () => {});"]);

    const result = await synthesizeTest(
      makeRequest({
        targetBehavior: {
          kind: "risk",
          riskDescription: "Preserve admin access checks",
          prDiff: "+return user.role === 'admin';",
        },
        workflow: "intent-aware",
      }),
      llm,
    );

    expect(result?.behaviorDescription).toBe("Preserve admin access checks");
    expect(result?.workflow).toBe("intent-aware");
  });

  it("returns null for empty or failed model output", async () => {
    await expect(synthesizeTest(makeRequest(), makeLLM(["   "]))).resolves.toBe(
      null,
    );
    await expect(
      synthesizeTest(makeRequest(), makeLLM([new Error("provider failed")])),
    ).resolves.toBe(null);
  });
});

describe("synthesizeMultipleTests", () => {
  it("requests multiple candidate keys and skips failed generations", async () => {
    const llm = makeLLM(["it('first', () => {});", new Error("bad second")]);

    const result = await synthesizeMultipleTests(makeRequest(), llm, 2);

    expect(result).toHaveLength(1);
    expect(result[0]?.code).toBe("it('first', () => {});");
  });
});

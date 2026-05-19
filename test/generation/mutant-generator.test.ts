import { afterEach, describe, expect, it, vi } from "vitest";

import {
  generateRiskMutant,
  looksLikeSourceCode,
} from "../../source/generation/mutant-generator.js";
import type { InferredRisk } from "../../source/generation/types.js";
import type { LLMClient } from "../../source/utils/llm-client.js";

const parentSource =
  "export function isAllowed(user: { role: string }) { return user.role === 'admin'; }";
const mutantSource =
  "export function isAllowed(user: { role: string }) { return true; }";

const makeRisk = (overrides: Partial<InferredRisk> = {}): InferredRisk => ({
  id: "risk-1",
  description: "Non-admin users may be allowed",
  targetSymbol: "AuthService.isAllowed",
  filePath: "source/auth.ts",
  severity: "high",
  mutantHint: "Return true for every user",
  ...overrides,
});

const makeLLM = (content: string): LLMClient =>
  ({
    complete: vi.fn().mockResolvedValue({
      content,
      usage: {
        inputTokens: 1,
        outputTokens: 1,
      },
    }),
  }) as unknown as LLMClient;

afterEach(() => {
  vi.restoreAllMocks();
});

describe("looksLikeSourceCode", () => {
  it("accepts valid source text", () => {
    expect(
      looksLikeSourceCode("const answer = ({ value }: Box) => ({ value });"),
    ).toBe(true);
  });

  it("rejects malformed source text with syntax diagnostics", () => {
    expect(looksLikeSourceCode("const answer = ;")).toBe(false);
  });

  it("rejects empty source text", () => {
    expect(looksLikeSourceCode("")).toBe(false);
  });

  it("rejects whitespace-only source text", () => {
    expect(looksLikeSourceCode("   \n\t  ")).toBe(false);
  });
});

describe("generateRiskMutant", () => {
  it("returns a mutant candidate when the generated code is meaningful", async () => {
    const llm = makeLLM(`\`\`\`typescript\n${mutantSource}\n\`\`\``);
    const risk = makeRisk({ mutantHint: null });

    const candidate = await generateRiskMutant(
      risk,
      parentSource,
      "source/auth.ts",
      llm,
    );

    expect(candidate).toEqual({
      risk,
      mutantCode: mutantSource,
      filePath: "source/auth.ts",
    });
    expect(llm.complete).toHaveBeenCalledWith(
      expect.objectContaining({
        systemPrompt:
          "You are generating code mutations that represent realistic bugs.",
        temperature: 0.2,
      }),
    );
    expect(vi.mocked(llm.complete).mock.calls[0]?.[0].prompt).toContain(
      "Non-admin users may be allowed",
    );
  });

  it("rejects generated code that matches the parent source", async () => {
    const warnSpy = vi
      .spyOn(console, "warn")
      .mockImplementation(() => undefined);
    const llm = makeLLM(`\`\`\`typescript\n${parentSource}\n\`\`\``);

    await expect(
      generateRiskMutant(makeRisk(), parentSource, "source/auth.ts", llm),
    ).resolves.toBeNull();

    expect(warnSpy.mock.calls[0]?.[0]).toContain(
      "No meaningful mutant generated for risk risk-1",
    );
  });

  it("rejects generated code that does not include the target symbol", async () => {
    const warnSpy = vi
      .spyOn(console, "warn")
      .mockImplementation(() => undefined);
    const llm = makeLLM(
      "```typescript\nexport function other() { return true; }\n```",
    );

    await expect(
      generateRiskMutant(makeRisk(), parentSource, "source/auth.ts", llm),
    ).resolves.toBeNull();

    expect(warnSpy.mock.calls[0]?.[0]).toContain(
      "No meaningful mutant generated for risk risk-1",
    );
  });

  it("rejects generated text with syntax errors", async () => {
    const warnSpy = vi
      .spyOn(console, "warn")
      .mockImplementation(() => undefined);
    const llm = makeLLM("```typescript\nexport const isAllowed = ;\n```");

    await expect(
      generateRiskMutant(makeRisk(), parentSource, "source/auth.ts", llm),
    ).resolves.toBeNull();

    expect(warnSpy.mock.calls[0]?.[0]).toContain(
      "No meaningful mutant generated for risk risk-1",
    );
  });

  it("logs and returns null when mutant generation fails", async () => {
    const errorSpy = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    const llm = {
      complete: vi.fn().mockRejectedValue(new Error("model unavailable")),
    } as unknown as LLMClient;

    await expect(
      generateRiskMutant(makeRisk(), parentSource, "source/auth.ts", llm),
    ).resolves.toBeNull();

    expect(errorSpy.mock.calls[0]?.[0]).toContain(
      "Mutant generation failed for risk risk-1: model unavailable",
    );
  });
});

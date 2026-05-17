import { describe, expect, it } from "vitest";

import {
  generateMutantPrompt,
  inferRisksPrompt,
  judgeCatchPrompt,
  killMutantPrompt,
} from "../../source/prompts/templates.js";

describe("killMutantPrompt", () => {
  it("generates a prompt with parent and mutant source", () => {
    const prompt = killMutantPrompt({
      parentSource: "function add(a, b) { return a + b; }",
      mutantSource: "function add(a, b) { return a - b; }",
      mutantDiff: "-return a + b;\n+return a - b;",
      importPath: "./math.js",
      existingTests: null,
      availableImports: ["add"],
      tsConfigPath: "tsconfig.json",
      packageJsonPath: "package.json",
    });

    expect(prompt).toContain("Original Code (Parent)");
    expect(prompt).toContain("function add(a, b) { return a + b; }");
    expect(prompt).toContain("Mutated Code");
    expect(prompt).toContain("function add(a, b) { return a - b; }");
    expect(prompt).toContain("./math.js");
    expect(prompt).toContain("Known Importable Symbols");
    expect(prompt).toContain("package.json");
    expect(prompt).toContain("Vitest");
  });

  it("includes existing tests section when provided", () => {
    const prompt = killMutantPrompt({
      parentSource: "code",
      mutantSource: "mutant",
      mutantDiff: "diff",
      importPath: "./module.js",
      existingTests: "describe('existing', () => { it('works', () => {}) })",
      availableImports: [],
      tsConfigPath: null,
      packageJsonPath: null,
    });

    expect(prompt).toContain("Existing Test Style");
    expect(prompt).toContain("describe('existing'");
  });
});

describe("inferRisksPrompt", () => {
  it("generates a prompt with PR metadata and diff", () => {
    const prompt = inferRisksPrompt({
      prTitle: "Fix auth bug",
      prBody: "Fixes token validation",
      additionalContext: "Issue says refresh tokens must remain valid.",
      rawDiff: "+if (token.expired) return null;",
    });

    expect(prompt).toContain("Fix auth bug");
    expect(prompt).toContain("Fixes token validation");
    expect(prompt).toContain("Additional Change Context");
    expect(prompt).toContain("refresh tokens");
    expect(prompt).toContain("token.expired");
    expect(prompt).toContain("risks");
  });
});

describe("generateMutantPrompt", () => {
  it("generates a prompt for mutant creation", () => {
    const prompt = generateMutantPrompt({
      parentSource: "function validate() { return true; }",
      filePath: "source/auth.ts",
      riskDescription: "Might return false for valid tokens",
      mutantHint: "Change return true to return false",
      targetSymbol: "validate",
    });

    expect(prompt).toContain("validate");
    expect(prompt).toContain("source/auth.ts");
    expect(prompt).toContain("Might return false");
  });
});

describe("judgeCatchPrompt", () => {
  it("generates a prompt for judging a catch", () => {
    const prompt = judgeCatchPrompt({
      diff: "+return x * 2;",
      inferredIntent: "Double the value",
      testCode: "expect(fn(5)).toBe(10);",
      failureMessage: "Expected 10, got 5",
      executionLog: "Error: mismatch\n    at suite (test.ts:1:1)",
      stackTrace: "    at suite (test.ts:1:1)",
      parentBehavior: "Returns 10",
      childBehavior: "Returns 5",
      changeType: "return-value-changed",
    });

    expect(prompt).toContain("UNEXPECTED BUG");
    expect(prompt).toContain("INTENDED");
    expect(prompt).toContain("return x * 2");
    expect(prompt).toContain("unexpectedLikelihood");
    expect(prompt).toContain("Execution Log");
  });
});

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  createDefaultConfig,
  loadConfig,
  parseCatchCommandOptions,
} from "../source/config.js";

describe("createDefaultConfig", () => {
  const originalApiKey = process.env.OPENROUTER_API_KEY;
  const originalModel = process.env.OPENROUTER_MODEL;

  beforeEach(() => {
    process.env.OPENROUTER_API_KEY = "test-openrouter-key";
    process.env.OPENROUTER_MODEL = "anthropic/claude-sonnet-4";
  });

  afterEach(() => {
    if (originalApiKey === undefined) {
      delete process.env.OPENROUTER_API_KEY;
    } else {
      process.env.OPENROUTER_API_KEY = originalApiKey;
    }

    if (originalModel === undefined) {
      delete process.env.OPENROUTER_MODEL;
    } else {
      process.env.OPENROUTER_MODEL = originalModel;
    }
  });

  it("creates config with default values", () => {
    const config = createDefaultConfig();
    expect(config.llm.provider).toBe("openrouter");
    expect(config.llm.model).toBe("anthropic/claude-sonnet-4");
    expect(config.llm.apiKey).toBe("test-openrouter-key");
    expect(config.llm.providerOptions).toEqual({});
    expect(config.llm.budget).toEqual({});
    expect(config.judgeModels).toEqual([]);
    expect(config.testsPerFunction).toBe(3);
    expect(config.maxTotalTests).toBe(50);
    expect(config.workflow).toBe("both");
    expect(config.testTimeout).toBe(30_000);
    expect(config.batchSize).toBe(10);
    expect(config.parallelWorktrees).toBe(true);
    expect(config.rubfakeEnabled).toBe(true);
    expect(config.llmJudgeEnabled).toBe(true);
    expect(config.outputFormat).toBe("console");
    expect(config.contextFiles).toEqual([]);
    expect(config.include).toEqual(["src/**/*.ts", "source/**/*.ts"]);
    expect(config.exclude).toEqual([
      "**/*.test.ts",
      "**/*.spec.ts",
      "**/node_modules/**",
    ]);
  });

  it("requires an OpenRouter model", () => {
    delete process.env.OPENROUTER_MODEL;

    expect(() => createDefaultConfig()).toThrow();
  });
});

describe("loadConfig", () => {
  const originalApiKey = process.env.OPENROUTER_API_KEY;
  const originalModel = process.env.OPENROUTER_MODEL;

  beforeEach(() => {
    process.env.OPENROUTER_API_KEY = "test-api-key";
    process.env.OPENROUTER_MODEL = "openai/gpt-4.1";
  });

  afterEach(() => {
    if (originalApiKey === undefined) {
      delete process.env.OPENROUTER_API_KEY;
    } else {
      process.env.OPENROUTER_API_KEY = originalApiKey;
    }

    if (originalModel === undefined) {
      delete process.env.OPENROUTER_MODEL;
    } else {
      process.env.OPENROUTER_MODEL = originalModel;
    }
  });

  it("applies overrides to default config", () => {
    const config = loadConfig({
      testsPerFunction: 5,
      workflow: "dodgy-diff",
      outputFormat: "json",
    });
    expect(config.testsPerFunction).toBe(5);
    expect(config.workflow).toBe("dodgy-diff");
    expect(config.outputFormat).toBe("json");
  });

  it("preserves defaults for non-overridden values", () => {
    const config = loadConfig({
      testsPerFunction: 5,
    });
    expect(config.maxTotalTests).toBe(50);
    expect(config.rubfakeEnabled).toBe(true);
  });

  it("merges nested llm overrides without dropping the api key", () => {
    const config = loadConfig({
      llm: {
        model: "custom-model",
        providerOptions: {
          openrouter: {
            reasoning: { effort: "low" },
          },
        },
        budget: {
          maxCostUsd: 0.25,
          maxTokens: 10_000,
        },
      },
    });

    expect(config.llm.model).toBe("custom-model");
    expect(config.llm.apiKey).toBe("test-api-key");
    expect(config.llm.providerOptions.openrouter).toEqual({
      reasoning: { effort: "low" },
    });
    expect(config.llm.budget).toEqual({
      maxCostUsd: 0.25,
      maxTokens: 10_000,
    });
  });

  it("uses OPENROUTER_MODEL when no programmatic model is supplied", () => {
    process.env.OPENROUTER_MODEL = "meta-llama/llama-4";

    expect(loadConfig().llm.model).toBe("meta-llama/llama-4");
  });
});

describe("parseCatchCommandOptions", () => {
  it("applies CLI defaults", () => {
    const options = parseCatchCommandOptions({});

    expect(options.base).toBe("origin/main");
    expect(options.head).toBe("HEAD");
    expect(options.workflow).toBe("both");
    expect(options.output).toBe("console");
    expect(options.cwd).toBe(".");
    expect(options.contextFiles).toEqual([]);
    expect(options.maxTotalTests).toBe(50);
    expect(options.batchSize).toBe(10);
    expect(options.parallelWorktrees).toBe(true);
    expect(options.include).toEqual(["src/**/*.ts", "source/**/*.ts"]);
    expect(options.exclude).toEqual([
      "**/*.test.ts",
      "**/*.spec.ts",
      "**/node_modules/**",
    ]);
  });

  it("coerces numeric values", () => {
    const options = parseCatchCommandOptions({
      riskThreshold: "0.4",
      testsPerFunction: "5",
      maxTotalTests: "17",
      batchSize: "4",
      timeout: "45000",
      reportThreshold: "-0.2",
      maxCostUsd: "1.25",
      maxTokens: "25000",
    });

    expect(options.riskThreshold).toBe(0.4);
    expect(options.testsPerFunction).toBe(5);
    expect(options.maxTotalTests).toBe(17);
    expect(options.batchSize).toBe(4);
    expect(options.timeout).toBe(45_000);
    expect(options.reportThreshold).toBe(-0.2);
    expect(options.maxCostUsd).toBe(1.25);
    expect(options.maxTokens).toBe(25_000);
  });

  it("coerces boolean values", () => {
    expect(
      parseCatchCommandOptions({ parallelWorktrees: "false" })
        .parallelWorktrees,
    ).toBe(false);
    expect(
      parseCatchCommandOptions({ parallelWorktrees: "yes" }).parallelWorktrees,
    ).toBe(true);
    expect(
      parseCatchCommandOptions({ parallelWorktrees: "1" }).parallelWorktrees,
    ).toBe(true);
    expect(
      parseCatchCommandOptions({ parallelWorktrees: "0" }).parallelWorktrees,
    ).toBe(false);
    expect(
      parseCatchCommandOptions({ parallelWorktrees: "no" }).parallelWorktrees,
    ).toBe(false);
    expect(() =>
      parseCatchCommandOptions({ parallelWorktrees: "sometimes" }),
    ).toThrow();
  });

  it("rejects blank base head and cwd values", () => {
    expect(() => parseCatchCommandOptions({ base: "   " })).toThrow();
    expect(() => parseCatchCommandOptions({ head: "" })).toThrow();
    expect(() => parseCatchCommandOptions({ cwd: " " })).toThrow();
  });

  it("accepts context files", () => {
    const options = parseCatchCommandOptions({
      contextFiles: ["issue.md", "docs/risk.md"],
    });

    expect(options.contextFiles).toEqual(["issue.md", "docs/risk.md"]);
  });

  it("accepts include and exclude globs", () => {
    const options = parseCatchCommandOptions({
      include: ["packages/*/src/**/*.ts"],
      exclude: ["**/*.generated.ts"],
    });

    expect(options.include).toEqual(["packages/*/src/**/*.ts"]);
    expect(options.exclude).toEqual(["**/*.generated.ts"]);
  });

  it("accepts the OpenRouter model flag", () => {
    const options = parseCatchCommandOptions({
      llmModel: "anthropic/claude-sonnet-4",
    });

    expect(options.llmModel).toBe("anthropic/claude-sonnet-4");
  });
});

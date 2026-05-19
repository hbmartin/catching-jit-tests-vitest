import { afterEach, describe, expect, it } from "vitest";

import {
  createDefaultConfig,
  loadConfig,
  parseCatchCommandOptions,
} from "../source/config.js";

describe("createDefaultConfig", () => {
  it("creates config with default values", () => {
    const config = createDefaultConfig();
    expect(config.llm.provider).toBe("anthropic");
    expect(config.llm.model).toBe("claude-sonnet-4-20250514");
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
});

describe("loadConfig", () => {
  const originalApiKey = process.env.ANTHROPIC_API_KEY;

  afterEach(() => {
    if (originalApiKey === undefined) {
      delete process.env.ANTHROPIC_API_KEY;
      return;
    }

    process.env.ANTHROPIC_API_KEY = originalApiKey;
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
    process.env.ANTHROPIC_API_KEY = "test-api-key";

    const config = loadConfig({
      llm: {
        model: "custom-model",
      },
    });

    expect(config.llm.model).toBe("custom-model");
    expect(config.llm.apiKey).toBe("test-api-key");
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
    });

    expect(options.riskThreshold).toBe(0.4);
    expect(options.testsPerFunction).toBe(5);
    expect(options.maxTotalTests).toBe(17);
    expect(options.batchSize).toBe(4);
    expect(options.timeout).toBe(45_000);
    expect(options.reportThreshold).toBe(-0.2);
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
});

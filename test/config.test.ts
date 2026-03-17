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
    expect(config.rubfakeEnabled).toBe(true);
    expect(config.llmJudgeEnabled).toBe(true);
    expect(config.outputFormat).toBe("console");
  });
});

describe("loadConfig", () => {
  const originalApiKey = process.env.ANTHROPIC_API_KEY;

  afterEach(() => {
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
  });

  it("coerces numeric values", () => {
    const options = parseCatchCommandOptions({
      riskThreshold: "0.4",
      testsPerFunction: "5",
      timeout: "45000",
      reportThreshold: "-0.2",
    });

    expect(options.riskThreshold).toBe(0.4);
    expect(options.testsPerFunction).toBe(5);
    expect(options.timeout).toBe(45_000);
    expect(options.reportThreshold).toBe(-0.2);
  });
});

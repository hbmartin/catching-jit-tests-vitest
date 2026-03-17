import { describe, expect, it } from "vitest";

import { createDefaultConfig, loadConfig } from "../source/config.js";

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
});

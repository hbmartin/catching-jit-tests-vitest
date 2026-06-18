import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  createDefaultConfig,
  loadConfig,
  parseCatchCommandOptions,
} from "../source/config.js";
import { logger } from "../source/utils/logger.js";

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
    expect(config.assessConcurrency).toBe(4);
    expect(config.cache.enabled).toBe(true);
    expect(config.cache.dir).toBe(".jittest/cache");
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

  it("populates default assessor weights and thresholds", () => {
    const { assessors } = createDefaultConfig();
    expect(assessors.rubfakeWeight).toBe(0.4);
    expect(assessors.llmWeight).toBe(0.6);
    expect(assessors.rubfakeOverrideScore).toBe(-0.8);
    expect(assessors.verdictThresholds.strongCatch).toBe(0.6);
    expect(assessors.dismissalThresholds.hard).toBe(0.5);
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

describe("loadConfig with a config file", () => {
  const originalApiKey = process.env.OPENROUTER_API_KEY;
  const originalModel = process.env.OPENROUTER_MODEL;
  let dir: string;

  beforeEach(() => {
    process.env.OPENROUTER_API_KEY = "test-api-key";
    process.env.OPENROUTER_MODEL = "openai/gpt-4.1";
    dir = mkdtempSync(path.join(tmpdir(), "jittest-config-"));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
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

  const writeConfig = (value: unknown, at = dir): string => {
    const filePath = path.join(at, "jittest.config.json");
    writeFileSync(filePath, JSON.stringify(value), "utf-8");
    return filePath;
  };

  const mockLoggerInfo = () =>
    vi.spyOn(logger, "info").mockImplementation(() => undefined);

  const nestedLlmFileConfig = () => ({
    llm: {
      budget: { maxCostUsd: 1.25, maxTokens: 50_000 },
      providerOptions: {
        openrouter: {
          reasoning: { effort: "medium" },
          transforms: ["middle-out"],
        },
      },
    },
  });

  const nestedLlmOverrides = () => ({
    llm: {
      budget: { maxTokens: 10_000 },
      providerOptions: {
        openrouter: { reasoning: { effort: "low" } },
      },
    },
  });

  it("reads assessor weights from an explicit config path", () => {
    const filePath = writeConfig({
      assessors: { rubfakeWeight: 0.7, llmWeight: 0.3 },
    });

    const config = loadConfig({}, { cwd: dir, configPath: filePath });
    expect(config.assessors.rubfakeWeight).toBe(0.7);
    expect(config.assessors.llmWeight).toBe(0.3);
    // Untouched nested fields keep their defaults.
    expect(config.assessors.verdictThresholds.strongCatch).toBe(0.6);
  });

  it("auto-discovers jittest.config.json by walking up from cwd", () => {
    writeConfig({ reportThreshold: 0.42 });
    const nested = path.join(dir, "packages", "app");
    mkdirSync(nested, { recursive: true });

    const config = loadConfig({}, { cwd: nested });
    expect(config.reportThreshold).toBe(0.42);
  });

  it("lets CLI overrides win over file values", () => {
    writeConfig({ reportThreshold: 0.42, workflow: "dodgy-diff" });

    const config = loadConfig({ reportThreshold: 0.9 }, { cwd: dir });
    // CLI override wins; file value still applies where CLI is silent.
    expect(config.reportThreshold).toBe(0.9);
    expect(config.workflow).toBe("dodgy-diff");
  });

  it("deep-merges nested llm objects from file config and CLI overrides", () => {
    writeConfig(nestedLlmFileConfig());

    const config = loadConfig(nestedLlmOverrides(), { cwd: dir });

    expect(config.llm.budget).toEqual({
      maxCostUsd: 1.25,
      maxTokens: 10_000,
    });
    expect(config.llm.providerOptions.openrouter).toEqual({
      reasoning: { effort: "low" },
      transforms: ["middle-out"],
    });
  });

  it("logs an override notice per leaf when a CLI override replaces a file value", () => {
    const infoSpy = mockLoggerInfo();
    try {
      writeConfig(nestedLlmFileConfig());

      loadConfig(nestedLlmOverrides(), { cwd: dir });

      expect(infoSpy).toHaveBeenCalledWith(
        "config override: llm.budget.maxTokens: 50000 -> 10000",
      );
      expect(infoSpy).toHaveBeenCalledWith(
        "config override: llm.providerOptions.openrouter.reasoning.effort: medium -> low",
      );
      // Only the two replaced leaves log; retained file values stay quiet.
      expect(infoSpy).toHaveBeenCalledTimes(2);
    } finally {
      infoSpy.mockRestore();
    }
  });

  it("logs structured override values as JSON", () => {
    const infoSpy = mockLoggerInfo();
    try {
      writeConfig({
        llm: {
          providerOptions: {
            openrouter: { transforms: ["middle-out"] },
          },
        },
      });

      loadConfig(
        {
          llm: {
            providerOptions: {
              openrouter: {
                transforms: { strategy: "middle-out" },
              },
            },
          },
        },
        { cwd: dir },
      );

      expect(infoSpy).toHaveBeenCalledWith(
        'config override: llm.providerOptions.openrouter.transforms: ["middle-out"] -> {"strategy":"middle-out"}',
      );
      expect(infoSpy).toHaveBeenCalledTimes(1);
    } finally {
      infoSpy.mockRestore();
    }
  });

  it("does not log an override notice when a CLI override only adds new nested leaves", () => {
    const infoSpy = mockLoggerInfo();
    try {
      writeConfig({
        llm: {
          budget: { maxCostUsd: 1.25 },
          providerOptions: {
            openrouter: { transforms: ["middle-out"] },
          },
        },
      });

      loadConfig(
        {
          llm: {
            budget: { maxTokens: 10_000 },
            providerOptions: {
              openrouter: { reasoning: { effort: "low" } },
            },
          },
        },
        { cwd: dir },
      );

      expect(infoSpy).not.toHaveBeenCalled();
    } finally {
      infoSpy.mockRestore();
    }
  });

  it("does not let undefined nested CLI overrides clobber file values", () => {
    const infoSpy = mockLoggerInfo();
    try {
      writeConfig({
        llm: {
          budget: { maxTokens: 50_000 },
          providerOptions: {
            openrouter: {
              routing: "file",
              transforms: ["middle-out"],
            },
          },
        },
      });

      const config = loadConfig(
        {
          llm: {
            budget: { maxTokens: undefined },
            providerOptions: {
              openrouter: {
                routing: undefined,
                reasoning: { effort: "low" },
              },
            },
          },
        },
        { cwd: dir },
      );

      expect(config.llm.budget.maxTokens).toBe(50_000);
      expect(config.llm.providerOptions.openrouter).toEqual({
        reasoning: { effort: "low" },
        routing: "file",
        transforms: ["middle-out"],
      });
      expect(infoSpy).not.toHaveBeenCalled();
    } finally {
      infoSpy.mockRestore();
    }
  });

  it("drops forbidden nested merge keys from file and CLI provider options", () => {
    writeConfig({
      llm: {
        providerOptions: {
          constructor: { polluted: true },
          openrouter: {
            ["__proto__"]: { polluted: true },
            routing: "file",
          },
        },
      },
    });

    const config = loadConfig(
      {
        llm: {
          providerOptions: {
            custom: {
              prototype: "polluted",
              routing: "cli",
            },
            prototype: { polluted: true },
          },
        },
      },
      { cwd: dir },
    );

    expect(config.llm.providerOptions).toEqual({
      custom: { routing: "cli" },
      openrouter: { routing: "file" },
    });
    expect(Object.hasOwn(config.llm.providerOptions, "constructor")).toBe(
      false,
    );
    expect(Object.hasOwn(config.llm.providerOptions, "prototype")).toBe(false);
    expect(
      Object.hasOwn(config.llm.providerOptions.openrouter ?? {}, "__proto__"),
    ).toBe(false);
  });

  it("does not let absent CLI flags clobber file values with defaults", () => {
    writeConfig({ reportThreshold: 0.42 });

    // reportThreshold passed as undefined (an unset CLI flag) must be pruned.
    const config = loadConfig(
      { reportThreshold: undefined, workflow: "intent-aware" },
      { cwd: dir },
    );
    expect(config.reportThreshold).toBe(0.42);
    expect(config.workflow).toBe("intent-aware");
  });

  it("throws on invalid JSON in the config file", () => {
    const filePath = path.join(dir, "jittest.config.json");
    writeFileSync(filePath, "{ not valid json", "utf-8");

    expect(() => loadConfig({}, { cwd: dir })).toThrow(/Invalid JSON/);
  });

  it("throws when the config file is not a JSON object", () => {
    writeConfig(["not", "an", "object"]);

    expect(() => loadConfig({}, { cwd: dir })).toThrow(
      /must contain a JSON object/,
    );
  });

  it("uses defaults when an explicit config path cannot be read as a file", () => {
    const configDir = path.join(dir, "config-dir");
    mkdirSync(configDir);

    const config = loadConfig({}, { cwd: dir, configPath: configDir });

    expect(config.testsPerFunction).toBe(3);
    expect(config.llm.model).toBe("openai/gpt-4.1");
  });

  it("throws when an explicit config path is missing", () => {
    expect(() =>
      loadConfig({}, { cwd: dir, configPath: "does-not-exist.json" }),
    ).toThrow(/Config file not found/);
  });

  it("reads provider and base URL from the environment", () => {
    process.env.LLM_PROVIDER = "openai-compatible";
    process.env.LLM_BASE_URL = "https://api.example.com/v1";
    try {
      const config = loadConfig({}, { cwd: dir });
      expect(config.llm.provider).toBe("openai-compatible");
      expect(config.llm.baseUrl).toBe("https://api.example.com/v1");
    } finally {
      delete process.env.LLM_PROVIDER;
      delete process.env.LLM_BASE_URL;
    }
  });

  it("lets CLI llm overrides win over environment provider", () => {
    process.env.LLM_PROVIDER = "openai-compatible";
    try {
      const config = loadConfig(
        { llm: { provider: "openrouter" } },
        { cwd: dir },
      );
      expect(config.llm.provider).toBe("openrouter");
    } finally {
      delete process.env.LLM_PROVIDER;
    }
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

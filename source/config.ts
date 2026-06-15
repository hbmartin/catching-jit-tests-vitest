import { z } from "zod";

const workflowSchema = z.enum(["dodgy-diff", "intent-aware", "both"]);
const outputFormatSchema = z.enum(["github-comment", "json", "console"]);
const defaultIncludePatterns = ["src/**/*.ts", "source/**/*.ts"];
const defaultExcludePatterns = [
  "**/*.test.ts",
  "**/*.spec.ts",
  "**/node_modules/**",
];

const stringListSchema = z.array(z.string().trim().min(1));
const booleanOptionSchema = z.preprocess((value) => {
  if (typeof value !== "string") {
    return value;
  }

  const normalized = value.trim().toLowerCase();
  if (normalized === "true" || normalized === "1" || normalized === "yes") {
    return true;
  }
  if (normalized === "false" || normalized === "0" || normalized === "no") {
    return false;
  }

  return value;
}, z.boolean());

const jitTestConfigSchema = z.object({
  llm: z.object({
    provider: z.literal("openrouter").default("openrouter"),
    model: z
      .string()
      .trim()
      .min(
        1,
        "An OpenRouter model is required. Set --llm-model, OPENROUTER_MODEL, or llm.model.",
      ),
    apiKey: z.string().default(""),
    maxTokens: z.number().int().positive().default(4096),
    providerOptions: z
      .object({
        openrouter: z.record(z.string(), z.unknown()).optional(),
      })
      .default({}),
    budget: z
      .object({
        maxCostUsd: z.number().positive().optional(),
        maxTokens: z.number().int().positive().optional(),
      })
      .default({}),
  }),
  judgeModels: z.array(z.string()).default([]),
  riskThreshold: z.number().min(0).max(1).default(0),
  testsPerFunction: z.number().min(1).default(3),
  maxTotalTests: z.number().min(1).default(50),
  workflow: workflowSchema.default("both"),
  testTimeout: z.number().default(30_000),
  batchSize: z.number().int().min(1).default(10),
  parallelWorktrees: z.boolean().default(true),
  reportThreshold: z.number().min(-1).max(1).default(0),
  rubfakeEnabled: z.boolean().default(true),
  llmJudgeEnabled: z.boolean().default(true),
  outputFormat: outputFormatSchema.default("console"),
  feedbackPath: z.string().default(".jittest/assessment-records.jsonl"),
  contextFiles: z.array(z.string()).default([]),
  include: stringListSchema.default(defaultIncludePatterns),
  exclude: stringListSchema.default(defaultExcludePatterns),
});

type JiTTestConfig = z.infer<typeof jitTestConfigSchema>;
type Workflow = z.infer<typeof workflowSchema>;
type OutputFormat = z.infer<typeof outputFormatSchema>;

const catchCommandOptionsSchema = z.object({
  base: z.string().trim().min(1).default("origin/main"),
  head: z.string().trim().min(1).default("HEAD"),
  workflow: workflowSchema.default("both"),
  riskThreshold: z.coerce.number().min(0).max(1).default(0),
  testsPerFunction: z.coerce.number().int().min(1).default(3),
  maxTotalTests: z.coerce.number().int().min(1).default(50),
  batchSize: z.coerce.number().int().min(1).default(10),
  parallelWorktrees: booleanOptionSchema.default(true),
  timeout: z.coerce.number().int().positive().default(30_000),
  output: outputFormatSchema.default("console"),
  reportThreshold: z.coerce.number().min(-1).max(1).default(0),
  feedbackPath: z.string().default(".jittest/assessment-records.jsonl"),
  contextFiles: z.array(z.string()).default([]),
  llmModel: z.string().trim().min(1).optional(),
  maxCostUsd: z.coerce.number().positive().optional(),
  maxTokens: z.coerce.number().int().positive().optional(),
  include: stringListSchema.default(defaultIncludePatterns),
  exclude: stringListSchema.default(defaultExcludePatterns),
  cwd: z.string().trim().min(1).default("."),
  prTitle: z.string().default(""),
  prBody: z.string().default(""),
});

type CatchCommandOptions = z.infer<typeof catchCommandOptionsSchema>;

function getApiKey(): string {
  // biome-ignore lint/complexity/useLiteralKeys: env var access requires bracket notation
  return process.env["OPENROUTER_API_KEY"] ?? "";
}

function getModel(): string {
  // biome-ignore lint/complexity/useLiteralKeys: env var access requires bracket notation
  return process.env["OPENROUTER_MODEL"] ?? "";
}

function createDefaultConfig(): JiTTestConfig {
  return jitTestConfigSchema.parse({
    llm: {
      apiKey: getApiKey(),
      model: getModel(),
    },
  });
}

function loadConfig(overrides: Record<string, unknown> = {}): JiTTestConfig {
  // biome-ignore lint/complexity/useLiteralKeys: index signature access
  const llmOverrides = (overrides["llm"] as Record<string, unknown>) ?? {};
  const { llm: _ignoredLlm, ...restOverrides } = overrides;
  const base = {
    ...restOverrides,
    llm: {
      apiKey: getApiKey(),
      model: getModel(),
      ...llmOverrides,
    },
  };
  return jitTestConfigSchema.parse(base);
}

const parseCatchCommandOptions = (input: unknown): CatchCommandOptions =>
  catchCommandOptionsSchema.parse(input);

export type { CatchCommandOptions, JiTTestConfig, OutputFormat, Workflow };
export {
  catchCommandOptionsSchema,
  createDefaultConfig,
  defaultExcludePatterns,
  defaultIncludePatterns,
  jitTestConfigSchema,
  loadConfig,
  outputFormatSchema,
  parseCatchCommandOptions,
  workflowSchema,
};

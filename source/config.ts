import { z } from "zod";

const jitTestConfigSchema = z.object({
  llm: z.object({
    provider: z.enum(["anthropic"]).default("anthropic"),
    model: z.string().default("claude-sonnet-4-20250514"),
    apiKey: z.string(),
    maxTokens: z.number().default(4096),
  }),
  judgeModels: z.array(z.string()).default(["claude-sonnet-4-20250514"]),
  riskThreshold: z.number().min(0).max(1).default(0),
  testsPerFunction: z.number().min(1).default(3),
  maxTotalTests: z.number().min(1).default(50),
  workflow: z.enum(["dodgy-diff", "intent-aware", "both"]).default("both"),
  testTimeout: z.number().default(30_000),
  batchSize: z.number().default(10),
  parallelWorktrees: z.boolean().default(true),
  reportThreshold: z.number().min(-1).max(1).default(0),
  rubfakeEnabled: z.boolean().default(true),
  llmJudgeEnabled: z.boolean().default(true),
  outputFormat: z
    .enum(["github-comment", "json", "console"])
    .default("console"),
  githubToken: z.string().optional(),
  prNumber: z.number().optional(),
  include: z.array(z.string()).default(["src/**/*.ts", "source/**/*.ts"]),
  exclude: z
    .array(z.string())
    .default(["**/*.test.ts", "**/*.spec.ts", "**/node_modules/**"]),
});

type JiTTestConfig = z.infer<typeof jitTestConfigSchema>;

function getApiKey(): string {
  // biome-ignore lint/complexity/useLiteralKeys: env var access requires bracket notation
  return process.env["ANTHROPIC_API_KEY"] ?? "";
}

function createDefaultConfig(): JiTTestConfig {
  return jitTestConfigSchema.parse({
    llm: {
      apiKey: getApiKey(),
    },
  });
}

function loadConfig(overrides: Record<string, unknown> = {}): JiTTestConfig {
  // biome-ignore lint/complexity/useLiteralKeys: index signature access
  const llmOverrides = (overrides["llm"] as Record<string, unknown>) ?? {};
  const base = {
    llm: {
      apiKey: getApiKey(),
      ...llmOverrides,
    },
    ...overrides,
  };
  return jitTestConfigSchema.parse(base);
}

export type { JiTTestConfig };
export { createDefaultConfig, jitTestConfigSchema, loadConfig };

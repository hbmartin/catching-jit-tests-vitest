import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

import { z } from "zod";

import { logger } from "./utils/logger.js";

const workflowSchema = z.enum(["dodgy-diff", "intent-aware", "both"]);
const outputFormatSchema = z.enum([
  "github-comment",
  "github-step-summary",
  "json",
  "console",
]);
const savedReportFormatSchema = outputFormatSchema.exclude(["console"]);
const failOnVerdictSchema = z.enum([
  "strong-catch",
  "likely-strong",
  "uncertain",
  "likely-false-positive",
  "false-positive",
  "any-report",
]);
const triageLabelSchema = z.enum([
  "unknown",
  "confirmed-true-positive",
  "confirmed-false-positive",
  "intended-change",
]);
const defaultIncludePatterns = ["src/**/*.ts", "source/**/*.ts"];
const defaultExcludePatterns = [
  "**/*.test.ts",
  "**/*.spec.ts",
  "**/node_modules/**",
];
const defaultAutoContextFiles = ["AGENTS.md", "CLAUDE.md", "CONTRIBUTING.md"];

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

const verdictThresholdsSchema = z
  .object({
    strongCatch: z.number().default(0.6),
    likelyStrong: z.number().default(0.3),
    uncertain: z.number().default(-0.3),
    likelyFalsePositive: z.number().default(-0.6),
  })
  .prefault({});

const dismissalThresholdsSchema = z
  .object({
    trivial: z.number().default(-0.2),
    easy: z.number().default(0),
    moderate: z.number().default(0.3),
    hard: z.number().default(0.5),
  })
  .prefault({});

const assessorsConfigSchema = z
  .object({
    rubfakeWeight: z.number().min(0).max(1).default(0.4),
    llmWeight: z.number().min(0).max(1).default(0.6),
    rubfakeOverrideScore: z.number().default(-0.8),
    verdictThresholds: verdictThresholdsSchema,
    dismissalThresholds: dismissalThresholdsSchema,
  })
  .prefault({});

type AssessorsConfig = z.infer<typeof assessorsConfigSchema>;

const sensitivityGlobSchema = z.object({
  label: z.string().trim().min(1),
  pattern: z.string().trim().min(1),
  weight: z.number().min(0).max(1),
});

type SensitivityGlob = z.infer<typeof sensitivityGlobSchema>;

const jitTestConfigSchema = z.object({
  llm: z.object({
    provider: z.enum(["openrouter", "openai-compatible"]).default("openrouter"),
    baseUrl: z.string().trim().min(1).optional(),
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
      .record(z.string(), z.record(z.string(), z.unknown()))
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
  assessConcurrency: z.number().int().min(1).default(4),
  flakeGuardRuns: z.number().int().min(1).default(1),
  reportThreshold: z.number().min(-1).max(1).default(0),
  rubfakeEnabled: z.boolean().default(true),
  llmJudgeEnabled: z.boolean().default(true),
  assessors: assessorsConfigSchema,
  cache: z
    .object({
      enabled: z.boolean().default(true),
      dir: z.string().default(".jittest/cache"),
    })
    .prefault({}),
  outputFormat: outputFormatSchema.default("console"),
  feedbackPath: z.string().default(".jittest/assessment-records.jsonl"),
  contextFiles: z.array(z.string()).default([]),
  autoContext: z.boolean().default(true),
  autoContextFiles: stringListSchema.default(defaultAutoContextFiles),
  sensitivityGlobs: z.array(sensitivityGlobSchema).default([]),
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
  assessConcurrency: z.coerce.number().int().min(1).optional(),
  flakeGuardRuns: z.coerce.number().int().min(1).optional(),
  timeout: z.coerce.number().int().positive().default(30_000),
  output: outputFormatSchema.default("console"),
  failOn: failOnVerdictSchema.optional(),
  jsonFile: z.string().trim().min(1).optional(),
  summaryFile: z.string().trim().min(1).optional(),
  commentFile: z.string().trim().min(1).optional(),
  reportThreshold: z.coerce.number().min(-1).max(1).default(0),
  feedbackPath: z.string().default(".jittest/assessment-records.jsonl"),
  contextFiles: z.array(z.string()).default([]),
  autoContextFiles: z.array(z.string().trim().min(1)).optional(),
  noAutoContext: booleanOptionSchema.optional(),
  llmModel: z.string().trim().min(1).optional(),
  llmProvider: z.enum(["openrouter", "openai-compatible"]).optional(),
  llmBaseUrl: z.string().trim().min(1).optional(),
  maxCostUsd: z.coerce.number().positive().optional(),
  maxTokens: z.coerce.number().int().positive().optional(),
  include: stringListSchema.default(defaultIncludePatterns),
  exclude: stringListSchema.default(defaultExcludePatterns),
  cwd: z.string().trim().min(1).default("."),
  prTitle: z.string().default(""),
  prBody: z.string().default(""),
  configPath: z.string().trim().min(1).optional(),
  noCache: booleanOptionSchema.optional(),
  cacheDir: z.string().trim().min(1).optional(),
});

type CatchCommandOptions = z.infer<typeof catchCommandOptionsSchema>;

const calibrateCommandOptionsSchema = z.object({
  // Optional so the command can fall back to the config file's feedbackPath.
  feedbackPath: z.string().trim().min(1).optional(),
  output: z.enum(["console", "json"]).default("console"),
  cwd: z.string().trim().min(1).default("."),
  configPath: z.string().trim().min(1).optional(),
});

type CalibrateCommandOptions = z.infer<typeof calibrateCommandOptionsSchema>;

const formatCommandOptionsSchema = z.object({
  input: z.string().trim().min(1),
  output: savedReportFormatSchema.default("github-step-summary"),
  outFile: z.string().trim().min(1).optional(),
  cwd: z.string().trim().min(1).default("."),
});

type FormatCommandOptions = z.infer<typeof formatCommandOptionsSchema>;

const triageCommandOptionsSchema = z.object({
  feedbackPath: z.string().trim().min(1).optional(),
  id: z.string().trim().min(1).optional(),
  runId: z.string().trim().min(1).optional(),
  label: triageLabelSchema.optional(),
  notes: z.string().optional(),
  list: z.boolean().default(false),
  interactive: z.boolean().default(false),
  cwd: z.string().trim().min(1).default("."),
  configPath: z.string().trim().min(1).optional(),
});

type TriageCommandOptions = z.infer<typeof triageCommandOptionsSchema>;

const CONFIG_FILE_NAME = "jittest.config.json";

type EnvMap = Record<string, string | undefined>;

function readEnv(env: EnvMap, name: string): string {
  return env[name] ?? "";
}

// LLM_API_KEY (generic) takes precedence over OPENROUTER_API_KEY so a single
// variable works regardless of provider; OPENROUTER_API_KEY stays supported.
function getApiKey(env: EnvMap): string {
  const generic = readEnv(env, "LLM_API_KEY");
  return generic.length > 0 ? generic : readEnv(env, "OPENROUTER_API_KEY");
}

function getModel(env: EnvMap): string {
  const openrouter = readEnv(env, "OPENROUTER_MODEL");
  return openrouter.length > 0 ? openrouter : readEnv(env, "LLM_MODEL");
}

function getProvider(env: EnvMap): string {
  return readEnv(env, "LLM_PROVIDER");
}

function getBaseUrl(env: EnvMap): string {
  return readEnv(env, "LLM_BASE_URL");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function pruneUndefined(
  input: Record<string, unknown>,
): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(input).filter(([, value]) => value !== undefined),
  );
}

// Dropped during merges to keep a crafted config file from reaching an object's
// prototype via a "__proto__"/"constructor"/"prototype" key.
const FORBIDDEN_MERGE_KEYS = new Set(["__proto__", "constructor", "prototype"]);

// A leaf where a higher-precedence layer (CLI) replaced a different value the
// config file had already set. Logged so the override is visible. This is
// expected behavior, not a fault, so it surfaces at info rather than warn.
interface MergeConflict {
  readonly path: string;
  readonly from: unknown;
  readonly to: unknown;
}

function formatOverrideValue(value: unknown): string {
  if (
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  ) {
    return String(value);
  }
  try {
    return JSON.stringify(value) ?? String(value);
  } catch {
    return String(value);
  }
}

function sanitizeMergeRecord(
  input: Record<string, unknown>,
): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(input)) {
    if (!FORBIDDEN_MERGE_KEYS.has(key)) {
      result[key] = isRecord(value) ? sanitizeMergeRecord(value) : value;
    }
  }
  return result;
}

function mergeRecords(
  base: Record<string, unknown>,
  overrides: Record<string, unknown>,
  pathPrefix: string,
  conflicts: MergeConflict[],
): Record<string, unknown> {
  const result = { ...base };
  const safeOverrides = overrides;
  for (const [key, overrideValue] of Object.entries(safeOverrides)) {
    if (overrideValue !== undefined) {
      const baseValue = result[key];
      const keyPath = pathPrefix.length > 0 ? `${pathPrefix}.${key}` : key;
      if (isRecord(baseValue) && isRecord(overrideValue)) {
        result[key] = mergeRecords(
          baseValue,
          overrideValue,
          keyPath,
          conflicts,
        );
      } else {
        // An add (no prior file value) is not an override; only a genuine,
        // differing replacement is worth warning about.
        if (
          baseValue !== undefined &&
          JSON.stringify(baseValue) !== JSON.stringify(overrideValue)
        ) {
          conflicts.push({ path: keyPath, from: baseValue, to: overrideValue });
        }
        result[key] = overrideValue;
      }
    }
  }
  return result;
}

function mergeNestedRecord(
  base: Record<string, unknown>,
  overrides: Record<string, unknown>,
  key: string,
  conflicts: MergeConflict[],
): unknown {
  const baseValue = base[key];
  const overrideValue = overrides[key];

  if (overrideValue === undefined) {
    return isRecord(baseValue) ? sanitizeMergeRecord(baseValue) : baseValue;
  }

  if (isRecord(baseValue) && isRecord(overrideValue)) {
    return mergeRecords(
      sanitizeMergeRecord(baseValue),
      sanitizeMergeRecord(overrideValue),
      `llm.${key}`,
      conflicts,
    );
  }

  return isRecord(overrideValue)
    ? sanitizeMergeRecord(overrideValue)
    : overrideValue;
}

function readConfigFileAt(filePath: string): Record<string, unknown> {
  let raw: string;
  try {
    raw = readFileSync(filePath, "utf-8");
  } catch {
    return {};
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Invalid JSON in config file ${filePath}: ${message}`, {
      cause: error,
    });
  }

  if (!isRecord(parsed)) {
    throw new Error(`Config file ${filePath} must contain a JSON object`);
  }

  return parsed;
}

function findConfigFile(startDir: string): string | undefined {
  let current = path.resolve(startDir);
  let parent = path.dirname(current);

  // Walk up until the filesystem root, where dirname is a fixed point.
  for (; current !== parent; parent = path.dirname(current)) {
    const candidate = path.join(current, CONFIG_FILE_NAME);
    if (existsSync(candidate)) {
      return candidate;
    }
    current = parent;
  }

  const rootCandidate = path.join(current, CONFIG_FILE_NAME);
  return existsSync(rootCandidate) ? rootCandidate : undefined;
}

// File-based config provides the lowest-precedence layer. Discovery walks up
// from `cwd` for `jittest.config.json`; an explicit path skips discovery.
function loadConfigFile(
  cwd: string,
  explicitPath?: string,
): Record<string, unknown> {
  if (explicitPath !== undefined) {
    const resolved = path.resolve(cwd, explicitPath);
    if (!existsSync(resolved)) {
      throw new Error(`Config file not found: ${resolved}`);
    }
    return readConfigFileAt(resolved);
  }

  const discovered = findConfigFile(cwd);
  return discovered === undefined ? {} : readConfigFileAt(discovered);
}

function createDefaultConfig(env: EnvMap = process.env): JiTTestConfig {
  return jitTestConfigSchema.parse({
    llm: {
      apiKey: getApiKey(env),
      model: getModel(env),
    },
  });
}

interface LoadConfigOptions {
  readonly cwd?: string;
  readonly configPath?: string;
  readonly env?: EnvMap;
  readonly ignoreEnv?: boolean;
}

// Precedence: file config < environment < explicit overrides (CLI). Undefined
// override values are pruned so that absent CLI flags do not clobber file
// values with schema defaults.
function loadConfig(
  overrides: Record<string, unknown> = {},
  {
    cwd = process.cwd(),
    configPath,
    env = process.env,
    ignoreEnv = false,
  }: LoadConfigOptions = {},
): JiTTestConfig {
  const fileConfig = loadConfigFile(cwd, configPath);
  // biome-ignore lint/complexity/useLiteralKeys: index signature access
  const fileLlm = isRecord(fileConfig["llm"]) ? fileConfig["llm"] : {};
  const { llm: _fileLlmIgnored, ...fileRest } = fileConfig;

  const llmOverrides = pruneUndefined(
    // biome-ignore lint/complexity/useLiteralKeys: index signature access
    isRecord(overrides["llm"]) ? overrides["llm"] : {},
  );
  const { llm: _ignoredLlm, ...restOverrides } = overrides;

  const effectiveEnv = ignoreEnv ? {} : env;
  const envApiKey = getApiKey(effectiveEnv);
  const envModel = getModel(effectiveEnv);
  const envProvider = getProvider(effectiveEnv);
  const envBaseUrl = getBaseUrl(effectiveEnv);
  // biome-ignore lint/complexity/useLiteralKeys: index signature access
  const fileApiKeyValue = fileLlm["apiKey"];
  const fileApiKey = typeof fileApiKeyValue === "string" ? fileApiKeyValue : "";

  const conflicts: MergeConflict[] = [];
  const base = {
    ...fileRest,
    ...pruneUndefined(restOverrides),
    llm: {
      ...fileLlm,
      ...(envProvider.length > 0 ? { provider: envProvider } : {}),
      ...(envBaseUrl.length > 0 ? { baseUrl: envBaseUrl } : {}),
      apiKey: envApiKey.length > 0 ? envApiKey : fileApiKey,
      ...(envModel.length > 0 ? { model: envModel } : {}),
      ...llmOverrides,
      providerOptions: mergeNestedRecord(
        fileLlm,
        llmOverrides,
        "providerOptions",
        conflicts,
      ),
      budget: mergeNestedRecord(fileLlm, llmOverrides, "budget", conflicts),
    },
  };

  for (const { path: conflictPath, from, to } of conflicts) {
    logger.info(
      `config override: ${conflictPath}: ${formatOverrideValue(from)} -> ${formatOverrideValue(to)}`,
    );
  }

  return jitTestConfigSchema.parse(base);
}

const parseCatchCommandOptions = (input: unknown): CatchCommandOptions =>
  catchCommandOptionsSchema.parse(input);

const parseCalibrateCommandOptions = (
  input: unknown,
): CalibrateCommandOptions => calibrateCommandOptionsSchema.parse(input);

const parseFormatCommandOptions = (input: unknown): FormatCommandOptions =>
  formatCommandOptionsSchema.parse(input);

const parseTriageCommandOptions = (input: unknown): TriageCommandOptions =>
  triageCommandOptionsSchema.parse(input);

export type {
  AssessorsConfig,
  CalibrateCommandOptions,
  CatchCommandOptions,
  FormatCommandOptions,
  JiTTestConfig,
  LoadConfigOptions,
  OutputFormat,
  SensitivityGlob,
  TriageCommandOptions,
  Workflow,
};
export {
  assessorsConfigSchema,
  calibrateCommandOptionsSchema,
  catchCommandOptionsSchema,
  createDefaultConfig,
  defaultAutoContextFiles,
  defaultExcludePatterns,
  defaultIncludePatterns,
  failOnVerdictSchema,
  formatCommandOptionsSchema,
  jitTestConfigSchema,
  loadConfig,
  loadConfigFile,
  outputFormatSchema,
  parseCalibrateCommandOptions,
  parseCatchCommandOptions,
  parseFormatCommandOptions,
  parseTriageCommandOptions,
  savedReportFormatSchema,
  sensitivityGlobSchema,
  triageCommandOptionsSchema,
  triageLabelSchema,
  workflowSchema,
};

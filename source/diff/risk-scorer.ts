import picomatch from "picomatch";
import type { SensitivityGlob } from "../config.js";
import { mapConcurrent } from "../utils/concurrency.js";
import { logger } from "../utils/logger.js";
import { runCommand } from "../utils/process.js";
import type { ChangedFile, DiffContext, RiskFactors } from "./types.js";

interface RiskAnalysis {
  score: number;
  factors: RiskFactors;
  reasons: string[];
}

interface DefectHistoryResult {
  score: number;
  available: boolean;
}

interface RiskScoreOptions {
  defectHistoryAvailable?: boolean;
  sensitivityGlobs?: readonly SensitivityGlob[];
}

const sensitivityPatterns: ReadonlyArray<{
  label: string;
  pattern: RegExp;
  weight: number;
}> = [
  {
    label: "payments",
    pattern: /payment|billing|charge|stripe|subscription/i,
    weight: 0.95,
  },
  {
    label: "auth",
    pattern: /auth|login|session|token|jwt|oauth/i,
    weight: 0.9,
  },
  {
    label: "access-control",
    pattern: /permission|role|rbac|acl|access/i,
    weight: 0.85,
  },
  {
    label: "secrets",
    pattern: /encrypt|decrypt|hash|secret|credential/i,
    weight: 0.9,
  },
  {
    label: "data-model",
    pattern: /database|migration|schema|model/i,
    weight: 0.7,
  },
  { label: "api", pattern: /api\/|route|endpoint|middleware/i, weight: 0.6 },
  { label: "config", pattern: /config|env|setting/i, weight: 0.5 },
  { label: "utility", pattern: /util|helper|lib/i, weight: 0.3 },
  { label: "tests", pattern: /test|spec|mock|fixture/i, weight: 0.1 },
];

const clampScore = (value: number): number => Math.max(0, Math.min(1, value));
const gitHistoryConcurrency = 8;
const globOptions = { dot: true } as const;

const matchesSensitivityLabel = (diff: DiffContext, label: string): boolean =>
  diff.files.some((file) => {
    const fileDiff = file.hunks.map((hunk) => hunk.content).join("\n");
    const combined = `${file.path}\n${fileDiff}`;

    return sensitivityPatterns.some(
      (pattern) => pattern.label === label && pattern.pattern.test(combined),
    );
  });

const customSensitivityMatches = (
  diff: DiffContext,
  sensitivityGlobs: readonly SensitivityGlob[] = [],
): SensitivityGlob[] => {
  if (sensitivityGlobs.length === 0) {
    return [];
  }

  const matches: SensitivityGlob[] = [];
  for (const rule of sensitivityGlobs) {
    const matcher = picomatch(rule.pattern.replaceAll("\\", "/"), globOptions);
    if (diff.files.some((file) => matcher(file.path.replaceAll("\\", "/")))) {
      matches.push(rule);
    }
  }

  return matches;
};

const calculateSensitivityScore = (
  diff: DiffContext,
  sensitivityGlobs: readonly SensitivityGlob[] = [],
): number => {
  if (diff.files.length === 0) {
    return 0;
  }

  let maxWeight = 0;

  for (const file of diff.files) {
    if (file.touchesPayments) {
      maxWeight = Math.max(maxWeight, 0.95);
    }

    if (file.touchesAuth) {
      maxWeight = Math.max(maxWeight, 0.9);
    }

    if (file.touchesAccessControl) {
      maxWeight = Math.max(maxWeight, 0.85);
    }

    if (file.touchesDataModel) {
      maxWeight = Math.max(maxWeight, 0.7);
    }

    const fileDiff = file.hunks.map((hunk) => hunk.content).join("\n");
    const combined = `${file.path}\n${fileDiff}`;

    for (const { pattern, weight } of sensitivityPatterns) {
      if (pattern.test(combined)) {
        maxWeight = Math.max(maxWeight, weight);
      }
    }
  }

  for (const rule of customSensitivityMatches(diff, sensitivityGlobs)) {
    maxWeight = Math.max(maxWeight, rule.weight);
  }

  return clampScore(maxWeight);
};

function computeComplexityScore(diff: DiffContext): number {
  const totalHunks = diff.files.reduce((sum, f) => sum + f.hunks.length, 0);
  const totalFiles = diff.files.length;

  const hunkScore = Math.min(totalHunks / 20, 1);
  const fileScore = Math.min(totalFiles / 10, 1);

  const addedLines = diff.rawDiff
    .split("\n")
    .filter((l) => l.startsWith("+") && !l.startsWith("+++")).length;
  const removedLines = diff.rawDiff
    .split("\n")
    .filter((l) => l.startsWith("-") && !l.startsWith("---")).length;
  const churnScore = Math.min((addedLines + removedLines) / 200, 1);

  return clampScore(hunkScore * 0.3 + fileScore * 0.3 + churnScore * 0.4);
}

function computeCoverageGap(diff: DiffContext): number {
  if (diff.files.length === 0) {
    return 0;
  }

  const uncoveredCount = diff.files.filter(
    (f) => f.existingTestFile === null,
  ).length;

  return clampScore(uncoveredCount / diff.files.length);
}

function computeRiskFactors(
  diff: DiffContext,
  options: Pick<RiskScoreOptions, "sensitivityGlobs"> = {},
): RiskFactors {
  const defectHistory = diff.riskFactors ? diff.riskFactors.defectHistory : 0;

  return {
    sensitivityScore: calculateSensitivityScore(diff, options.sensitivityGlobs),
    complexityScore: computeComplexityScore(diff),
    coverageGap: computeCoverageGap(diff),
    defectHistory,
  };
}

const readHistoryTouches = async (
  repoRoot: string,
  filePath: string,
): Promise<number> => {
  try {
    const result = await runCommand(
      "git",
      ["rev-list", "--count", "HEAD", "--", filePath],
      { cwd: repoRoot },
    );
    const count = Number.parseInt(result.stdout.trim(), 10);

    if (Number.isNaN(count)) {
      throw new Error(`Unexpected git history count: ${result.stdout.trim()}`);
    }

    return count;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Failed to read git history for ${filePath}: ${message}`, {
      cause: error,
    });
  }
};

const calculateDefectHistory = async (
  repoRoot: string,
  files: readonly ChangedFile[],
): Promise<DefectHistoryResult> => {
  if (files.length === 0) {
    return {
      score: 0,
      available: true,
    };
  }

  try {
    const touchCounts = await mapConcurrent(
      files,
      gitHistoryConcurrency,
      async (file) => readHistoryTouches(repoRoot, file.path),
    );
    const totalTouches = touchCounts.reduce((sum, count) => sum + count, 0);

    return {
      score: clampScore(totalTouches / files.length / 25),
      available: true,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.warn(
      `Failed to calculate defect history, omitting history from risk score: ${message}`,
    );
    return {
      score: 0,
      available: false,
    };
  }
};

const buildRiskReasons = (
  diff: DiffContext,
  factors: RiskFactors,
  options: RiskScoreOptions,
): string[] => {
  const reasons: string[] = [];

  if (
    diff.files.some((file) => file.touchesPayments) ||
    matchesSensitivityLabel(diff, "payments")
  ) {
    reasons.push("Touches payment or billing flows.");
  }

  if (
    diff.files.some((file) => file.touchesAuth) ||
    matchesSensitivityLabel(diff, "auth")
  ) {
    reasons.push("Touches authentication or session logic.");
  }

  if (
    diff.files.some((file) => file.touchesAccessControl) ||
    matchesSensitivityLabel(diff, "access-control")
  ) {
    reasons.push("Touches authorization or access-control logic.");
  }

  if (
    diff.files.some((file) => file.touchesDataModel) ||
    matchesSensitivityLabel(diff, "data-model")
  ) {
    reasons.push("Touches schema or data-model logic.");
  }

  if (matchesSensitivityLabel(diff, "secrets")) {
    reasons.push("Touches encryption, secrets, or credential handling.");
  }

  for (const rule of customSensitivityMatches(diff, options.sensitivityGlobs)) {
    reasons.push(`Matches custom sensitivity rule: ${rule.label}.`);
  }

  if (factors.coverageGap >= 0.5) {
    reasons.push("A large portion of changed files do not have nearby tests.");
  }

  if (factors.complexityScore >= 0.5) {
    reasons.push("The diff spans multiple hunks or a high line count.");
  }

  if (!options.defectHistoryAvailable) {
    reasons.push(
      "Git history could not be read, so defect-history risk was omitted from scoring.",
    );
  }

  if (factors.defectHistory >= 0.5) {
    reasons.push("The touched files have a high historical churn count.");
  }

  if (reasons.length === 0 && diff.files.length > 0) {
    reasons.push("General code churn exceeds the low-risk baseline.");
  }

  return reasons;
};

function computeRiskScore(
  diff: DiffContext,
  options: RiskScoreOptions = {},
): number {
  const factors = diff.riskFactors ?? computeRiskFactors(diff, options);
  const defectHistoryWeight =
    options.defectHistoryAvailable === false ? 0 : 0.15;
  const totalWeight = 0.4 + 0.25 + 0.2 + defectHistoryWeight;

  if (totalWeight === 0) {
    return 0;
  }

  return clampScore(
    (factors.sensitivityScore * 0.4 +
      factors.complexityScore * 0.25 +
      factors.coverageGap * 0.2 +
      factors.defectHistory * defectHistoryWeight) /
      totalWeight,
  );
}

const computeRiskAnalysis = async (
  repoRoot: string,
  diffContext: DiffContext,
  options: Pick<RiskScoreOptions, "sensitivityGlobs"> = {},
): Promise<RiskAnalysis> => {
  const defectHistory = await calculateDefectHistory(
    repoRoot,
    diffContext.files,
  );
  const factors = {
    ...computeRiskFactors(diffContext, options),
    defectHistory: defectHistory.score,
  };

  return {
    score: computeRiskScore(
      {
        ...diffContext,
        riskFactors: factors,
      },
      {
        defectHistoryAvailable: defectHistory.available,
        sensitivityGlobs: options.sensitivityGlobs,
      },
    ),
    factors,
    reasons: buildRiskReasons(diffContext, factors, {
      defectHistoryAvailable: defectHistory.available,
      sensitivityGlobs: options.sensitivityGlobs,
    }),
  };
};

const applyRiskAnalysis = async (
  repoRoot: string,
  diffContext: DiffContext,
  options: Pick<RiskScoreOptions, "sensitivityGlobs"> = {},
): Promise<DiffContext> => {
  const riskAnalysis = await computeRiskAnalysis(
    repoRoot,
    diffContext,
    options,
  );

  return {
    ...diffContext,
    riskScore: riskAnalysis.score,
    riskFactors: riskAnalysis.factors,
    riskReasons: riskAnalysis.reasons,
  };
};

export type { RiskAnalysis };
export {
  applyRiskAnalysis,
  computeRiskAnalysis,
  computeRiskFactors,
  computeRiskScore,
};

import type { DiffContext, RiskFactors } from "./types.js";

const sensitivityPatterns: ReadonlyArray<{
  pattern: RegExp;
  weight: number;
}> = [
  { pattern: /auth|login|session|token|jwt|oauth/i, weight: 0.9 },
  { pattern: /payment|billing|charge|stripe|subscription/i, weight: 0.95 },
  { pattern: /permission|role|rbac|acl|access/i, weight: 0.85 },
  { pattern: /encrypt|decrypt|hash|secret|credential/i, weight: 0.9 },
  { pattern: /database|migration|schema|model/i, weight: 0.7 },
  { pattern: /api\/|route|endpoint|middleware/i, weight: 0.6 },
  { pattern: /config|env|setting/i, weight: 0.5 },
  { pattern: /util|helper|lib/i, weight: 0.3 },
  { pattern: /test|spec|mock|fixture/i, weight: 0.1 },
];

function computeSensitivityScore(diff: DiffContext): number {
  let maxWeight = 0;

  for (const file of diff.files) {
    for (const { pattern, weight } of sensitivityPatterns) {
      if (pattern.test(file.path) || pattern.test(diff.rawDiff)) {
        maxWeight = Math.max(maxWeight, weight);
      }
    }
  }

  return maxWeight;
}

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

  return hunkScore * 0.3 + fileScore * 0.3 + churnScore * 0.4;
}

function computeCoverageGap(diff: DiffContext): number {
  if (diff.files.length === 0) {
    return 0;
  }

  const uncoveredCount = diff.files.filter(
    (f) => f.existingTestFile === null,
  ).length;

  return uncoveredCount / diff.files.length;
}

function computeRiskFactors(diff: DiffContext): RiskFactors {
  return {
    sensitivityScore: computeSensitivityScore(diff),
    complexityScore: computeComplexityScore(diff),
    coverageGap: computeCoverageGap(diff),
    defectHistory: 0,
  };
}

function computeRiskScore(diff: DiffContext): number {
  const factors = computeRiskFactors(diff);

  return (
    factors.sensitivityScore * 0.4 +
    factors.complexityScore * 0.25 +
    factors.coverageGap * 0.2 +
    factors.defectHistory * 0.15
  );
}

export { computeRiskFactors, computeRiskScore };

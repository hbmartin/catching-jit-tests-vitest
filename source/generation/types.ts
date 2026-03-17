interface MutantTarget {
  readonly kind: "mutant";
  readonly mutantDiff: string;
  readonly mutantDescription: string;
}

interface RiskTarget {
  readonly kind: "risk";
  readonly riskDescription: string;
  readonly prDiff: string;
}

type TargetBehavior = MutantTarget | RiskTarget;

interface ProjectContext {
  readonly availableImports: readonly string[];
  readonly tsConfigPath: string | null;
  readonly packageJsonPath: string | null;
}

interface TestSynthesisRequest {
  readonly targetSource: string;
  readonly targetPath: string;
  readonly fullFileSource: string;
  readonly existingTests: string | null;
  readonly targetBehavior: TargetBehavior;
  readonly projectContext: ProjectContext;
}

interface GeneratedTest {
  readonly code: string;
  readonly targetSymbol: string;
  readonly testFilePath: string;
  readonly behaviorDescription: string;
  readonly workflow: "dodgy-diff" | "intent-aware";
  readonly generatorConfidence: number;
}

interface GenerationResult {
  readonly tests: readonly GeneratedTest[];
  readonly workflow: "dodgy-diff" | "intent-aware";
  readonly duration: number;
}

interface InferredRisk {
  readonly id: string;
  readonly description: string;
  readonly targetSymbol: string;
  readonly severity: "low" | "medium" | "high" | "critical";
  readonly mutantHint: string | null;
}

interface MutantCandidate {
  readonly risk: InferredRisk;
  readonly mutantCode: string;
  readonly filePath: string;
}

export type {
  GeneratedTest,
  GenerationResult,
  InferredRisk,
  MutantCandidate,
  MutantTarget,
  ProjectContext,
  RiskTarget,
  TargetBehavior,
  TestSynthesisRequest,
};

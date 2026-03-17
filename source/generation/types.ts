import type {
  GeneratedTest as RuntimeGeneratedTest,
  InferredRisk as RuntimeInferredRisk,
} from "../runtime-schemas.js";

type GeneratedTest = RuntimeGeneratedTest;
type InferredRisk = RuntimeInferredRisk;

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
  readonly targetSymbol: string;
  readonly workflow: "dodgy-diff" | "intent-aware";
  readonly candidateKey: string;
}

interface GenerationResult {
  readonly tests: readonly GeneratedTest[];
  readonly workflow: "dodgy-diff" | "intent-aware";
  readonly duration: number;
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

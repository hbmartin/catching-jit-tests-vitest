interface DiffHunk {
  readonly header: string;
  readonly oldStart: number;
  readonly oldLines: number;
  readonly newStart: number;
  readonly newLines: number;
  readonly content: string;
}

interface ChangedFunction {
  readonly name: string;
  readonly filePath: string;
  readonly parentSource: string;
  readonly childSource: string;
  readonly hunks: readonly DiffHunk[];
  readonly signature: string;
  readonly requiredImports: readonly string[];
  readonly hasCoverage: boolean;
}

interface ChangedSymbol {
  readonly name: string;
  readonly kind:
    | "function"
    | "class"
    | "method"
    | "variable"
    | "type"
    | "interface";
  readonly filePath: string;
  readonly exportType: "named" | "default" | "internal";
}

interface ChangedFile {
  readonly path: string;
  readonly hunks: readonly DiffHunk[];
  readonly existingTestFile: string | null;
  readonly changedExports: readonly string[];
  readonly changedFunctions: readonly ChangedFunction[];
  readonly touchesAuth: boolean;
  readonly touchesPayments: boolean;
  readonly touchesDataModel: boolean;
  readonly touchesAccessControl: boolean;
}

interface DiffContext {
  readonly rawDiff: string;
  readonly pr: {
    readonly title: string;
    readonly body: string;
    readonly branch: string;
    readonly baseSha: string;
    readonly headSha: string;
  };
  readonly files: readonly ChangedFile[];
  readonly riskScore: number;
  readonly changedSymbols: readonly ChangedSymbol[];
}

interface SignatureChange {
  readonly name: string;
  readonly oldSignature: string;
  readonly newSignature: string;
}

interface FunctionInfo {
  readonly name: string;
  readonly body: string;
  readonly startLine: number;
  readonly endLine: number;
}

interface ASTAnalysis {
  readonly modifiedFunctions: readonly FunctionInfo[];
  readonly addedExports: readonly string[];
  readonly removedExports: readonly string[];
  readonly changedSignatures: readonly SignatureChange[];
  readonly controlFlowChanged: boolean;
  readonly errorHandlingChanged: boolean;
}

interface RiskFactors {
  readonly sensitivityScore: number;
  readonly complexityScore: number;
  readonly coverageGap: number;
  readonly defectHistory: number;
}

export type {
  ASTAnalysis,
  ChangedFile,
  ChangedFunction,
  ChangedSymbol,
  DiffContext,
  DiffHunk,
  FunctionInfo,
  RiskFactors,
  SignatureChange,
};

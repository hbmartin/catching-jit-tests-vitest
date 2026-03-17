import type { TestResult } from "../execution/types.js";
import type { GeneratedTest } from "../generation/types.js";

type BehaviorChangeType =
  | "return-value-changed"
  | "exception-introduced"
  | "exception-removed"
  | "null-introduced"
  | "boolean-flipped"
  | "output-shape-changed"
  | "ordering-changed"
  | "missing-key"
  | "type-changed"
  | "other";

interface BehaviorChange {
  readonly summary: string;
  readonly parentBehavior: string;
  readonly childBehavior: string;
  readonly changeType: BehaviorChangeType;
}

interface WeakCatch {
  readonly test: GeneratedTest;
  readonly parentResult: TestResult;
  readonly childResult: TestResult;
  readonly behaviorChange: BehaviorChange;
}

export type { BehaviorChange, BehaviorChangeType, WeakCatch };

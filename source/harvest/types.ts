import type {
  BehaviorChange as RuntimeBehaviorChange,
  HardeningCandidate as RuntimeHardeningCandidate,
  WeakCatch as RuntimeWeakCatch,
} from "../runtime-schemas.js";

type BehaviorChange = RuntimeBehaviorChange;
type HardeningCandidate = RuntimeHardeningCandidate;
type WeakCatch = RuntimeWeakCatch;

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

export type {
  BehaviorChange,
  BehaviorChangeType,
  HardeningCandidate,
  WeakCatch,
};

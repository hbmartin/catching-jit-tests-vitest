import type {
  Assessment,
  DetectedPattern,
  PatternMatch,
  RubFakeRule,
  RuleContext,
} from "./types.js";

const mockFailurePatterns = [
  /Cannot spy the .+ property because it is not a function/,
  /vi\.mock.*is not a function/,
  /mock.*implementation.*undefined/i,
  /Mocked .+ received .+ calls, expected/,
  /Failed to resolve module.*vi\.mock/,
];

const infraFailurePatterns = [
  /ECONNREFUSED/,
  /ETIMEDOUT/,
  /ENOTFOUND/,
  /Failed to fetch/,
  /socket hang up/,
  /ENOMEM/,
  /heap out of memory/,
  /worker.*terminated/i,
];

const typeErrorPatterns = [
  /Type '(.+)' is not assignable to type '(.+)'/,
  /Expected .+ arguments, but got \d+/,
  /Property '(.+)' does not exist on type/,
  /Cannot read properties of undefined \(reading '(.+)'\)/,
];

const notImplementedPatterns = [
  /not implemented/i,
  /NotImplemented(Error|Exception)?/,
  /TODO.*implement/i,
];

const dataProviderFailurePatterns = [
  /data provider/i,
  /Invalid test cases/i,
  /each table must be an array/i,
];
const parameterizedTestPattern = /\b(?:describe|it|test)\.each\b/;

const undefinedVariablePatterns = [
  /ReferenceError: .+ is not defined/,
  /Cannot find name '(.+)'/,
];

const flakinessPatterns = [
  /timeout/i,
  /timed out/i,
  /flaky/i,
  /random/i,
  /Exceeded timeout/i,
];

const heavyMockPattern = /vi\.(mock|spyOn|fn)/g;
const callCountPattern = /toHaveBeenCalledTimes\(\d+\)/;
const toEqualPattern = /toEqual.*\{/;
const serializesPattern = /Received.*serializes to the same string/;
const privateMemberPattern = /\['_\w+'\]|\.#\w+|private|protected/;

const reflectionPatterns = [
  /\.constructor\.name/,
  /Object\.getPrototypeOf/,
  /typeof .+ === ['"]function['"]/,
  /\.toString\(\).*includes/,
];

const snapshotMismatchPattern = /Snapshot .+ mismatched/;
const toMatchSnapshotPattern = /toMatchSnapshot/;
const toMatchInlineSnapshotPattern = /toMatchInlineSnapshot/;

const emptyContainerPatterns = [
  /Cannot read properties of .+ \(reading '\d+'\)/,
  /index out of range/i,
  /\.length.*0.*expected/i,
  /empty array/i,
];

const keyFailurePatterns = [
  /key out of bounds/i,
  /missing key/i,
  /property .+ does not exist/i,
  /Cannot read properties of .+ \(reading ['"].+['"]\)/,
];

const createFailurePatterns = [
  /cannot construct/i,
  /failed to create/i,
  /cannot instantiate/i,
  /is not a constructor/i,
  /Cannot read (?:properties|property) of .+ \(reading ['"]constructor['"]\)/i,
];

const refactorSignals = [
  /refactor/i,
  /rename/i,
  /clean.?up/i,
  /reorganiz/i,
  /extract/i,
  /move.*to/i,
  /split/i,
  /consolidat/i,
];

const addOnlySignals = [
  /add.*logging/i,
  /add.*telemetry/i,
  /add.*metric/i,
  /add.*feature flag/i,
  /new endpoint/i,
  /add.*field/i,
];

const deadCodeSignals = [
  /dead code/i,
  /unused/i,
  /remove.*unreachable/i,
  /delete.*unused/i,
];

const rbacSignals = [
  /rbac/i,
  /role/i,
  /permission/i,
  /access control/i,
  /authorization/i,
];
const diffChangedLinePattern = /^[+-]/;
const booleanLogicPattern =
  /\b(true|false)\b|!|&&|\|\||===|!==|<=|>=|(?:\s[<>]\s)/;
const nullishPattern = /\b(null|undefined)\b/;

function diffText(ctx: RuleContext): string {
  return ctx.diff.rawDiff;
}

function intentText(ctx: RuleContext): string {
  return `${ctx.diff.pr.title}\n${ctx.diff.pr.body}`;
}

function hasDirectBooleanChange(ctx: RuleContext): boolean {
  return diffText(ctx)
    .split("\n")
    .some(
      (line) =>
        diffChangedLinePattern.test(line) && booleanLogicPattern.test(line),
    );
}

function hasDirectNullishChange(ctx: RuleContext): boolean {
  return diffText(ctx)
    .split("\n")
    .some(
      (line) => diffChangedLinePattern.test(line) && nullishPattern.test(line),
    );
}

function touchesAccessControl(ctx: RuleContext): boolean {
  return (
    ctx.diff.files.some((file) => file.touchesAccessControl) ||
    rbacSignals.some((pattern) => pattern.test(diffText(ctx)))
  );
}

const falsePositiveRules: readonly RubFakeRule[] = [
  {
    name: "broken_mock",
    direction: "false-positive",
    confidence: "high",
    sources: ["execution-log", "test-code"],
    evaluate(ctx: RuleContext): PatternMatch | null {
      for (const pattern of mockFailurePatterns) {
        if (pattern.test(ctx.executionLog)) {
          const match = pattern.exec(ctx.executionLog);
          return {
            score: -0.9,
            evidence: `Mock failure detected: ${match?.[0] ?? "unknown"}`,
          };
        }
      }

      const mockMatches = ctx.testCode.match(heavyMockPattern);
      const mockCount = mockMatches ? mockMatches.length : 0;
      if (mockCount > 5) {
        return {
          score: -0.4,
          evidence: `Heavy mocking detected (${String(mockCount)} mock calls) — brittle test`,
        };
      }

      return null;
    },
  },
  {
    name: "type_mismatch",
    direction: "false-positive",
    confidence: "high",
    sources: ["execution-log"],
    evaluate(ctx: RuleContext): PatternMatch | null {
      for (const pattern of typeErrorPatterns) {
        const match = pattern.exec(ctx.executionLog);
        if (match) {
          const errorInTest = ctx.executionLog.includes(
            ctx.weakCatch.test.testFilePath,
          );
          if (errorInTest) {
            return {
              score: -0.8,
              evidence: `Type error in generated test code: ${match[0]}`,
            };
          }
        }
      }
      return null;
    },
  },
  {
    name: "infrastructure_failure",
    direction: "false-positive",
    confidence: "high",
    sources: ["execution-log"],
    evaluate(ctx: RuleContext): PatternMatch | null {
      for (const pattern of infraFailurePatterns) {
        if (pattern.test(ctx.executionLog)) {
          const match = pattern.exec(ctx.executionLog);
          return {
            score: -1.0,
            evidence: `Infrastructure failure: ${match?.[0] ?? "unknown"}`,
          };
        }
      }
      return null;
    },
  },
  {
    name: "not_implemented_exception",
    direction: "false-positive",
    confidence: "high",
    sources: ["execution-log"],
    evaluate(ctx: RuleContext): PatternMatch | null {
      const matched = notImplementedPatterns.some((pattern) =>
        pattern.test(ctx.executionLog),
      );
      if (!matched) {
        return null;
      }

      return {
        score: -0.9,
        evidence:
          "Failure appears to come from an intentional not-implemented placeholder",
      };
    },
  },
  {
    name: "data_provider_broken",
    direction: "false-positive",
    confidence: "high",
    sources: ["execution-log", "test-code"],
    evaluate(ctx: RuleContext): PatternMatch | null {
      const matched = dataProviderFailurePatterns.some((pattern) =>
        pattern.test(ctx.executionLog),
      );
      if (!(matched && parameterizedTestPattern.test(ctx.testCode))) {
        return null;
      }

      return {
        score: -0.8,
        evidence: "Generated parameterized test data appears malformed",
      };
    },
  },
  {
    name: "undefined_variable",
    direction: "false-positive",
    confidence: "high",
    sources: ["execution-log", "test-code"],
    evaluate(ctx: RuleContext): PatternMatch | null {
      const matched = undefinedVariablePatterns.some((pattern) =>
        pattern.test(ctx.executionLog),
      );
      const errorInGeneratedTest = ctx.executionLog.includes(
        ctx.weakCatch.test.testFilePath,
      );
      if (!(matched && errorInGeneratedTest)) {
        return null;
      }

      return {
        score: -0.8,
        evidence: "Generated test refers to an undefined variable or symbol",
      };
    },
  },
  {
    name: "implementation_dependent",
    direction: "false-positive",
    confidence: "high",
    sources: ["test-code", "execution-log"],
    evaluate(ctx: RuleContext): PatternMatch | null {
      if (callCountPattern.test(ctx.testCode)) {
        return {
          score: -0.6,
          evidence:
            "Test asserts specific call count — implementation dependent",
        };
      }

      if (
        toEqualPattern.test(ctx.testCode) &&
        (serializesPattern.test(ctx.executionLog) ||
          ctx.weakCatch.behaviorChange.changeType === "ordering-changed")
      ) {
        return {
          score: -0.7,
          evidence:
            "Object property ordering mismatch — implementation dependent",
        };
      }

      if (privateMemberPattern.test(ctx.testCode)) {
        return {
          score: -0.8,
          evidence: "Test accesses private/internal members",
        };
      }

      return null;
    },
  },
  {
    name: "reflection_brittle",
    direction: "false-positive",
    confidence: "high",
    sources: ["test-code"],
    evaluate(ctx: RuleContext): PatternMatch | null {
      for (const pattern of reflectionPatterns) {
        if (pattern.test(ctx.testCode)) {
          return {
            score: -0.7,
            evidence: "Test uses reflection — inherently brittle",
          };
        }
      }
      return null;
    },
  },
  {
    name: "snapshot_mismatch",
    direction: "false-positive",
    confidence: "medium",
    sources: ["execution-log"],
    evaluate(ctx: RuleContext): PatternMatch | null {
      const usesSnapshots =
        toMatchSnapshotPattern.test(ctx.testCode) ||
        toMatchInlineSnapshotPattern.test(ctx.testCode);
      if (usesSnapshots && snapshotMismatchPattern.test(ctx.executionLog)) {
        return {
          score: -0.5,
          evidence:
            "Snapshot-based assertion — high FP rate for catching tests",
        };
      }
      return null;
    },
  },
  {
    name: "flakiness",
    direction: "false-positive",
    confidence: "low",
    sources: ["execution-log", "test-code"],
    evaluate(ctx: RuleContext): PatternMatch | null {
      const combined = `${ctx.executionLog}\n${ctx.testCode}`;
      const matched = flakinessPatterns.some((pattern) =>
        pattern.test(combined),
      );
      if (!matched) {
        return null;
      }

      return {
        score: -0.2,
        evidence: "Failure contains timing or nondeterminism signals",
      };
    },
  },
];

const truePositiveRules: readonly RubFakeRule[] = [
  {
    name: "changed_bool",
    direction: "true-positive",
    confidence: "medium",
    sources: ["execution-log", "diff"],
    evaluate(ctx: RuleContext): PatternMatch | null {
      if (ctx.weakCatch.behaviorChange.changeType !== "boolean-flipped") {
        return null;
      }

      if (hasDirectBooleanChange(ctx)) {
        return {
          score: 0.35,
          evidence:
            "Boolean flipped, but the diff directly changes boolean logic",
        };
      }

      return {
        score: 0.7,
        evidence: "Boolean flipped from true to false (or vice versa)",
      };
    },
  },
  {
    name: "null_value",
    direction: "true-positive",
    confidence: "medium",
    sources: ["execution-log", "diff"],
    evaluate(ctx: RuleContext): PatternMatch | null {
      if (ctx.weakCatch.behaviorChange.changeType !== "null-introduced") {
        return null;
      }

      if (hasDirectNullishChange(ctx)) {
        return {
          score: 0.4,
          evidence:
            "A value became null/undefined, but the diff directly changes nullish logic",
        };
      }

      return {
        score: 0.75,
        evidence: "A value became null/undefined",
      };
    },
  },
  {
    name: "empty_container",
    direction: "true-positive",
    confidence: "medium",
    sources: ["execution-log", "diff"],
    evaluate(ctx: RuleContext): PatternMatch | null {
      if (
        ctx.weakCatch.behaviorChange.changeType !== "null-introduced" &&
        ctx.weakCatch.behaviorChange.changeType !== "exception-introduced"
      ) {
        return null;
      }

      const matched = emptyContainerPatterns.some((p) =>
        p.test(ctx.executionLog),
      );
      if (!matched) {
        return null;
      }

      return {
        score: 0.65,
        evidence: "A container/array became empty, causing an access failure",
      };
    },
  },
  {
    name: "unexpected_key_change",
    direction: "true-positive",
    confidence: "medium",
    sources: ["execution-log", "diff"],
    evaluate(ctx: RuleContext): PatternMatch | null {
      const isKeyChange =
        ctx.weakCatch.behaviorChange.changeType === "missing-key" ||
        keyFailurePatterns.some((pattern) => pattern.test(ctx.executionLog));
      if (!isKeyChange) {
        return null;
      }

      return {
        score: 0.7,
        evidence: "An expected key or property disappeared unexpectedly",
      };
    },
  },
  {
    name: "create_failure",
    direction: "true-positive",
    confidence: "medium",
    sources: ["execution-log", "diff"],
    evaluate(ctx: RuleContext): PatternMatch | null {
      const matched = createFailurePatterns.some((pattern) =>
        pattern.test(ctx.executionLog),
      );
      if (!matched) {
        return null;
      }

      return {
        score: 0.65,
        evidence: "Object creation now fails despite previously succeeding",
      };
    },
  },
  {
    name: "refactor_intent",
    direction: "true-positive",
    confidence: "medium",
    sources: ["diff"],
    evaluate(ctx: RuleContext): PatternMatch | null {
      const title = ctx.diff.pr.title.toLowerCase();
      const body = (ctx.diff.pr.body || "").toLowerCase();

      const isRefactor = refactorSignals.some(
        (p) => p.test(title) || p.test(body),
      );

      if (isRefactor) {
        return {
          score: 0.8,
          evidence:
            "PR intent appears to be refactoring, but behavior changed — likely unintended",
        };
      }

      return null;
    },
  },
  {
    name: "dead_code_removal",
    direction: "true-positive",
    confidence: "medium",
    sources: ["diff"],
    evaluate(ctx: RuleContext): PatternMatch | null {
      const intent = intentText(ctx);
      const isDeadCodeRemoval = deadCodeSignals.some((pattern) =>
        pattern.test(intent),
      );

      if (!isDeadCodeRemoval) {
        return null;
      }

      return {
        score: 0.8,
        evidence:
          "PR intent is dead-code removal, but observable behavior changed",
      };
    },
  },
  {
    name: "monotonic_change",
    direction: "true-positive",
    confidence: "medium",
    sources: ["diff"],
    evaluate(ctx: RuleContext): PatternMatch | null {
      const title = ctx.diff.pr.title.toLowerCase();
      const body = (ctx.diff.pr.body || "").toLowerCase();

      const isAddOnly = addOnlySignals.some(
        (p) => p.test(title) || p.test(body),
      );

      if (isAddOnly) {
        return {
          score: 0.7,
          evidence: "PR intent is additive-only, but existing behavior changed",
        };
      }

      return null;
    },
  },
  {
    name: "rbac",
    direction: "true-positive",
    confidence: "medium",
    sources: ["execution-log", "diff"],
    evaluate(ctx: RuleContext): PatternMatch | null {
      const mentionsRbac = rbacSignals.some((pattern) =>
        pattern.test(`${intentText(ctx)}\n${ctx.executionLog}`),
      );

      if (!(touchesAccessControl(ctx) || mentionsRbac)) {
        return null;
      }

      return {
        score: 0.75,
        evidence:
          "Access-control behavior changed; RBAC failures are high-impact and context-sensitive",
      };
    },
  },
];

function evaluateRubFake(ctx: RuleContext): Assessment {
  const allRules = [...falsePositiveRules, ...truePositiveRules];
  const detectedPatterns: DetectedPattern[] = [];
  let strongestScore = 0;
  let strongestMagnitude = 0;

  for (const rule of allRules) {
    const match = rule.evaluate(ctx);
    if (match) {
      detectedPatterns.push({
        name: rule.name,
        direction: rule.direction,
        confidence: rule.confidence,
        evidence: match.evidence,
      });

      const magnitude = Math.abs(match.score);
      if (magnitude > strongestMagnitude) {
        strongestMagnitude = magnitude;
        strongestScore = match.score;
      }
    }
  }

  const score = detectedPatterns.length > 0 ? strongestScore : 0;

  return {
    score,
    rationale: detectedPatterns
      .map((p) => `[${p.direction}:${p.name}] ${p.evidence}`)
      .join("; "),
    detectedPatterns,
    assessor: "rubfake",
  };
}

export { evaluateRubFake, falsePositiveRules, truePositiveRules };

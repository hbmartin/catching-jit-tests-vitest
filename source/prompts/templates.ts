function killMutantPrompt(vars: {
  parentSource: string;
  mutantSource: string;
  mutantDiff: string;
  importPath: string;
  existingTests: string | null;
}): string {
  const existingTestsSection = vars.existingTests
    ? `\n## Existing Test Style (match this)\n\`\`\`typescript\n${vars.existingTests}\n\`\`\``
    : "";

  return `You are generating a Vitest test case. Your goal is to write a test that will PASS on the original code but FAIL on the mutated version.

## Original Code (Parent)
\`\`\`typescript
${vars.parentSource}
\`\`\`

## Mutated Code (Child — treat as potentially buggy)
\`\`\`typescript
${vars.mutantSource}
\`\`\`

## Diff Between Original and Mutant
\`\`\`diff
${vars.mutantDiff}
\`\`\`
${existingTestsSection}

## Instructions

1. Analyze exactly what behavioral difference the mutation introduces
2. Write a Vitest test that:
   - Imports the function/class from '${vars.importPath}'
   - Sets up the minimal state needed to trigger the changed behavior
   - Asserts on the ORIGINAL (parent) behavior — the test should PASS when the original code is running
   - The assertion should FAIL when the mutated code is running
3. Be specific: test the exact behavioral difference, not a vague property
4. Use realistic test data, not trivial placeholder values
5. Do NOT test implementation details (private methods, internal state)
6. Do NOT use mocks unless absolutely necessary for external dependencies
7. Keep the test focused — one behavior per test case

## Output Format

Return ONLY the test file content as a single TypeScript code block. Include a JSDoc comment on the test describing the behavior being verified.

\`\`\`typescript
// your test here
\`\`\``;
}

function inferRisksPrompt(vars: {
  prTitle: string;
  prBody: string;
  rawDiff: string;
}): string {
  return `You are analyzing a code change (diff) to identify risks — ways the implementation could introduce bugs.

## PR Title
${vars.prTitle}

## PR Description
${vars.prBody}

## Code Diff
\`\`\`diff
${vars.rawDiff}
\`\`\`

## Instructions

1. First, describe the INTENT of this change in 1-2 sentences
2. Then enumerate specific risks — concrete ways a developer could make a mistake while implementing this intent
3. Focus on risks that:
   - Would compile and pass existing tests (subtle bugs)
   - Involve edge cases, boundary conditions, null/undefined handling
   - Could cause silent data corruption or wrong results
   - Involve state management errors
   - Involve off-by-one errors in loops or conditions
   - Could break backward compatibility
   - Involve concurrency or ordering assumptions

## Output Format

Return JSON (no markdown fencing):

{
  "intent": "string describing what the change does",
  "risks": [
    {
      "id": "risk_1",
      "description": "Concise description of what could go wrong",
      "targetSymbol": "functionName or ClassName.methodName",
      "severity": "low|medium|high|critical",
      "mutantHint": "Description of a code change to the PARENT that would exhibit this risk (for mutant generation)"
    }
  ]
}`;
}

function generateMutantPrompt(vars: {
  parentSource: string;
  filePath: string;
  riskDescription: string;
  mutantHint: string;
  targetSymbol: string;
}): string {
  return `You are generating a mutant (modified version) of source code that represents a specific risk materializing.

## Original Source Code
\`\`\`typescript
${vars.parentSource}
\`\`\`

## File Path
${vars.filePath}

## Risk to Represent
${vars.riskDescription}

## Hint for Mutation
${vars.mutantHint}

## Target Symbol
${vars.targetSymbol}

## Instructions

1. Create a modified version of the source code that:
   - Introduces the bug described in the risk
   - Still compiles correctly
   - Would likely pass existing unit tests
   - Represents a realistic mistake a developer could make
2. Make the MINIMAL change needed to represent this risk
3. Do NOT add comments explaining the mutation

## Output Format

Return ONLY the modified source code as a TypeScript code block:

\`\`\`typescript
// modified source
\`\`\``;
}

function judgeCatchPrompt(vars: {
  diff: string;
  inferredIntent: string;
  testCode: string;
  failureMessage: string;
  parentBehavior: string;
  childBehavior: string;
  changeType: string;
}): string {
  return `You are a code reviewer determining whether a test failure reveals an UNEXPECTED BUG in a code change, or whether the test failure simply reflects an INTENDED behavioral change.

## The Code Change (Diff)
\`\`\`diff
${vars.diff}
\`\`\`

## Inferred Intent of the Change
${vars.inferredIntent}

## The Failing Test
\`\`\`typescript
${vars.testCode}
\`\`\`

## Test Failure Output
${vars.failureMessage}

## Observed Behavioral Change
- Before (parent): ${vars.parentBehavior}
- After (child): ${vars.childBehavior}
- Change type: ${vars.changeType}

## Instructions

Classify this test failure:

1. Is the behavioral change EXPECTED given the stated intent of the diff?
   - If the diff is supposed to change X, and the test catches a change in X, that is an INTENDED change (false positive)
   - If the diff is supposed to change X, but the test catches a change in Y (where Y should not have been affected), that is UNEXPECTED (true positive)

2. Consider whether the test itself might be flawed:
   - Does it rely on implementation details?
   - Does it use fragile mocking?
   - Does it test something overly specific?

## Output Format

Return JSON (no markdown fencing):

{
  "isUnexpectedBug": true|false,
  "confidence": "high"|"medium"|"low",
  "explanation": "1-2 sentence rationale"
}`;
}

export {
  generateMutantPrompt,
  inferRisksPrompt,
  judgeCatchPrompt,
  killMutantPrompt,
};

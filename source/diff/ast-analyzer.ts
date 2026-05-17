import ts from "typescript";

import type { ASTAnalysis, FunctionInfo, SignatureChange } from "./types.js";

interface FunctionEntry {
  readonly fn: FunctionInfo;
  readonly index: number;
}

interface FunctionPair {
  readonly parent?: FunctionEntry;
  readonly child?: FunctionEntry;
}

function createMatchKey(name: string, occurrence: number): string {
  return `${name}:${String(occurrence)}`;
}

function withMatchKey(fn: FunctionInfo, matchKey: string): FunctionInfo {
  return {
    ...fn,
    matchKey,
  };
}

function getMethodContainerName(node: ts.MethodDeclaration): string | null {
  const { parent } = node;
  if (ts.isClassLike(parent) && parent.name) {
    return parent.name.text;
  }

  if (ts.isObjectLiteralExpression(parent)) {
    const variableDeclaration = parent.parent;
    if (
      variableDeclaration &&
      ts.isVariableDeclaration(variableDeclaration) &&
      ts.isIdentifier(variableDeclaration.name)
    ) {
      return variableDeclaration.name.text;
    }
  }

  return null;
}

function toQualifiedName(baseName: string, scope: string | null): string {
  return scope ? `${scope}.${baseName}` : baseName;
}

function extractNodeSignature(
  node: ts.Node,
  sourceFile: ts.SourceFile,
): string {
  const body =
    ts.isFunctionLike(node) && "body" in node ? node.body : undefined;
  if (body) {
    return sourceFile.text
      .slice(node.getStart(sourceFile), body.getStart(sourceFile))
      .trim();
  }

  const text = node.getText(sourceFile).trim();
  const arrowIndex = text.indexOf("=>");
  if (arrowIndex !== -1) {
    return text.slice(0, arrowIndex + 2).trim();
  }

  const braceIndex = text.indexOf("{");
  if (braceIndex !== -1) {
    return text.slice(0, braceIndex).trim();
  }

  return text;
}

function extractVariableSignature(
  statement: ts.VariableStatement,
  initializer: ts.ArrowFunction | ts.FunctionExpression,
  sourceFile: ts.SourceFile,
): string {
  const signatureStart =
    statement.declarationList.declarations.length === 1
      ? statement.getStart(sourceFile)
      : initializer.parent.getStart(sourceFile);
  return sourceFile.text
    .slice(signatureStart, initializer.body.getStart(sourceFile))
    .trim();
}

function extractFunctions(sourceFile: ts.SourceFile): FunctionInfo[] {
  const functions: FunctionInfo[] = [];

  function pushFunction(fn: Omit<FunctionInfo, "matchKey">): void {
    functions.push({
      ...fn,
      matchKey: createMatchKey(fn.name, functions.length + 1),
    });
  }

  function visit(node: ts.Node): void {
    if (ts.isFunctionDeclaration(node) && node.name && node.body) {
      const start = sourceFile.getLineAndCharacterOfPosition(node.getStart());
      const end = sourceFile.getLineAndCharacterOfPosition(node.getEnd());
      pushFunction({
        name: node.name.text,
        body: node.getText(sourceFile),
        signature: extractNodeSignature(node, sourceFile),
        startLine: start.line,
        endLine: end.line,
      });
    }

    if (ts.isMethodDeclaration(node) && node.name && node.body) {
      const start = sourceFile.getLineAndCharacterOfPosition(node.getStart());
      const end = sourceFile.getLineAndCharacterOfPosition(node.getEnd());
      const nameText = ts.isIdentifier(node.name)
        ? node.name.text
        : node.name.getText(sourceFile);
      const qualifiedName = toQualifiedName(
        nameText,
        getMethodContainerName(node),
      );
      pushFunction({
        name: qualifiedName,
        body: node.getText(sourceFile),
        signature: extractNodeSignature(node, sourceFile),
        startLine: start.line,
        endLine: end.line,
      });
    }

    if (ts.isVariableStatement(node)) {
      for (const decl of node.declarationList.declarations) {
        if (
          ts.isIdentifier(decl.name) &&
          decl.initializer &&
          (ts.isArrowFunction(decl.initializer) ||
            ts.isFunctionExpression(decl.initializer))
        ) {
          const start = sourceFile.getLineAndCharacterOfPosition(
            node.getStart(),
          );
          const end = sourceFile.getLineAndCharacterOfPosition(node.getEnd());
          pushFunction({
            name: decl.name.text,
            body: decl.getText(sourceFile),
            signature: extractVariableSignature(
              node,
              decl.initializer,
              sourceFile,
            ),
            startLine: start.line,
            endLine: end.line,
          });
        }
      }
    }

    ts.forEachChild(node, visit);
  }

  visit(sourceFile);
  return functions;
}

function extractExportNames(sourceFile: ts.SourceFile): Set<string> {
  const exports = new Set<string>();

  function visit(node: ts.Node): void {
    const modifiers = ts.canHaveModifiers(node)
      ? ts.getModifiers(node)
      : undefined;
    const isExported = modifiers?.some(
      (m) => m.kind === ts.SyntaxKind.ExportKeyword,
    );
    const isDefaultExport = modifiers?.some(
      (m) => m.kind === ts.SyntaxKind.DefaultKeyword,
    );

    if (isExported) {
      if (ts.isFunctionDeclaration(node) && node.name) {
        exports.add(node.name.text);
      } else if (ts.isClassDeclaration(node) && node.name) {
        exports.add(node.name.text);
      } else if (ts.isVariableStatement(node)) {
        for (const decl of node.declarationList.declarations) {
          if (ts.isIdentifier(decl.name)) {
            exports.add(decl.name.text);
          }
        }
      } else if (ts.isTypeAliasDeclaration(node)) {
        exports.add(node.name.text);
      } else if (ts.isInterfaceDeclaration(node)) {
        exports.add(node.name.text);
      }

      if (isDefaultExport) {
        exports.add("default");
      }
    }

    if (
      ts.isExportDeclaration(node) &&
      node.exportClause &&
      ts.isNamedExports(node.exportClause)
    ) {
      for (const element of node.exportClause.elements) {
        exports.add(element.name.text);
      }
    }

    ts.forEachChild(node, visit);
  }

  visit(sourceFile);
  return exports;
}

function hasControlFlowDifference(
  parentSource: ts.SourceFile,
  childSource: ts.SourceFile,
): boolean {
  let parentControlFlow = 0;
  let childControlFlow = 0;

  function countControlFlow(node: ts.Node, counter: { count: number }): void {
    if (
      ts.isIfStatement(node) ||
      ts.isForStatement(node) ||
      ts.isForInStatement(node) ||
      ts.isForOfStatement(node) ||
      ts.isWhileStatement(node) ||
      ts.isDoStatement(node) ||
      ts.isSwitchStatement(node) ||
      ts.isConditionalExpression(node) ||
      ts.isReturnStatement(node)
    ) {
      counter.count += 1;
    }
    ts.forEachChild(node, (n) => countControlFlow(n, counter));
  }

  const pCounter = { count: 0 };
  const cCounter = { count: 0 };
  countControlFlow(parentSource, pCounter);
  countControlFlow(childSource, cCounter);
  parentControlFlow = pCounter.count;
  childControlFlow = cCounter.count;

  return parentControlFlow !== childControlFlow;
}

function hasErrorHandlingDifference(
  parentSource: ts.SourceFile,
  childSource: ts.SourceFile,
): boolean {
  function countTryCatch(node: ts.Node): number {
    let count = 0;
    if (ts.isTryStatement(node)) {
      count += 1;
    }
    ts.forEachChild(node, (n) => {
      count += countTryCatch(n);
    });
    return count;
  }

  return countTryCatch(parentSource) !== countTryCatch(childSource);
}

function groupFunctionsByName(
  functions: readonly FunctionInfo[],
): Map<string, FunctionEntry[]> {
  const groups = new Map<string, FunctionEntry[]>();
  functions.forEach((fn, index) => {
    const group = groups.get(fn.name) ?? [];
    group.push({ fn, index });
    groups.set(fn.name, group);
  });
  return groups;
}

function tokenize(value: string): Set<string> {
  return new Set(value.match(/[A-Za-z0-9_]+/g) ?? []);
}

function bodySimilarity(left: string, right: string): number {
  const leftTokens = tokenize(left);
  const rightTokens = tokenize(right);
  if (leftTokens.size === 0 && rightTokens.size === 0) {
    return 1;
  }

  let common = 0;
  for (const token of leftTokens) {
    if (rightTokens.has(token)) {
      common += 1;
    }
  }

  return common / new Set([...leftTokens, ...rightTokens]).size;
}

function scoreFunctionPair(parent: FunctionInfo, child: FunctionInfo): number {
  const lineDistance = Math.abs(parent.startLine - child.startLine);
  return (
    (parent.signature === child.signature ? 100 : 0) +
    bodySimilarity(parent.body, child.body) * 20 -
    Math.min(lineDistance, 50) / 10
  );
}

function pairFunctionGroup(
  parentGroup: readonly FunctionEntry[],
  childGroup: readonly FunctionEntry[],
): FunctionPair[] {
  const pairs: FunctionPair[] = [];
  const pairedParents = new Set<number>();
  const pairedChildren = new Set<number>();

  for (const child of childGroup) {
    const exactParent = parentGroup.find(
      (parent) =>
        !pairedParents.has(parent.index) && parent.fn.body === child.fn.body,
    );
    if (exactParent) {
      pairs.push({ parent: exactParent, child });
      pairedParents.add(exactParent.index);
      pairedChildren.add(child.index);
    }
  }

  const candidates = parentGroup.flatMap((parent) =>
    childGroup.map((child) => ({
      parent,
      child,
      score: scoreFunctionPair(parent.fn, child.fn),
    })),
  );
  candidates.sort((left, right) => right.score - left.score);

  for (const candidate of candidates) {
    const isAlreadyPaired =
      pairedParents.has(candidate.parent.index) ||
      pairedChildren.has(candidate.child.index);
    if (!isAlreadyPaired) {
      pairs.push({
        parent: candidate.parent,
        child: candidate.child,
      });
      pairedParents.add(candidate.parent.index);
      pairedChildren.add(candidate.child.index);
    }
  }

  for (const parent of parentGroup) {
    if (!pairedParents.has(parent.index)) {
      pairs.push({ parent });
    }
  }
  for (const child of childGroup) {
    if (!pairedChildren.has(child.index)) {
      pairs.push({ child });
    }
  }

  return pairs.sort((left, right) => {
    const parentDelta =
      (left.parent?.index ?? Number.MAX_SAFE_INTEGER) -
      (right.parent?.index ?? Number.MAX_SAFE_INTEGER);
    if (parentDelta !== 0) {
      return parentDelta;
    }

    return (
      (left.child?.index ?? Number.MAX_SAFE_INTEGER) -
      (right.child?.index ?? Number.MAX_SAFE_INTEGER)
    );
  });
}

function stabilizeFunctionMatchKeys(
  parentFunctions: readonly FunctionInfo[],
  childFunctions: readonly FunctionInfo[],
): {
  parentFunctions: readonly FunctionInfo[];
  childFunctions: readonly FunctionInfo[];
} {
  const parentGroups = groupFunctionsByName(parentFunctions);
  const childGroups = groupFunctionsByName(childFunctions);
  const names = new Set([...parentGroups.keys(), ...childGroups.keys()]);
  const stableParents: FunctionInfo[] = [];
  const stableChildren: FunctionInfo[] = [];

  for (const name of names) {
    const pairs = pairFunctionGroup(
      parentGroups.get(name) ?? [],
      childGroups.get(name) ?? [],
    );

    pairs.forEach((pair, index) => {
      const matchKey = createMatchKey(name, index + 1);
      if (pair.parent) {
        stableParents[pair.parent.index] = withMatchKey(
          pair.parent.fn,
          matchKey,
        );
      }
      if (pair.child) {
        stableChildren[pair.child.index] = withMatchKey(
          pair.child.fn,
          matchKey,
        );
      }
    });
  }

  return {
    parentFunctions: stableParents.filter(Boolean),
    childFunctions: stableChildren.filter(Boolean),
  };
}

function diffFunctionSignatures(
  parentFunctions: readonly FunctionInfo[],
  childFunctions: readonly FunctionInfo[],
): SignatureChange[] {
  const changes: SignatureChange[] = [];
  const parentMap = new Map(parentFunctions.map((f) => [f.matchKey, f]));

  for (const childFn of childFunctions) {
    const parentFn = parentMap.get(childFn.matchKey);
    if (
      parentFn &&
      parentFn.body !== childFn.body &&
      parentFn.signature !== childFn.signature
    ) {
      changes.push({
        name: childFn.name,
        oldSignature: parentFn.signature,
        newSignature: childFn.signature,
      });
    }
  }

  return changes;
}

function analyzeFileChanges(
  parentSourceText: string,
  childSourceText: string,
  filePath: string,
): ASTAnalysis {
  const parentAST = ts.createSourceFile(
    filePath,
    parentSourceText,
    ts.ScriptTarget.Latest,
    true,
  );
  const childAST = ts.createSourceFile(
    filePath,
    childSourceText,
    ts.ScriptTarget.Latest,
    true,
  );

  const rawParentFunctions = extractFunctions(parentAST);
  const rawChildFunctions = extractFunctions(childAST);
  const { parentFunctions, childFunctions } = stabilizeFunctionMatchKeys(
    rawParentFunctions,
    rawChildFunctions,
  );

  const parentExports = extractExportNames(parentAST);
  const childExports = extractExportNames(childAST);

  const addedExports = [...childExports].filter((e) => !parentExports.has(e));
  const removedExports = [...parentExports].filter((e) => !childExports.has(e));

  const parentFunctionsByKey = new Map(
    parentFunctions.map((fn) => [fn.matchKey, fn]),
  );
  const modifiedFunctions = childFunctions.filter((cf) => {
    const parentFn = parentFunctionsByKey.get(cf.matchKey);
    return parentFn ? parentFn.body !== cf.body : true;
  });

  return {
    modifiedFunctions,
    parentFunctions,
    childFunctions,
    addedExports,
    removedExports,
    changedSignatures: diffFunctionSignatures(parentFunctions, childFunctions),
    controlFlowChanged: hasControlFlowDifference(parentAST, childAST),
    errorHandlingChanged: hasErrorHandlingDifference(parentAST, childAST),
  };
}

export { analyzeFileChanges, extractExportNames, extractFunctions };

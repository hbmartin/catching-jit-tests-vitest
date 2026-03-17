import ts from "typescript";

import type { ASTAnalysis, FunctionInfo, SignatureChange } from "./types.js";

function getMethodContainerName(node: ts.MethodDeclaration): string | null {
  const { parent } = node;
  if (ts.isClassLike(parent) && parent.name) {
    return parent.name.text;
  }

  if (ts.isObjectLiteralExpression(parent)) {
    const variableStatement = parent.parent?.parent;
    if (
      variableStatement &&
      ts.isVariableDeclaration(variableStatement) &&
      ts.isIdentifier(variableStatement.name)
    ) {
      return variableStatement.name.text;
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
  const text = node.getText(sourceFile).trim();
  const braceIndex = text.indexOf("{");
  if (braceIndex !== -1) {
    return text.slice(0, braceIndex).trim();
  }

  const arrowIndex = text.indexOf("=>");
  if (arrowIndex !== -1) {
    return text.slice(0, arrowIndex + 2).trim();
  }

  return text;
}

function extractFunctions(sourceFile: ts.SourceFile): FunctionInfo[] {
  const functions: FunctionInfo[] = [];

  function visit(node: ts.Node): void {
    if (ts.isFunctionDeclaration(node) && node.name) {
      const start = sourceFile.getLineAndCharacterOfPosition(node.getStart());
      const end = sourceFile.getLineAndCharacterOfPosition(node.getEnd());
      functions.push({
        name: node.name.text,
        body: node.getText(sourceFile),
        signature: extractNodeSignature(node, sourceFile),
        startLine: start.line,
        endLine: end.line,
      });
    }

    if (ts.isMethodDeclaration(node) && node.name) {
      const start = sourceFile.getLineAndCharacterOfPosition(node.getStart());
      const end = sourceFile.getLineAndCharacterOfPosition(node.getEnd());
      const nameText = ts.isIdentifier(node.name)
        ? node.name.text
        : node.name.getText(sourceFile);
      const qualifiedName = toQualifiedName(
        nameText,
        getMethodContainerName(node),
      );
      functions.push({
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
          functions.push({
            name: decl.name.text,
            body: node.getText(sourceFile),
            signature: extractNodeSignature(node, sourceFile),
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

function diffFunctionSignatures(
  parentFunctions: readonly FunctionInfo[],
  childFunctions: readonly FunctionInfo[],
): SignatureChange[] {
  const changes: SignatureChange[] = [];
  const parentMap = new Map(parentFunctions.map((f) => [f.name, f]));

  for (const childFn of childFunctions) {
    const parentFn = parentMap.get(childFn.name);
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

  const parentFunctions = extractFunctions(parentAST);
  const childFunctions = extractFunctions(childAST);

  const parentExports = extractExportNames(parentAST);
  const childExports = extractExportNames(childAST);

  const addedExports = [...childExports].filter((e) => !parentExports.has(e));
  const removedExports = [...parentExports].filter((e) => !childExports.has(e));

  const parentFnNames = new Set(parentFunctions.map((f) => f.name));
  const modifiedFunctions = childFunctions.filter((cf) => {
    if (!parentFnNames.has(cf.name)) {
      return true;
    }
    const pf = parentFunctions.find((f) => f.name === cf.name);
    return pf ? pf.body !== cf.body : true;
  });

  return {
    modifiedFunctions,
    addedExports,
    removedExports,
    changedSignatures: diffFunctionSignatures(parentFunctions, childFunctions),
    controlFlowChanged: hasControlFlowDifference(parentAST, childAST),
    errorHandlingChanged: hasErrorHandlingDifference(parentAST, childAST),
  };
}

export { analyzeFileChanges, extractExportNames, extractFunctions };

import ts from "typescript";
import { describe, expect, it } from "vitest";
import {
  analyzeFileChanges,
  extractExportNames,
  extractFunctions,
} from "../../source/diff/ast-analyzer.js";

describe("extractFunctions", () => {
  it("extracts function declarations", () => {
    const source = `function hello() { return "world"; }
function goodbye() { return "bye"; }`;
    const sf = ts.createSourceFile(
      "test.ts",
      source,
      ts.ScriptTarget.Latest,
      true,
    );
    const functions = extractFunctions(sf);
    expect(functions).toHaveLength(2);
    expect(functions[0]?.name).toBe("hello");
    expect(functions[1]?.name).toBe("goodbye");
  });

  it("extracts arrow function declarations", () => {
    const source = [
      "const greet = (name: string) => `Hello ",
      "$",
      "{name}`;",
    ].join("");
    const sf = ts.createSourceFile(
      "test.ts",
      source,
      ts.ScriptTarget.Latest,
      true,
    );
    const functions = extractFunctions(sf);
    expect(functions).toHaveLength(1);
    expect(functions[0]?.name).toBe("greet");
  });

  it("qualifies class method names", () => {
    const source = `class UserService {
  findById(id: string) {
    return id;
  }
}`;
    const sf = ts.createSourceFile(
      "test.ts",
      source,
      ts.ScriptTarget.Latest,
      true,
    );
    const functions = extractFunctions(sf);

    expect(functions[0]?.name).toBe("UserService.findById");
  });

  it("qualifies object literal method names", () => {
    const source = `const handlers = {
  format(value: string) {
    return value.trim();
  },
};`;
    const sf = ts.createSourceFile(
      "test.ts",
      source,
      ts.ScriptTarget.Latest,
      true,
    );
    const functions = extractFunctions(sf);

    expect(functions[0]?.name).toBe("handlers.format");
  });

  it("preserves signatures with object patterns and object return types", () => {
    const source = `function configure(
  { enabled }: { enabled: boolean },
): { enabled: boolean } {
  return { enabled };
}

const render = (
  { message }: { message: string },
): { message: string } => ({ message });`;
    const sf = ts.createSourceFile(
      "test.ts",
      source,
      ts.ScriptTarget.Latest,
      true,
    );
    const functions = extractFunctions(sf);

    expect(functions[0]?.signature).toBe(
      `function configure(
  { enabled }: { enabled: boolean },
): { enabled: boolean }`,
    );
    expect(functions[1]?.signature).toBe(
      `const render = (
  { message }: { message: string },
): { message: string } =>`,
    );
  });

  it("extracts variable signatures from the matching declarator", () => {
    const source = `const first = () => "one", second = () => "two";`;
    const sf = ts.createSourceFile(
      "test.ts",
      source,
      ts.ScriptTarget.Latest,
      true,
    );
    const functions = extractFunctions(sf);

    expect(functions[1]?.name).toBe("second");
    expect(functions[1]?.signature).toBe("second = () =>");
    expect(functions[1]?.body).not.toContain("first");
  });

  it("returns empty for files without functions", () => {
    const source = `const x = 42;
type Foo = string;`;
    const sf = ts.createSourceFile(
      "test.ts",
      source,
      ts.ScriptTarget.Latest,
      true,
    );
    const functions = extractFunctions(sf);
    expect(functions).toHaveLength(0);
  });
});

describe("analyzeFileChanges", () => {
  it("detects modified functions", () => {
    const parent = `function calc(x: number): number {
  return x * 2;
}`;
    const child = `function calc(x: number): number {
  return x * 3;
}`;

    const analysis = analyzeFileChanges(parent, child, "file.ts");
    expect(analysis.modifiedFunctions).toHaveLength(1);
    expect(analysis.modifiedFunctions[0]?.name).toBe("calc");
  });

  it("detects added exports", () => {
    const parent = "export function foo() {}";
    const child = `export function foo() {}
export function bar() {}`;

    const analysis = analyzeFileChanges(parent, child, "file.ts");
    expect(analysis.addedExports).toContain("bar");
  });

  it("detects removed exports", () => {
    const parent = `export function foo() {}
export function bar() {}`;
    const child = "export function foo() {}";

    const analysis = analyzeFileChanges(parent, child, "file.ts");
    expect(analysis.removedExports).toContain("bar");
  });

  it("tracks default export changes", () => {
    const parent = "export default function foo() {}";
    const child = "function foo() {}";

    const analysis = analyzeFileChanges(parent, child, "file.ts");
    expect(analysis.removedExports).toContain("default");
  });

  it("detects exports across declarations and named export clauses", () => {
    const source = `export class UserService {}
export const enabled = true, retries = 3;
export type UserId = string;
export interface UserRecord { id: UserId; }
const internalName = "value";
export { internalName as publicName };`;
    const sf = ts.createSourceFile(
      "exports.ts",
      source,
      ts.ScriptTarget.Latest,
      true,
    );

    expect([...extractExportNames(sf)]).toEqual(
      expect.arrayContaining([
        "UserService",
        "enabled",
        "retries",
        "UserId",
        "UserRecord",
        "publicName",
      ]),
    );
  });

  it("reports signature changes when a modified function changes parameters", () => {
    const parent = `export function loadUser(id: string) {
  return id;
}`;
    const child = `export function loadUser(id: string, includeInactive = false) {
  return includeInactive ? id : id.trim();
}`;

    const analysis = analyzeFileChanges(parent, child, "file.ts");

    expect(analysis.changedSignatures).toEqual([
      {
        name: "loadUser",
        oldSignature: "export function loadUser(id: string)",
        newSignature:
          "export function loadUser(id: string, includeInactive = false)",
      },
    ]);
  });

  it("detects control flow changes", () => {
    const parent = `function check(x: number) {
  return x > 0;
}`;
    const child = `function check(x: number) {
  if (x > 0) {
    return true;
  }
  return false;
}`;

    const analysis = analyzeFileChanges(parent, child, "file.ts");
    expect(analysis.controlFlowChanged).toBe(true);
  });

  it("detects error handling changes", () => {
    const parent = `function risky() {
  doSomething();
}`;
    const child = `function risky() {
  try {
    doSomething();
  } catch (e) {
    console.error(e);
  }
}`;

    const analysis = analyzeFileChanges(parent, child, "file.ts");
    expect(analysis.errorHandlingChanged).toBe(true);
  });

  it("tracks duplicate nested function names by occurrence order", () => {
    const parent = `function first() {
  function helper() {
    return "one";
  }

  return helper();
}

function second() {
  function helper() {
    return "two";
  }

  return helper();
}`;
    const child = `function first() {
  function helper() {
    return "one";
  }

  return helper();
}

function second() {
  function helper() {
    return "three";
  }

  return helper();
}`;

    const analysis = analyzeFileChanges(parent, child, "file.ts");
    const helperChanges = analysis.modifiedFunctions.filter(
      (fn) => fn.name === "helper",
    );

    expect(helperChanges).toHaveLength(1);
    expect(helperChanges[0]?.body).toContain(`return "three"`);
  });

  it("keeps duplicate function pairings stable when an earlier duplicate is inserted", () => {
    const parent = `function first() {
  function helper() {
    return "one";
  }

  return helper();
}

function second() {
  function helper() {
    return "two";
  }

  return helper();
}`;
    const child = `function inserted() {
  function helper() {
    return "zero";
  }

  return helper();
}

function first() {
  function helper() {
    return "one";
  }

  return helper();
}

function second() {
  function helper() {
    return "three";
  }

  return helper();
}`;

    const analysis = analyzeFileChanges(parent, child, "file.ts");
    const changedHelper = analysis.modifiedFunctions.find((fn) =>
      fn.body.includes(`return "three"`),
    );
    const parentMatch = analysis.parentFunctions.find(
      (fn) => fn.matchKey === changedHelper?.matchKey,
    );

    expect(changedHelper).toBeDefined();
    expect(parentMatch?.body).toContain(`return "two"`);
    expect(
      analysis.modifiedFunctions.some((fn) => fn.body.includes(`return "one"`)),
    ).toBe(false);
  });
});

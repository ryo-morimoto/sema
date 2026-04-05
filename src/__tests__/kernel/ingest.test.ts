import { describe, it, expect } from "vitest";
import { ingestSource } from "../../kernel/ingest.js";

describe("ingest", () => {
  it("extracts function declarations", () => {
    const result = ingestSource(`
      export function add(a: number, b: number): number {
        return a + b;
      }
      export function greet(name: string): string {
        return "Hello " + name;
      }
    `);

    expect(result.nodes).toHaveLength(2);
    expect(result.nodes[0].kind).toBe("FunctionDeclaration");
    expect(result.nodes[0].name).toBe("add");
    expect(result.nodes[0].paramNames).toEqual(["a", "b"]);
    expect(result.nodes[1].kind).toBe("FunctionDeclaration");
    expect(result.nodes[1].name).toBe("greet");
  });

  it("extracts arrow functions from const declarations", () => {
    const result = ingestSource(`
      export const multiply = (x: number, y: number): number => x * y;
    `);

    expect(result.nodes).toHaveLength(1);
    expect(result.nodes[0].kind).toBe("ArrowFunction");
    expect(result.nodes[0].name).toBe("multiply");
    expect(result.nodes[0].paramNames).toEqual(["x", "y"]);
  });

  it("extracts class declarations with methods", () => {
    const result = ingestSource(`
      export class Calculator {
        value: number = 0;
        add(n: number): void { this.value += n; }
        reset(): void { this.value = 0; }
      }
    `);

    expect(result.nodes).toHaveLength(1);
    expect(result.nodes[0].kind).toBe("ClassDeclaration");
    expect(result.nodes[0].name).toBe("Calculator");
    expect(result.nodes[0].children.length).toBeGreaterThanOrEqual(2);
  });

  it("extracts variable declarations", () => {
    const result = ingestSource(`
      export const MAX = 100;
      export let counter = 0;
    `);

    expect(result.nodes).toHaveLength(2);
    expect(result.nodes[0].kind).toBe("VariableDeclaration");
    expect(result.nodes[0].name).toBe("MAX");
    expect(result.nodes[0].declarationKind).toBe("const");
    expect(result.nodes[1].declarationKind).toBe("let");
  });

  it("extracts type aliases and interfaces", () => {
    const result = ingestSource(`
      export type UserId = string;
      export interface User {
        id: UserId;
        name: string;
      }
    `);

    expect(result.nodes).toHaveLength(2);
    expect(result.nodes[0].kind).toBe("TypeAliasDeclaration");
    expect(result.nodes[0].name).toBe("UserId");
    expect(result.nodes[1].kind).toBe("InterfaceDeclaration");
    expect(result.nodes[1].name).toBe("User");
  });

  it("extracts enum declarations", () => {
    const result = ingestSource(`
      export enum Color { Red, Green, Blue }
    `);

    expect(result.nodes).toHaveLength(1);
    expect(result.nodes[0].kind).toBe("EnumDeclaration");
    expect(result.nodes[0].name).toBe("Color");
    expect(result.nodes[0].children).toHaveLength(3);
  });

  it("tracks import declarations", () => {
    const result = ingestSource(`
      import fs from "fs";
      import { readFile } from "fs/promises";
    `);

    expect(result.imports).toHaveLength(2);
    expect(result.imports[0].moduleSpecifier).toBe("fs");
    expect(result.imports[0].defaultBinding).toBe("fs");
    expect(result.imports[1].moduleSpecifier).toBe("fs/promises");
    expect(result.imports[1].namedBindings).toEqual(["readFile"]);
  });

  it("produces diagnostics for unsupported syntax", () => {
    const result = ingestSource(`
      namespace Foo { }
    `);

    expect(result.diagnostics.length).toBeGreaterThan(0);
    expect(result.diagnostics[0].phase).toBe("ingest");
  });

  it("handles empty file", () => {
    const result = ingestSource("");
    expect(result.nodes).toHaveLength(0);
    expect(result.imports).toHaveLength(0);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("handles file with only imports", () => {
    const result = ingestSource(`import { something } from "module";`);
    expect(result.nodes).toHaveLength(0);
    expect(result.imports).toHaveLength(1);
  });

  it("tracks export info correctly", () => {
    const result = ingestSource(`
      export function pub() {}
      function priv() {}
      export default function def() {}
    `);

    expect(result.nodes).toHaveLength(3);
    const pub = result.nodes.find(n => n.name === "pub")!;
    expect(pub.isExported).toBe(true);

    const priv = result.nodes.find(n => n.name === "priv")!;
    expect(priv.isExported).toBe(false);

    const def = result.nodes.find(n => n.name === "def")!;
    expect(def.isDefault).toBe(true);
  });

  it("extracts generic type parameters", () => {
    const result = ingestSource(`
      export function identity<T>(x: T): T { return x; }
    `);

    expect(result.nodes[0].typeParamNames).toEqual(["T"]);
  });
});

import { describe, it, expect } from "vitest";
import { ingestSource } from "../../kernel/ingest.js";
import { normalize } from "../../kernel/normalize.js";

describe("normalize", () => {
  it("normalizes raw ingest result into SemanticNodes", () => {
    const raw = ingestSource(`
      export function add(a: number, b: number): number { return a + b; }
    `);
    const result = normalize(raw);

    expect(result.nodes.length).toBeGreaterThan(0);
    expect(result.fileName).toBe("input.ts");
  });

  it("sorts declarations by kind + name", () => {
    const raw = ingestSource(`
      export function zebra() {}
      export function alpha() {}
      export const beta = 1;
    `);
    const result = normalize(raw);

    // Nodes should be sorted: ArrowFunction (none) < FunctionDeclaration, then alpha < zebra
    // But beta is VariableDeclaration not ArrowFunction since it's not an arrow
    const names = result.nodes
      .filter(n => n.kind !== "ImportDeclaration")
      .map(n => n.name);
    // Sorted by kind first: FunctionDeclaration < VariableDeclaration
    expect(names).toEqual(["alpha", "zebra", "beta"]);
  });

  it("includes import nodes as non-definition", () => {
    const raw = ingestSource(`
      import { readFile } from "fs";
      export function foo() {}
    `);
    const result = normalize(raw);

    const importNode = result.nodes.find(n => n.kind === "ImportDeclaration");
    expect(importNode).toBeDefined();
    expect(importNode!.name).toBe("fs");
  });

  it("preserves diagnostics from ingest", () => {
    const raw = ingestSource(`
      namespace Bad {}
      export function good() {}
    `);
    const result = normalize(raw);

    expect(result.diagnostics.length).toBeGreaterThan(0);
  });

  it("handles empty input", () => {
    const raw = ingestSource("");
    const result = normalize(raw);
    expect(result.nodes).toHaveLength(0);
  });
});

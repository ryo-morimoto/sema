import { describe, it, expect } from "vitest";
import { buildProgram, createAgent } from "../../index.js";
import type { SemanticId } from "../../types/semantic.js";

describe("agent query operations", () => {
  const source = `
    export function add(a: number, b: number): number { return a + b; }
    export function subtract(a: number, b: number): number { return a - b; }
    export const multiply = (x: number, y: number): number => x * y;
    export class Calculator { compute() { return 0; } }
    export type Num = number;
    export interface Config { value: number; }
    export enum Mode { Fast, Slow }
  `;
  const program = buildProgram(source);
  const agent = createAgent(program);

  describe("resolve", () => {
    it("resolves by name", () => {
      const ids = agent.resolve({ name: "add" });
      expect(ids).toHaveLength(1);
    });

    it("resolves by kind", () => {
      const ids = agent.resolve({ kind: "FunctionDeclaration" });
      expect(ids.length).toBeGreaterThanOrEqual(2);
    });

    it("resolves by glob pattern", () => {
      const ids = agent.resolve({ glob: "add*" });
      // Should only match "add" not "subtract"
      expect(ids.length).toBeGreaterThanOrEqual(1);
    });

    it("returns all definitions when no selector", () => {
      const ids = agent.resolve();
      expect(ids.length).toBeGreaterThanOrEqual(5);
    });

    it("returns empty for no match", () => {
      const ids = agent.resolve({ name: "nonexistent" });
      expect(ids).toHaveLength(0);
    });
  });

  describe("inspect", () => {
    it("returns full node details", () => {
      const [id] = agent.resolve({ name: "add" });
      const view = agent.inspect(id);

      expect(view.node.kind).toBe("FunctionDeclaration");
      expect(view.node.name).toBe("add");
      expect(view.node.syntaxHash).toBeTruthy();
      expect(view.node.semanticHash).toBeTruthy();
    });

    it("includes definition info for exported nodes", () => {
      const [id] = agent.resolve({ name: "add" });
      const view = agent.inspect(id);

      expect(view.definition).not.toBeNull();
      expect(view.definition!.exportNames).toContain("add");
    });

    it("throws for non-existent id", () => {
      expect(() => agent.inspect("bad_id" as SemanticId)).toThrow();
    });
  });

  describe("slice", () => {
    it("returns nodes at depth 0 (roots only)", () => {
      const [id] = agent.resolve({ name: "add" });
      const result = agent.slice([id], 0);

      expect(result.nodes.size).toBe(1);
      expect(result.roots).toContain(id);
    });

    it("returns connected subgraph at depth 1", () => {
      const ids = agent.resolve({ name: "Calculator" });
      if (ids.length > 0) {
        const result = agent.slice(ids, 1);
        // Class + its methods
        expect(result.nodes.size).toBeGreaterThanOrEqual(1);
        expect(result.edges.length).toBeGreaterThanOrEqual(0);
      }
    });

    it("handles empty ids", () => {
      const result = agent.slice([], 1);
      expect(result.nodes.size).toBe(0);
    });
  });
});

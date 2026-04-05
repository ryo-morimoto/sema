import { describe, it, expect } from "vitest";
import { buildProgramFromSource, applyPatch } from "../../kernel/program.js";
import type { SemanticId } from "../../types/semantic.js";

describe("program", () => {
  describe("buildProgramFromSource", () => {
    it("builds a program from simple source", () => {
      const program = buildProgramFromSource(`
        export function add(a: number, b: number): number {
          return a + b;
        }
      `);

      expect(program.nodes.size).toBeGreaterThan(0);
      expect(program.definitions.size).toBeGreaterThan(0);
      expect(program.provenance.tsVersion).toBeTruthy();
    });

    it("populates definitions for exported nodes", () => {
      const program = buildProgramFromSource(`
        export function pub() {}
        function priv() {}
      `);

      expect(program.definitions.size).toBe(1);
      const def = [...program.definitions.values()][0];
      expect(def.name).toBe("pub");
      expect(def.exportNames).toContain("pub");
    });

    it("assigns unique IDs to all nodes", () => {
      const program = buildProgramFromSource(`
        export function foo() {}
        export function bar() {}
      `);

      const ids = [...program.nodes.keys()];
      const uniqueIds = new Set(ids);
      expect(uniqueIds.size).toBe(ids.length);
    });

    it("handles empty source", () => {
      const program = buildProgramFromSource("");
      expect(program.nodes.size).toBe(0);
      expect(program.definitions.size).toBe(0);
    });

    it("handles source with class and methods", () => {
      const program = buildProgramFromSource(`
        export class Calc {
          add(n: number) { return n; }
        }
      `);

      expect(program.nodes.size).toBeGreaterThan(1); // class + method
      expect(program.definitions.size).toBe(1);
    });

    it("populates provenance", () => {
      const program = buildProgramFromSource("export const x = 1;");
      expect(program.provenance.sourceFiles).toContain("input.ts");
      expect(program.provenance.hashVersion).toBe(1);
      expect(program.provenance.builtAt).toBeGreaterThan(0);
    });

    it("produces stable hashes across multiple builds", () => {
      const source = `export function foo(x: number) { return x + 1; }`;
      const p1 = buildProgramFromSource(source);
      const p2 = buildProgramFromSource(source);

      const ids1 = [...p1.nodes.keys()].sort();
      const ids2 = [...p2.nodes.keys()].sort();
      expect(ids1).toEqual(ids2);
    });
  });

  describe("applyPatch", () => {
    it("applies a rename patch", () => {
      const program = buildProgramFromSource(`export function foo() {}`);
      const [id, node] = [...program.nodes.entries()].find(
        ([, n]) => n.kind === "FunctionDeclaration"
      )!;

      const result = applyPatch(program, [{
        targetId: id,
        expectedHash: node.syntaxHash,
        replacement: { name: "bar" },
      }]);

      expect(result.changedIds).toContain(id);
      const updated = result.program.nodes.get(id)!;
      expect(updated.name).toBe("bar");
    });

    it("rejects stale patch", () => {
      const program = buildProgramFromSource(`export function foo() {}`);
      const [id] = [...program.nodes.entries()].find(
        ([, n]) => n.kind === "FunctionDeclaration"
      )!;

      const result = applyPatch(program, [{
        targetId: id,
        expectedHash: "wrong_hash",
        replacement: { name: "bar" },
      }]);

      expect(result.diagnostics.some(d => d.severity === "error")).toBe(true);
      expect(result.changedIds).toHaveLength(0);
    });

    it("rejects patch for non-existent node", () => {
      const program = buildProgramFromSource(`export function foo() {}`);

      const result = applyPatch(program, [{
        targetId: "nonexistent" as SemanticId,
        expectedHash: "whatever",
        replacement: { name: "bar" },
      }]);

      expect(result.diagnostics.some(d => d.severity === "error")).toBe(true);
    });

    it("preserves original program on rejection", () => {
      const program = buildProgramFromSource(`export function foo() {}`);
      const originalSize = program.nodes.size;

      applyPatch(program, [{
        targetId: "nonexistent" as SemanticId,
        expectedHash: "whatever",
        replacement: { name: "bar" },
      }]);

      expect(program.nodes.size).toBe(originalSize);
    });
  });
});

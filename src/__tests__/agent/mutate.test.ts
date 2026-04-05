import { describe, it, expect } from "vitest";
import { buildProgram, createAgent } from "../../index.js";
import type { SemanticId, SemanticNode } from "../../types/semantic.js";
import type { SemanticPatch } from "../../types/agent.js";

describe("agent mutate operations", () => {
  describe("validate", () => {
    it("returns ok for clean code", () => {
      const program = buildProgram(`export function add(a: number, b: number) { return a + b; }`);
      const agent = createAgent(program);
      const report = agent.validate();

      expect(report.ok).toBe(true);
      expect(report.checkedCount).toBeGreaterThan(0);
    });

    it("validates specific selector", () => {
      const program = buildProgram(`
        export function foo() {}
        export function bar() {}
      `);
      const agent = createAgent(program);
      const report = agent.validate({ name: "foo" });

      expect(report.checkedCount).toBe(1);
    });
  });

  describe("transform", () => {
    it("generates patches from transform function", () => {
      const program = buildProgram(`
        export function oldName() {}
      `);
      const agent = createAgent(program);

      const patches = agent.transform(
        { name: "oldName" },
        (node: SemanticNode): SemanticPatch | null => ({
          targetId: node.id,
          expectedHash: node.syntaxHash,
          replacement: { name: "newName" },
        }),
      );

      expect(patches).toHaveLength(1);
      expect(patches[0].replacement.name).toBe("newName");
    });

    it("skips when transform returns null", () => {
      const program = buildProgram(`export function keep() {}`);
      const agent = createAgent(program);

      const patches = agent.transform({ name: "keep" }, () => null);
      expect(patches).toHaveLength(0);
    });
  });

  describe("commit", () => {
    it("applies patch and returns new program", () => {
      const program = buildProgram(`export function oldName() {}`);
      const agent = createAgent(program);

      const [id] = agent.resolve({ name: "oldName" });
      const view = agent.inspect(id);

      const result = agent.commit({
        targetId: id,
        expectedHash: view.node.syntaxHash,
        replacement: { name: "newName" },
      });

      expect(result.changedIds).toContain(id);
      // New program has the updated name
      const newAgent = createAgent(result.program);
      const newView = newAgent.inspect(id);
      expect(newView.node.name).toBe("newName");
    });

    it("rejects stale commit", () => {
      const program = buildProgram(`export function foo() {}`);
      const agent = createAgent(program);
      const [id] = agent.resolve({ name: "foo" });

      expect(() => {
        const result = agent.commit({
          targetId: id,
          expectedHash: "wrong_hash",
          replacement: { name: "bar" },
        });
        // Should have error diagnostics
        if (result.diagnostics.some(d => d.severity === "error")) {
          throw new Error("Stale patch");
        }
      }).toThrow();
    });

    it("preserves immutability of original program", () => {
      const program = buildProgram(`export function foo() {}`);
      const agent = createAgent(program);
      const [id] = agent.resolve({ name: "foo" });
      const view = agent.inspect(id);

      agent.commit({
        targetId: id,
        expectedHash: view.node.syntaxHash,
        replacement: { name: "bar" },
      });

      // Original agent still sees "foo"
      const originalView = agent.inspect(id);
      expect(originalView.node.name).toBe("foo");
    });
  });
});

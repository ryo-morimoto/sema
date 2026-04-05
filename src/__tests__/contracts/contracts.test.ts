import { describe, it, expect } from "vitest";
import { buildProgramFromSource } from "../../kernel/program.js";
import { inferEffects } from "../../contracts/effect.js";
import { inferCapabilities } from "../../contracts/capability.js";
import { declareWorld } from "../../contracts/world.js";
import { attachContracts } from "../../contracts/index.js";
import type { SemanticId } from "../../types/semantic.js";

describe("contracts", () => {
  describe("inferEffects", () => {
    it("detects async functions (Promise return type)", () => {
      const program = buildProgramFromSource(`
        export async function fetchData(): Promise<string> { return "data"; }
      `);

      const effects = inferEffects(program);
      expect(effects.length).toBeGreaterThan(0);
      expect(effects[0].async).toBe(true);
    });

    it("skips pure functions", () => {
      const program = buildProgramFromSource(`
        export function add(a: number, b: number): number { return a + b; }
      `);

      const effects = inferEffects(program);
      expect(effects).toHaveLength(0);
    });
  });

  describe("inferCapabilities", () => {
    it("detects fs imports", () => {
      const program = buildProgramFromSource(`
        import fs from "fs";
        export function read() { return fs.readFileSync("x", "utf-8"); }
      `);

      const caps = inferCapabilities(program);
      expect(caps.length).toBeGreaterThan(0);
      expect(caps[0].grants).toContain("fs:read");
    });

    it("returns empty for no system imports", () => {
      const program = buildProgramFromSource(`
        export function pure() { return 42; }
      `);

      const caps = inferCapabilities(program);
      expect(caps).toHaveLength(0);
    });
  });

  describe("declareWorld", () => {
    it("attaches world contract to program", () => {
      const program = buildProgramFromSource(`
        export function handler() {}
      `);

      const [id] = [...program.nodes.keys()].filter(
        k => program.nodes.get(k)!.kind === "FunctionDeclaration"
      );

      const updated = declareWorld(program, [id], {
        requiredServices: ["postgres"],
        allowedOutbound: ["api.example.com"],
        trustAssumptions: ["auth validated"],
        obligations: ["log audit"],
      });

      expect(updated.contracts.size).toBe(1);
      const contract = [...updated.contracts.values()][0];
      expect(contract.kind).toBe("world");
      if (contract.kind === "world") {
        expect(contract.spec.requiredServices).toContain("postgres");
      }

      // Node openness updated
      const node = updated.nodes.get(id)!;
      expect(node.openness.length).toBe(1);
    });

    it("preserves original program immutably", () => {
      const original = buildProgramFromSource(`export function f() {}`);
      const id = [...original.nodes.keys()].find(
        k => original.nodes.get(k)!.kind === "FunctionDeclaration"
      )!;

      const updated = declareWorld(original, [id], {
        requiredServices: [],
        allowedOutbound: [],
        trustAssumptions: [],
        obligations: [],
      });

      expect(original.contracts.size).toBe(0);
      expect(updated.contracts.size).toBe(1);
    });
  });

  describe("attachContracts", () => {
    it("attaches both effect and capability contracts", () => {
      const program = buildProgramFromSource(`
        import fs from "fs";
        export async function readAndFetch(): Promise<string> { return ""; }
      `);

      const withContracts = attachContracts(program);
      expect(withContracts.contracts.size).toBeGreaterThan(0);
      expect(withContracts.overlays.byKind.size).toBeGreaterThan(0);
    });

    it("respects inferEffects=false option", () => {
      const program = buildProgramFromSource(`
        export async function fetch(): Promise<string> { return ""; }
      `);

      const withContracts = attachContracts(program, { inferEffects: false });
      const effectContracts = [...withContracts.contracts.values()].filter(c => c.kind === "effect");
      expect(effectContracts).toHaveLength(0);
    });

    it("returns program unchanged when no contracts found", () => {
      const program = buildProgramFromSource(`export const x = 1;`);
      const result = attachContracts(program);
      expect(result.contracts.size).toBe(0);
    });
  });
});

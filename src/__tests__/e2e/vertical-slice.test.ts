import { describe, it, expect } from "vitest";
import { buildProgram, createAgent, declareWorldContract } from "../../index.js";
import type { SemanticPatch } from "../../types/agent.js";
import type { SemanticNode } from "../../types/semantic.js";

describe("E2E vertical slice", () => {
  it("full pipeline: ingest → build → resolve → inspect → validate → transform → commit → materialize", () => {
    // 1. Build program
    const source = `
      export function processData(input: string): string {
        return input.toUpperCase();
      }

      export function formatOutput(data: string): string {
        return "Result: " + data;
      }
    `;
    const program = buildProgram(source);
    const agent = createAgent(program);

    // 2. Resolve
    const allFunctions = agent.resolve({ kind: "FunctionDeclaration" });
    expect(allFunctions.length).toBeGreaterThanOrEqual(2);

    const [processId] = agent.resolve({ name: "processData" });
    expect(processId).toBeDefined();

    // 3. Inspect
    const view = agent.inspect(processId);
    expect(view.node.kind).toBe("FunctionDeclaration");
    expect(view.node.name).toBe("processData");
    expect(view.node.syntaxHash).toHaveLength(16);
    expect(view.node.semanticHash).toHaveLength(16);

    // 4. Validate
    const report = agent.validate();
    expect(report.ok).toBe(true);
    expect(report.checkedCount).toBeGreaterThan(0);

    // 5. Transform (rename)
    const patches = agent.transform(
      { name: "processData" },
      (node: SemanticNode): SemanticPatch => ({
        targetId: node.id,
        expectedHash: node.syntaxHash,
        replacement: { name: "transformData" },
      }),
    );
    expect(patches).toHaveLength(1);

    // 6. Commit
    const commitResult = agent.commit(...patches);
    expect(commitResult.changedIds).toHaveLength(1);

    // 7. Materialize
    const newAgent = createAgent(commitResult.program);
    const code = newAgent.materialize(processId);
    expect(code).toContain("transformData");
  });

  it("hash stability: same source → same hashes", () => {
    const source = `
      export function compute(x: number): number { return x * 2; }
    `;

    const p1 = buildProgram(source);
    const p2 = buildProgram(source);

    const a1 = createAgent(p1);
    const a2 = createAgent(p2);

    const [id1] = a1.resolve({ name: "compute" });
    const [id2] = a2.resolve({ name: "compute" });

    expect(id1).toBe(id2);

    const view1 = a1.inspect(id1);
    const view2 = a2.inspect(id2);
    expect(view1.node.syntaxHash).toBe(view2.node.syntaxHash);
    expect(view1.node.semanticHash).toBe(view2.node.semanticHash);
  });

  it("world contract declaration", () => {
    const source = `
      export function fetchUser(id: string) { return { name: "test" }; }
    `;
    const program = buildProgram(source);
    const agent = createAgent(program);
    const [id] = agent.resolve({ name: "fetchUser" });

    const withWorld = declareWorldContract(program, [id], {
      requiredServices: ["postgres"],
      allowedOutbound: ["api.internal"],
      trustAssumptions: ["auth is valid"],
      obligations: ["log access"],
    });

    expect(withWorld.contracts.size).toBe(1);
    const worldAgent = createAgent(withWorld);
    const view = worldAgent.inspect(id);
    expect(view.contracts.length).toBe(1);
    expect(view.contracts[0].kind).toBe("world");
  });

  it("various declaration types", () => {
    const source = `
      export type UserId = string;
      export interface User { id: UserId; name: string; }
      export enum Role { Admin, User }
      export const MAX = 100;
      export const greet = (name: string) => "Hello " + name;
      export function process(user: User): string { return user.name; }
      export class Service { run() {} }
    `;

    const program = buildProgram(source);
    const agent = createAgent(program);

    expect(agent.resolve({ kind: "TypeAliasDeclaration" }).length).toBeGreaterThanOrEqual(1);
    expect(agent.resolve({ kind: "InterfaceDeclaration" }).length).toBeGreaterThanOrEqual(1);
    expect(agent.resolve({ kind: "EnumDeclaration" }).length).toBeGreaterThanOrEqual(1);
    expect(agent.resolve({ kind: "VariableDeclaration" }).length).toBeGreaterThanOrEqual(1);
    expect(agent.resolve({ kind: "ArrowFunction" }).length).toBeGreaterThanOrEqual(1);
    expect(agent.resolve({ kind: "FunctionDeclaration" }).length).toBeGreaterThanOrEqual(1);
    expect(agent.resolve({ kind: "ClassDeclaration" }).length).toBeGreaterThanOrEqual(1);

    // All can be materialized
    const allIds = agent.resolve();
    for (const id of allIds) {
      const code = agent.materialize(id);
      expect(code.length).toBeGreaterThan(0);
    }
  });

  it("slice extracts connected subgraph", () => {
    const source = `
      export class Processor {
        transform(input: string): string { return input; }
        validate(input: string): boolean { return input.length > 0; }
      }
    `;
    const program = buildProgram(source);
    const agent = createAgent(program);

    const [classId] = agent.resolve({ name: "Processor" });
    const sliceResult = agent.slice([classId], 1);

    expect(sliceResult.nodes.size).toBeGreaterThan(1); // class + methods
    expect(sliceResult.roots).toContain(classId);
  });
});

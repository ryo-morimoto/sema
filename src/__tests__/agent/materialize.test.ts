import { describe, it, expect } from "vitest";
import { buildProgram, createAgent } from "../../index.js";
import type { SemanticId } from "../../types/semantic.js";

describe("materialize", () => {
  it("materializes a function to valid TS", () => {
    const program = buildProgram(`export function hello() {}`);
    const agent = createAgent(program);
    const [id] = agent.resolve({ name: "hello" });
    const code = agent.materialize(id);

    expect(code).toContain("function");
    expect(code).toContain("hello");
  });

  it("materializes an arrow function", () => {
    const program = buildProgram(`export const fn = () => {}`);
    const agent = createAgent(program);
    const [id] = agent.resolve({ name: "fn" });
    const code = agent.materialize(id);

    expect(code).toContain("fn");
  });

  it("materializes a class", () => {
    const program = buildProgram(`export class Foo { bar() {} }`);
    const agent = createAgent(program);
    const [id] = agent.resolve({ name: "Foo" });
    const code = agent.materialize(id);

    expect(code).toContain("class");
    expect(code).toContain("Foo");
  });

  it("materializes an interface", () => {
    const program = buildProgram(`export interface Config { value: number; }`);
    const agent = createAgent(program);
    const [id] = agent.resolve({ name: "Config" });
    const code = agent.materialize(id);

    expect(code).toContain("interface");
    expect(code).toContain("Config");
  });

  it("materializes an enum", () => {
    const program = buildProgram(`export enum Color { Red, Green, Blue }`);
    const agent = createAgent(program);
    const [id] = agent.resolve({ name: "Color" });
    const code = agent.materialize(id);

    expect(code).toContain("enum");
    expect(code).toContain("Color");
  });

  it("materializes a type alias", () => {
    const program = buildProgram(`export type ID = string;`);
    const agent = createAgent(program);
    const [id] = agent.resolve({ name: "ID" });
    const code = agent.materialize(id);

    expect(code).toContain("type");
    expect(code).toContain("ID");
  });

  it("materializes multiple nodes", () => {
    const program = buildProgram(`
      export function foo() {}
      export function bar() {}
    `);
    const agent = createAgent(program);
    const ids = agent.resolve({ kind: "FunctionDeclaration" });
    const code = agent.materialize(...ids);

    expect(code).toContain("foo");
    expect(code).toContain("bar");
  });

  it("throws for non-existent id", () => {
    const program = buildProgram(`export const x = 1;`);
    const agent = createAgent(program);

    expect(() => agent.materialize("bad_id" as SemanticId)).toThrow();
  });

  it("materializes modified node after commit", () => {
    const program = buildProgram(`export function oldName() {}`);
    const agent = createAgent(program);
    const [id] = agent.resolve({ name: "oldName" });
    const view = agent.inspect(id);

    const result = agent.commit({
      targetId: id,
      expectedHash: view.node.syntaxHash,
      replacement: { name: "newName" },
    });

    const newAgent = createAgent(result.program);
    const code = newAgent.materialize(id);
    expect(code).toContain("newName");
  });
});

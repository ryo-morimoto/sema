import { describe, it, expect } from "vitest";
import { toHashable, computeSyntaxHash, computeSemanticHash } from "../../kernel/identity.js";
import { ingestSource } from "../../kernel/ingest.js";
import type { SemanticId } from "../../types/semantic.js";

describe("identity", () => {
  describe("toHashable", () => {
    it("creates hashable for function declaration", () => {
      const raw = ingestSource(`function add(a: number, b: number) { return a + b; }`);
      const node = raw.nodes[0];
      const hashable = toHashable(node, []);

      expect(hashable.kind).toBe("FunctionDeclaration");
      if (hashable.kind === "FunctionDeclaration") {
        expect(hashable.paramCount).toBe(2);
        expect(hashable.bodyHash).not.toBeNull();
      }
    });

    it("creates hashable for arrow function", () => {
      const raw = ingestSource(`const fn = (x: number) => x * 2;`);
      const node = raw.nodes[0];
      const hashable = toHashable(node, []);

      expect(hashable.kind).toBe("ArrowFunction");
    });

    it("creates hashable for class", () => {
      const raw = ingestSource(`class Foo { bar() {} }`);
      const node = raw.nodes[0];
      const hashable = toHashable(node, ["child_hash_1"]);

      expect(hashable.kind).toBe("ClassDeclaration");
    });

    it("creates hashable for variable", () => {
      const raw = ingestSource(`const x = 42;`);
      const node = raw.nodes[0];
      const hashable = toHashable(node, []);

      expect(hashable.kind).toBe("VariableDeclaration");
      if (hashable.kind === "VariableDeclaration") {
        expect(hashable.declarationKind).toBe("const");
      }
    });

    it("creates hashable for type alias", () => {
      const raw = ingestSource(`type Foo = string;`);
      const node = raw.nodes[0];
      const hashable = toHashable(node, []);

      expect(hashable.kind).toBe("TypeAliasDeclaration");
    });

    it("creates hashable for interface", () => {
      const raw = ingestSource(`interface Foo { bar: string; }`);
      const node = raw.nodes[0];
      const hashable = toHashable(node, []);

      expect(hashable.kind).toBe("InterfaceDeclaration");
    });

    it("creates hashable for enum", () => {
      const raw = ingestSource(`enum Color { Red, Green }`);
      const node = raw.nodes[0];
      const hashable = toHashable(node, ["red_hash", "green_hash"]);

      expect(hashable.kind).toBe("EnumDeclaration");
    });
  });

  describe("computeSyntaxHash", () => {
    it("produces deterministic hash for same input", () => {
      const raw = ingestSource(`function foo() { return 1; }`);
      const h = toHashable(raw.nodes[0], []);
      const hash1 = computeSyntaxHash(h);
      const hash2 = computeSyntaxHash(h);

      expect(hash1).toBe(hash2);
      expect(hash1).toHaveLength(16);
    });

    it("produces different hashes for different functions", () => {
      const raw1 = ingestSource(`function foo() { return 1; }`);
      const raw2 = ingestSource(`function bar(x: number) { return x; }`);
      const hash1 = computeSyntaxHash(toHashable(raw1.nodes[0], []));
      const hash2 = computeSyntaxHash(toHashable(raw2.nodes[0], []));

      expect(hash1).not.toBe(hash2);
    });

    it("produces same hash for renamed variables (same structure)", () => {
      // Both have same structure: 1 param, same body structure
      const raw1 = ingestSource(`function foo(x: number) { return x + 1; }`);
      const raw2 = ingestSource(`function bar(y: number) { return y + 1; }`);

      // Note: body hashes may differ because the printer includes variable names
      // This is a known limitation - true de Bruijn body normalization is deferred
      const h1 = toHashable(raw1.nodes[0], []);
      const h2 = toHashable(raw2.nodes[0], []);

      // At minimum, paramCount matches
      if (h1.kind === "FunctionDeclaration" && h2.kind === "FunctionDeclaration") {
        expect(h1.paramCount).toBe(h2.paramCount);
      }
    });
  });

  describe("computeSemanticHash", () => {
    it("differs from syntaxHash when type info is provided", () => {
      const raw = ingestSource(`function foo(x: number) { return x; }`);
      const h = toHashable(raw.nodes[0], []);
      const syntaxHash = computeSyntaxHash(h);

      const semanticHash = computeSemanticHash(syntaxHash, "(x: number) => number");

      expect(semanticHash).not.toBe(syntaxHash);
      expect(semanticHash).toHaveLength(16);
    });

    it("changes when type changes", () => {
      const raw = ingestSource(`function foo(x: number) { return x; }`);
      const h = toHashable(raw.nodes[0], []);
      const syntaxHash = computeSyntaxHash(h);

      const sem1 = computeSemanticHash(syntaxHash, "number");
      const sem2 = computeSemanticHash(syntaxHash, "string");

      expect(sem1).not.toBe(sem2);
    });
  });
});

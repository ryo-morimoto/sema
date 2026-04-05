import { readFileSync } from "node:fs";
import { buildProgram, createAgent } from "../src/index.js";

const source = readFileSync("bench/target.ts", "utf-8");
const program = buildProgram(source);
const agent = createAgent(program);

console.log("=== NODES ===");
for (const id of agent.resolve()) {
  const v = agent.inspect(id);
  console.log(JSON.stringify({
    name: v.node.name,
    kind: v.node.kind,
    typeRef: v.node.typeRef,
    symbolRef: v.node.symbolRef,
    syntaxHash: v.node.syntaxHash,
    semanticHash: v.node.semanticHash,
    sameHash: v.node.syntaxHash === v.node.semanticHash,
    contracts: v.contracts.map(c => ({
      kind: c.kind,
      ...(c.kind === "effect" ? { async: c.async } : {}),
      ...(c.kind === "capability" ? { grants: c.grants } : {}),
    })),
  }));
}

console.log("\n=== TYPES ===");
for (const [id, t] of program.types) {
  console.log(JSON.stringify({ id, text: t.text }));
}

console.log("\n=== SYMBOLS ===");
for (const [id, s] of program.symbols) {
  console.log(JSON.stringify({ id, name: s.name, typeId: s.typeId }));
}

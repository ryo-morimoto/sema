/**
 * sema CLI — agent-native 形式でファイルを分析する。
 * Usage: npx tsx bench/sema-cli.ts <file>
 */

import { readFileSync } from "node:fs";
import { buildProgram, createAgent } from "../src/index.js";

const file = process.argv[2];
if (!file) {
  console.error("Usage: npx tsx bench/sema-cli.ts <file>");
  process.exit(1);
}

const source = readFileSync(file, "utf-8");
const program = buildProgram(source);
const agent = createAgent(program);
const allIds = agent.resolve();

// --- Functions ---
const functions: Array<Record<string, unknown>> = [];
const types: Array<Record<string, unknown>> = [];
const importModules: string[] = [];

for (const [, node] of program.nodes) {
  if (node.kind === "ImportDeclaration" && node.name) {
    importModules.push(node.name);
  }
}

for (const id of allIds) {
  const view = agent.inspect(id);
  const node = view.node;

  if (
    node.kind === "TypeAliasDeclaration" ||
    node.kind === "InterfaceDeclaration" ||
    node.kind === "EnumDeclaration"
  ) {
    types.push({ name: node.name, kind: node.kind });
    continue;
  }

  if (node.kind === "VariableDeclaration") {
    types.push({ name: node.name, kind: "const" });
    continue;
  }

  const effects: string[] = [];
  const capabilities: string[] = [];

  for (const contract of view.contracts) {
    if (contract.kind === "effect") {
      if (contract.async) effects.push("async");
      effects.push(...contract.errorTypes);
    }
    if (contract.kind === "capability") {
      capabilities.push(...contract.grants);
    }
  }

  const typeRecord = node.typeRef ? program.types.get(node.typeRef) : null;
  const signature = typeRecord?.text ?? "unknown";

  const dependsOn: string[] = [];
  if (node.kind === "ClassDeclaration") {
    // Collect top-level definition names (excluding this class itself)
    const topLevelNames = allIds
      .map((tid) => agent.inspect(tid).node)
      .filter((n) => n.id !== id && n.name !== null)
      .map((n) => n.name!);

    // Search original source text within the class span for references to top-level names
    if (node.span) {
      const classText = source.slice(node.span.start, node.span.end);
      for (const name of topLevelNames) {
        // Match as word boundary to avoid substring false positives
        const re = new RegExp(`\\b${name}\\b`);
        if (re.test(classText)) dependsOn.push(name);
      }
    }
    // Also add types from method signatures
    for (const child of node.children) {
      const childType = child.typeRef ? program.types.get(child.typeRef) : null;
      if (childType) {
        for (const name of topLevelNames) {
          if (childType.text.includes(name) && !dependsOn.includes(name)) {
            dependsOn.push(name);
          }
        }
      }
    }
    const unique = [...new Set(dependsOn)].sort();
    dependsOn.length = 0;
    dependsOn.push(...unique);
  }

  // Class is effectful if any of its dependencies are effectful
  let hasEffects = effects.length > 0 || capabilities.length > 0;
  if (node.kind === "ClassDeclaration" && !hasEffects) {
    for (const depName of dependsOn) {
      const depIds = agent.resolve({ name: depName });
      for (const depId of depIds) {
        const depView = agent.inspect(depId);
        if (depView.contracts.length > 0) { hasEffects = true; break; }
      }
      if (hasEffects) break;
    }
  }
  const purity = hasEffects ? "effectful" : "pure";

  functions.push({
    name: node.name,
    kind: node.kind,
    signature,
    purity,
    effects: [...new Set(effects)],
    capabilities: [...new Set(capabilities)],
    ...(dependsOn.length > 0 ? { dependsOn } : {}),
    syntaxHash: node.syntaxHash,
  });
}

const allCapabilities = [
  ...new Set(functions.flatMap((f) => (f.capabilities as string[]) ?? [])),
].sort();

console.log(
  JSON.stringify({ functions, types, imports: importModules, capabilities: allCapabilities }, null, 2),
);

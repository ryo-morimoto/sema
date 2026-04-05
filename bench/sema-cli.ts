/**
 * sema CLI — agent-native 形式でファイルを分析する。
 * パターン認識: 同じ shape の関数群を検出し、圧縮して出力する。
 *
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

// =========================================================================
// Phase 1: Collect raw function/type data
// =========================================================================

interface FuncInfo {
  name: string;
  kind: string;
  signature: string;
  purity: "pure" | "effectful";
  effects: string[];
  capabilities: string[];
  dependsOn: string[];
  syntaxHash: string;
}

const functions: FuncInfo[] = [];
const types: Array<{ name: string; kind: string }> = [];
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
    types.push({ name: node.name ?? "anonymous", kind: node.kind });
    continue;
  }

  if (node.kind === "VariableDeclaration") {
    types.push({ name: node.name ?? "anonymous", kind: "const" });
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
    const topLevelNames = allIds
      .map((tid) => agent.inspect(tid).node)
      .filter((n) => n.id !== id && n.name !== null)
      .map((n) => n.name!);

    if (node.span) {
      const classText = source.slice(node.span.start, node.span.end);
      for (const name of topLevelNames) {
        if (new RegExp(`\\b${name}\\b`).test(classText)) dependsOn.push(name);
      }
    }
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

  let hasEffects = effects.length > 0 || capabilities.length > 0;
  if (node.kind === "ClassDeclaration" && !hasEffects) {
    for (const depName of dependsOn) {
      const depIds = agent.resolve({ name: depName });
      for (const depId of depIds) {
        if (agent.inspect(depId).contracts.length > 0) { hasEffects = true; break; }
      }
      if (hasEffects) break;
    }
  }

  functions.push({
    name: node.name ?? "anonymous",
    kind: node.kind,
    signature,
    purity: hasEffects ? "effectful" : "pure",
    effects: [...new Set(effects)],
    capabilities: [...new Set(capabilities)],
    dependsOn,
    syntaxHash: node.syntaxHash,
  });
}

// =========================================================================
// Phase 2: Pattern recognition & compression
// =========================================================================

/** Shape key = kind|purity|caps|effects (everything except name/signature/hash) */
function shapeKey(f: FuncInfo): string {
  return [f.kind, f.purity, f.capabilities.sort().join(","), f.effects.sort().join(",")].join("|");
}

/**
 * Given a list of names, try to extract a common naming pattern.
 * e.g. ["filterOrders", "filterUsers", "filterInventorys"] → "filter{X}s"
 * Returns null if no common pattern found.
 */
function extractNamingPattern(names: string[]): { template: string; variables: string[] } | null {
  if (names.length < 2) return null;

  // Try: common prefix + variable part + common suffix
  const sorted = [...names].sort();
  let prefixLen = 0;
  const first = sorted[0];
  const last = sorted[sorted.length - 1];

  while (prefixLen < first.length && prefixLen < last.length && first[prefixLen] === last[prefixLen]) {
    prefixLen++;
  }

  // Also try common suffix
  let suffixLen = 0;
  while (
    suffixLen < first.length - prefixLen &&
    suffixLen < last.length - prefixLen &&
    first[first.length - 1 - suffixLen] === last[last.length - 1 - suffixLen]
  ) {
    suffixLen++;
  }

  const prefix = first.slice(0, prefixLen);
  const suffix = suffixLen > 0 ? first.slice(first.length - suffixLen) : "";

  if (prefix.length < 2 && suffix.length < 2) return null;

  const variables = sorted.map((n) =>
    n.slice(prefixLen, suffixLen > 0 ? n.length - suffixLen : undefined),
  );

  // Check all variables are non-empty and unique
  if (variables.some((v) => v.length === 0)) return null;
  if (new Set(variables).size !== variables.length) return null;

  return { template: `${prefix}{D}${suffix}`, variables };
}

/**
 * Group functions by domain if a consistent domain pattern exists.
 * Returns null if no domain structure detected.
 */
function detectDomains(funcs: FuncInfo[]): string[] | null {
  // Group by shape
  const groups = new Map<string, FuncInfo[]>();
  for (const f of funcs) {
    const key = shapeKey(f);
    const arr = groups.get(key) ?? [];
    arr.push(f);
    groups.set(key, arr);
  }

  // Find groups with size > 1 and extract variables
  const variableSets: string[][] = [];
  for (const [, group] of groups) {
    if (group.length < 2) continue;
    const pattern = extractNamingPattern(group.map((f) => f.name));
    if (pattern) variableSets.push(pattern.variables);
  }

  if (variableSets.length < 2) return null;

  // Find the most common variable set (= domain names)
  const setCounts = new Map<string, { vars: string[]; count: number }>();
  for (const vars of variableSets) {
    const key = [...vars].sort().join(",");
    const existing = setCounts.get(key);
    if (existing) {
      existing.count++;
    } else {
      setCounts.set(key, { vars, count: 1 });
    }
  }

  const best = [...setCounts.values()].sort((a, b) => b.count - a.count)[0];
  if (!best || best.count < 2) return null;

  return best.vars;
}

interface PatternGroup {
  pattern: string;
  kind: string;
  purity: "pure" | "effectful";
  effects: string[];
  capabilities: string[];
  instances: string[];
}

function compressToPatterns(funcs: FuncInfo[], domains: string[]): {
  patterns: PatternGroup[];
  ungrouped: FuncInfo[];
} {
  const groups = new Map<string, FuncInfo[]>();
  for (const f of funcs) {
    const key = shapeKey(f);
    const arr = groups.get(key) ?? [];
    arr.push(f);
    groups.set(key, arr);
  }

  const patterns: PatternGroup[] = [];
  const ungrouped: FuncInfo[] = [];

  for (const [, group] of groups) {
    if (group.length < 2) {
      ungrouped.push(...group);
      continue;
    }

    const naming = extractNamingPattern(group.map((f) => f.name));

    patterns.push({
      pattern: naming?.template ?? `(${group.length} functions)`,
      kind: group[0].kind,
      purity: group[0].purity,
      effects: group[0].effects,
      capabilities: group[0].capabilities,
      instances: group.map((f) => f.name).sort(),
    });
  }

  return { patterns: patterns.sort((a, b) => a.pattern.localeCompare(b.pattern)), ungrouped };
}

// =========================================================================
// Phase 3: Output
// =========================================================================

const allCapabilities = [...new Set(functions.flatMap((f) => f.capabilities))].sort();
const domains = detectDomains(functions);

if (domains && domains.length >= 2) {
  // Compressed output with patterns
  const { patterns, ungrouped } = compressToPatterns(functions, domains);

  // Compress types too
  const typeGroups = new Map<string, string[]>();
  for (const t of types) {
    const arr = typeGroups.get(t.kind) ?? [];
    arr.push(t.name);
    typeGroups.set(t.kind, arr);
  }
  const compressedTypes: Array<{ kind: string; pattern?: string; names: string[] }> = [];
  for (const [kind, names] of typeGroups) {
    const naming = extractNamingPattern(names);
    if (naming && names.length >= domains.length) {
      compressedTypes.push({ kind, pattern: naming.template, names: names.sort() });
    } else {
      compressedTypes.push({ kind, names: names.sort() });
    }
  }

  // Compress class dependsOn using domain template
  const compressedUngrouped = ungrouped.map((f) => {
    if (!f.dependsOn.length) return f;
    const depNaming = extractNamingPattern(f.dependsOn.filter((d) => {
      // Check if dep name contains a domain variable
      return domains.some((dom) => d.toLowerCase().includes(dom.toLowerCase()));
    }));
    if (depNaming && depNaming.variables.length >= 2) {
      return {
        ...f,
        dependsOnPattern: depNaming.template,
        dependsOn: f.dependsOn.filter((d) =>
          !domains.some((dom) => d.toLowerCase().includes(dom.toLowerCase())),
        ),
      };
    }
    return f;
  });

  console.log(JSON.stringify({
    structure: {
      domains,
      note: `${domains.length} domains with identical structure. {D} = domain name.`,
    },
    patterns: patterns.map((p) => ({
      purity: p.purity,
      ...(p.effects.length > 0 ? { effects: p.effects } : {}),
      ...(p.capabilities.length > 0 ? { capabilities: p.capabilities } : {}),
      names: p.instances,
    })),
    ...(compressedUngrouped.length > 0
      ? {
          unique: compressedUngrouped.map((f) => ({
            name: f.name,
            kind: f.kind,
            purity: f.purity,
            ...(f.effects.length > 0 ? { effects: f.effects } : {}),
            ...(f.capabilities.length > 0 ? { capabilities: f.capabilities } : {}),
            ...("dependsOnPattern" in f ? { dependsOnPattern: (f as any).dependsOnPattern } : {}),
            ...(f.dependsOn.length > 0 ? { dependsOn: f.dependsOn } : {}),
          })),
        }
      : {}),
    types: compressedTypes,
    imports: importModules,
    capabilities: allCapabilities,
  }, null, 2));
} else {
  // No pattern detected — flat output (same as before)
  console.log(JSON.stringify({
    functions: functions.map((f) => ({
      name: f.name,
      kind: f.kind,
      signature: f.signature,
      purity: f.purity,
      ...(f.effects.length > 0 ? { effects: f.effects } : {}),
      ...(f.capabilities.length > 0 ? { capabilities: f.capabilities } : {}),
      ...(f.dependsOn.length > 0 ? { dependsOn: f.dependsOn } : {}),
      syntaxHash: f.syntaxHash,
    })),
    types,
    imports: importModules,
    capabilities: allCapabilities,
  }, null, 2));
}

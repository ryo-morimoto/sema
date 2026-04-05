/**
 * SemanticProgram の組み立てと不変操作（パッチ適用、rehash）。
 * @internal
 */

import ts from "typescript";
import type {
  SemanticId,
  SymbolId,
  TypeId,
  SemanticNode,
  DefinitionNode,
  SymbolRecord,
  TypeRecord,
  SemanticProgram,
  Provenance,
} from "../types/semantic.js";
import type { ContractId, Contract, OverlayIndex, ContractKind } from "../types/contract.js";
import type { Diagnostic } from "../types/diagnostic.js";
import { HASH_VERSION } from "../types/hash.js";
import type { BuildOptions } from "../types/agent.js";
import { ingestSource, type RawNode, type RawIngestResult } from "./ingest.js";
import { normalize, toDefinitionNode } from "./normalize.js";
import { assignIdentity } from "./identity.js";

/**
 * TS ソースコード文字列から SemanticProgram を構築する。
 * ingest → normalize → identity → assemble の全パイプラインを実行。
 */
export function buildProgramFromSource(
  source: string,
  options?: BuildOptions,
): SemanticProgram {
  const rawResult = ingestSource(source, "input.ts");
  return assembleProgram(rawResult, options);
}

/**
 * RawIngestResult から SemanticProgram を組み立てる。
 */
export function assembleProgram(
  rawResult: RawIngestResult,
  _options?: BuildOptions,
): SemanticProgram {
  const normalized = normalize(rawResult);

  // Build type resolution map from raw types
  const typeResolutionMap: Map<SemanticId, string> = new Map();
  for (const typeRecord of normalized.types) {
    typeResolutionMap.set(typeRecord.id as unknown as SemanticId, typeRecord.text);
  }

  // Assign identity (hashes) to paired nodes
  const pairsWithId = normalized.pairs.map((pair, i) => {
    if (pair.raw && pair.node.kind !== "ImportDeclaration") {
      return { node: assignIdentity(pair.node, pair.raw, typeResolutionMap), raw: pair.raw };
    }
    return {
      node: {
        ...pair.node,
        id: (`import_${i}_${pair.node.name ?? ""}`) as SemanticId,
        syntaxHash: `import_${pair.node.name ?? i}`,
        semanticHash: `import_${pair.node.name ?? i}`,
      },
      raw: pair.raw,
    };
  });

  // Build maps
  const nodesMap = new Map<SemanticId, SemanticNode>();
  const definitionsMap = new Map<SemanticId, DefinitionNode>();
  const symbolsMap = new Map<SymbolId, SymbolRecord>();
  const typesMap = new Map<TypeId, TypeRecord>();

  function registerNode(node: SemanticNode, rawNode?: RawNode): void {
    nodesMap.set(node.id, node);

    if (rawNode) {
      const defNode = toDefinitionNode(rawNode, node);
      if (defNode) {
        definitionsMap.set(node.id, defNode);
      }
    }

    // Register children recursively
    for (let i = 0; i < node.children.length; i++) {
      const childRaw = rawNode?.children[i];
      registerNode(node.children[i], childRaw);
    }
  }

  for (const pair of pairsWithId) {
    registerNode(pair.node, pair.raw ?? undefined);
  }

  for (const sym of normalized.symbols) {
    symbolsMap.set(sym.id, sym);
  }
  for (const typ of normalized.types) {
    typesMap.set(typ.id, typ);
  }

  const emptyOverlays: OverlayIndex = {
    bySubject: new Map(),
    byKind: new Map<ContractKind, readonly ContractId[]>(),
  };

  const provenance: Provenance = {
    sourceFiles: [normalized.fileName],
    tsVersion: ts.version,
    hashVersion: HASH_VERSION,
    builtAt: Date.now(),
  };

  return {
    nodes: nodesMap,
    definitions: definitionsMap,
    symbols: symbolsMap,
    types: typesMap,
    contracts: new Map<ContractId, Contract>(),
    overlays: emptyOverlays,
    diagnostics: normalized.diagnostics,
    provenance,
  };
}

/**
 * SemanticPatch を適用して新しい SemanticProgram を生成する。
 */
export function applyPatch(
  program: SemanticProgram,
  patches: ReadonlyArray<{
    targetId: SemanticId;
    expectedHash: string;
    replacement: Partial<Pick<SemanticNode, "name" | "children" | "kind">>;
  }>,
): { program: SemanticProgram; changedIds: SemanticId[]; diagnostics: Diagnostic[] } {
  const newNodes = new Map(program.nodes);
  const newDefs = new Map(program.definitions);
  const changedIds: SemanticId[] = [];
  const diagnostics: Diagnostic[] = [];

  for (const patch of patches) {
    const existing = newNodes.get(patch.targetId);
    if (!existing) {
      diagnostics.push({
        severity: "error",
        message: `Node not found: ${patch.targetId}`,
        nodeId: patch.targetId,
        span: null,
        phase: "validate",
      });
      continue;
    }

    if (existing.syntaxHash !== patch.expectedHash) {
      diagnostics.push({
        severity: "error",
        message: `Stale patch: expected hash ${patch.expectedHash}, got ${existing.syntaxHash}`,
        nodeId: patch.targetId,
        span: null,
        phase: "validate",
      });
      continue;
    }

    const updated: SemanticNode = {
      ...existing,
      ...patch.replacement,
    };

    newNodes.set(patch.targetId, updated);
    changedIds.push(patch.targetId);

    // Update definitions if applicable
    const existingDef = newDefs.get(patch.targetId);
    if (existingDef) {
      newDefs.set(patch.targetId, { ...existingDef, ...patch.replacement });
    }
  }

  if (diagnostics.some((d) => d.severity === "error")) {
    return { program, changedIds: [], diagnostics };
  }

  return {
    program: {
      ...program,
      nodes: newNodes,
      definitions: newDefs,
      diagnostics: [...program.diagnostics, ...diagnostics],
    },
    changedIds,
    diagnostics,
  };
}

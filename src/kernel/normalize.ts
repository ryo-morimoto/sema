/**
 * 抽出されたノードを正規化する（de Bruijn indexing, 宣言ソート, trivia 除去）。
 * @internal
 */

import type {
  SemanticId,
  SemanticNode,
  DefinitionNode,
  NormalizedSourceFile,
} from "../types/semantic.js";
import type { Diagnostic } from "../types/diagnostic.js";
import type { RawIngestResult, RawNode, RawImport } from "./ingest.js";

/**
 * de Bruijn context: variable name → index (distance to binding site)
 */
type DeBruijnContext = ReadonlyMap<string, number>;

/**
 * RawIngestResult を正規化された NormalizedSourceFile に変換する。
 *
 * - de Bruijn indexing: 束縛変数名を位置インデックスに置換
 * - 宣言ソート: スコープ内で kind + name の辞書順にソート
 * - trivia 除去: ソース位置は保持するが正規化に影響しない
 *
 * この段階ではハッシュは未計算。id, syntaxHash, semanticHash はプレースホルダ。
 */
/** Paired result: normalized node + its raw origin */
export interface NormalizedPair {
  readonly node: SemanticNode;
  readonly raw: RawNode | null;
}

export function normalize(raw: RawIngestResult): NormalizedSourceFile & { pairs: readonly NormalizedPair[] } {
  const diagnostics: Diagnostic[] = [...raw.diagnostics];

  // Import nodes as SemanticNodes (non-definition)
  const importPairs: NormalizedPair[] = raw.imports.map((imp, i) => ({
    node: makeImportNode(imp, i),
    raw: null,
  }));

  // Normalize definition nodes, keeping raw pairing, then sort
  const defPairs: NormalizedPair[] = raw.nodes
    .map((rawNode) => ({
      node: normalizeRawNode(rawNode, new Map(), diagnostics),
      raw: rawNode,
    }))
    .sort((a, b) => sortByKindAndName(a.node, b.node));

  const allPairs = [...importPairs, ...defPairs];
  const allNodes = allPairs.map((p) => p.node);

  return {
    fileName: raw.fileName,
    nodes: allNodes,
    symbols: raw.symbols,
    types: raw.types,
    diagnostics,
    pairs: allPairs,
  };
}

function makeImportNode(imp: RawImport, index: number): SemanticNode {
  const placeholder = `__import_${index}__` as SemanticId;
  return {
    id: placeholder,
    kind: "ImportDeclaration",
    name: imp.moduleSpecifier,
    children: [],
    parent: null,
    syntaxHash: "",
    semanticHash: "",
    symbolRef: null,
    typeRef: null,
    openness: [],
    referencedModules: [],
    span: imp.span,
    diagnostics: [],
  };
}

function normalizeRawNode(
  raw: RawNode,
  parentCtx: DeBruijnContext,
  diagnostics: Diagnostic[],
): SemanticNode {
  // Build de Bruijn context for this scope
  const ctx = buildDeBruijnContext(raw, parentCtx);

  // Normalize children recursively, then sort
  const children = raw.children
    .map((child) => normalizeRawNode(child, ctx, diagnostics))
    .sort(sortByKindAndName);

  // Build de Bruijn-indexed name (for the node itself, name stays; for params, they are in context)
  const deBruijnName = buildDeBruijnName(raw, ctx);

  const placeholder = "__pending__" as SemanticId;

  const node: SemanticNode = {
    id: placeholder,
    kind: raw.kind,
    name: deBruijnName,
    children,
    parent: null,
    syntaxHash: "",
    semanticHash: "",
    symbolRef: raw.symbolRef,
    typeRef: raw.typeRef,
    openness: [],
    referencedModules: raw.referencedImports,
    span: raw.span,
    diagnostics: [],
  };

  return node;
}

/**
 * de Bruijn コンテキストを構築する。
 *
 * 関数パラメータと型パラメータを位置インデックスにマッピングする。
 * 親コンテキストのインデックスは子スコープでシフトされる。
 */
function buildDeBruijnContext(
  raw: RawNode,
  parentCtx: DeBruijnContext,
): DeBruijnContext {
  const ctx = new Map<string, number>();

  // Inherit parent context with shifted indices
  const totalNewBindings = raw.paramNames.length + raw.typeParamNames.length;
  for (const [name, idx] of parentCtx) {
    ctx.set(name, idx + totalNewBindings);
  }

  // Add type params first (outermost binding)
  for (let i = 0; i < raw.typeParamNames.length; i++) {
    ctx.set(raw.typeParamNames[i], i);
  }

  // Then value params
  const typeParamOffset = raw.typeParamNames.length;
  for (let i = 0; i < raw.paramNames.length; i++) {
    ctx.set(raw.paramNames[i], typeParamOffset + i);
  }

  return ctx;
}

/**
 * de Bruijn indexed な名前を構築する。
 *
 * 定義自体の名前は保持する（resolve で使うため）。
 * パラメータは de Bruijn context に記録済みで、
 * ハッシュ計算時に使用される。
 */
function buildDeBruijnName(raw: RawNode, _ctx: DeBruijnContext): string | null {
  // Definition names are preserved as-is for resolution
  return raw.name;
}

/** kind + name の辞書順でソート */
function sortByKindAndName(a: SemanticNode, b: SemanticNode): number {
  const kindCmp = a.kind.localeCompare(b.kind);
  if (kindCmp !== 0) return kindCmp;
  const aName = a.name ?? "";
  const bName = b.name ?? "";
  return aName.localeCompare(bName);
}

/**
 * RawNode から DefinitionNode を構築する（export 情報付き）。
 */
export function toDefinitionNode(
  raw: RawNode,
  node: SemanticNode,
): DefinitionNode | null {
  if (!raw.isExported) return null;
  return {
    ...node,
    exportNames: raw.exportNames,
    isDefault: raw.isDefault,
  };
}

/**
 * de Bruijn context を外部に公開（identity パスで使用）。
 */
export function buildContextForRawNode(
  raw: RawNode,
  parentCtx: DeBruijnContext = new Map(),
): DeBruijnContext {
  return buildDeBruijnContext(raw, parentCtx);
}

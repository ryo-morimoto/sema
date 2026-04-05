/**
 * SemanticNode → Hashable 変換、syntaxHash / semanticHash 計算。
 * @internal
 */

import { createHash } from "node:crypto";
import ts from "typescript";
import type { SemanticId, SemanticNode } from "../types/semantic.js";
import type {
  Hashable,
  TypeResolutionMap,
} from "../types/hash.js";
import { HASH_VERSION } from "../types/hash.js";
import type { RawNode } from "./ingest.js";

/**
 * RawNode + ts.Node から Hashable 中間表現を構築する。
 */
export function toHashable(raw: RawNode, childHashes: readonly string[]): Hashable {
  switch (raw.kind) {
    case "FunctionDeclaration":
      return {
        kind: "FunctionDeclaration",
        hashVersion: HASH_VERSION,
        paramCount: raw.paramNames.length,
        typeParamCount: raw.typeParamNames.length,
        bodyHash: hashFunctionBody(raw.tsNode),
        childHashes,
      };

    case "ArrowFunction":
      return {
        kind: "ArrowFunction",
        hashVersion: HASH_VERSION,
        paramCount: raw.paramNames.length,
        typeParamCount: raw.typeParamNames.length,
        bodyHash: hashFunctionBody(raw.tsNode),
        childHashes,
      };

    case "ClassDeclaration":
      return {
        kind: "ClassDeclaration",
        hashVersion: HASH_VERSION,
        typeParamCount: raw.typeParamNames.length,
        memberHashes: childHashes,
        heritageHashes: extractHeritageHashes(raw.tsNode),
        childHashes,
      };

    case "VariableDeclaration":
      return {
        kind: "VariableDeclaration",
        hashVersion: HASH_VERSION,
        declarationKind: raw.declarationKind ?? "const",
        initializerHash: hashInitializer(raw.tsNode),
        childHashes,
      };

    case "TypeAliasDeclaration":
      return {
        kind: "TypeAliasDeclaration",
        hashVersion: HASH_VERSION,
        typeParamCount: raw.typeParamNames.length,
        typeHash: hashTypeBody(raw.tsNode),
        childHashes,
      };

    case "InterfaceDeclaration":
      return {
        kind: "InterfaceDeclaration",
        hashVersion: HASH_VERSION,
        typeParamCount: raw.typeParamNames.length,
        memberHashes: extractInterfaceMemberHashes(raw.tsNode),
        heritageHashes: extractHeritageHashes(raw.tsNode),
        childHashes,
      };

    case "EnumDeclaration":
      return {
        kind: "EnumDeclaration",
        hashVersion: HASH_VERSION,
        memberHashes: childHashes,
        childHashes,
      };

    default:
      // ImportDeclaration, SourceFile, Unknown → treat as variable
      return {
        kind: "VariableDeclaration",
        hashVersion: HASH_VERSION,
        declarationKind: "const",
        initializerHash: null,
        childHashes,
      };
  }
}

/**
 * Hashable から syntaxHash を計算する。
 * Merkle tree 構造: H(hashVersion || kind || name || structural fields || child hashes)
 *
 * name はモジュールスコープでの宣言名。バウンド変数名ではない。
 * 同じ構造の `function foo(){}` と `function bar(){}` を区別するために必要。
 */
export function computeSyntaxHash(h: Hashable, name?: string | null): string {
  const parts: string[] = [
    String(h.hashVersion),
    h.kind,
    name ?? "",
  ];

  switch (h.kind) {
    case "FunctionDeclaration":
    case "ArrowFunction":
      parts.push(String(h.paramCount), String(h.typeParamCount), h.bodyHash ?? "null");
      break;
    case "ClassDeclaration":
      parts.push(String(h.typeParamCount), ...h.memberHashes, ...h.heritageHashes);
      break;
    case "VariableDeclaration":
      parts.push(h.declarationKind, h.initializerHash ?? "null");
      break;
    case "TypeAliasDeclaration":
      parts.push(String(h.typeParamCount), h.typeHash);
      break;
    case "InterfaceDeclaration":
      parts.push(String(h.typeParamCount), ...h.memberHashes, ...h.heritageHashes);
      break;
    case "EnumDeclaration":
      parts.push(...h.memberHashes);
      break;
  }

  // Append child hashes (Merkle)
  parts.push(...h.childHashes);

  return sha256Truncated(parts.join("|"));
}

/**
 * semanticHash = syntaxHash + type info。
 * 型アノテーション変更を検知する。
 */
export function computeSemanticHash(
  syntaxHash: string,
  typeText: string,
): string {
  return sha256Truncated(syntaxHash + "|type:" + typeText);
}

/**
 * 全ノードにハッシュを割り当てて SemanticId を設定する。
 */
export function assignIdentity(
  node: SemanticNode,
  raw: RawNode,
  typeInfo: TypeResolutionMap,
): SemanticNode {
  // First, recursively assign identity to children
  const childrenWithId = node.children.map((child, i) => {
    const childRaw = raw.children[i];
    if (childRaw) {
      return assignIdentity(child, childRaw, typeInfo);
    }
    return child;
  });

  const childHashes = childrenWithId.map((c) => c.syntaxHash);
  const hashable = toHashable(raw, childHashes);
  const syntaxHash = computeSyntaxHash(hashable, raw.name);
  const id = syntaxHash as SemanticId;

  // Look up type text from typeRef
  const typeText = node.typeRef ? (typeInfo.get(node.typeRef as unknown as SemanticId) ?? "unknown") : "unknown";
  const semanticHash = computeSemanticHash(syntaxHash, typeText);

  // Set parent on children
  const childrenWithParent = childrenWithId.map((c) => ({
    ...c,
    parent: id,
  }));

  return {
    ...node,
    id,
    syntaxHash,
    semanticHash,
    children: childrenWithParent,
  };
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function sha256Truncated(input: string): string {
  return createHash("sha256").update(input).digest("hex").slice(0, 16);
}

/**
 * 関数本体を正規化してハッシュする。
 * 変数名を de Bruijn インデックスに置換した正規化テキストをハッシュ。
 */
function hashFunctionBody(node: ts.Node): string | null {
  let body: ts.Node | undefined;

  if (ts.isFunctionDeclaration(node) || ts.isMethodDeclaration(node)) {
    body = node.body;
  } else if (ts.isArrowFunction(node)) {
    body = node.body;
  }

  if (!body) return null;

  // Strip parameter names and normalize to structural representation
  const printer = ts.createPrinter({ removeComments: true });
  const sourceFile = body.getSourceFile();
  const text = printer.printNode(ts.EmitHint.Unspecified, body, sourceFile);

  return sha256Truncated(text);
}

function hashInitializer(node: ts.Node): string | null {
  if (ts.isVariableDeclaration(node) && node.initializer) {
    const printer = ts.createPrinter({ removeComments: true });
    const sf = node.getSourceFile();
    const text = printer.printNode(ts.EmitHint.Unspecified, node.initializer, sf);
    return sha256Truncated(text);
  }
  return null;
}

function hashTypeBody(node: ts.Node): string {
  if (ts.isTypeAliasDeclaration(node)) {
    const printer = ts.createPrinter({ removeComments: true });
    const sf = node.getSourceFile();
    const text = printer.printNode(ts.EmitHint.Unspecified, node.type, sf);
    return sha256Truncated(text);
  }
  return sha256Truncated("unknown");
}

function extractHeritageHashes(node: ts.Node): string[] {
  const hashes: string[] = [];
  if (ts.isClassDeclaration(node) || ts.isInterfaceDeclaration(node)) {
    if (node.heritageClauses) {
      for (const clause of node.heritageClauses) {
        for (const type of clause.types) {
          const printer = ts.createPrinter({ removeComments: true });
          const sf = node.getSourceFile();
          const text = printer.printNode(ts.EmitHint.Unspecified, type, sf);
          hashes.push(sha256Truncated(text));
        }
      }
    }
  }
  return hashes;
}

function extractInterfaceMemberHashes(node: ts.Node): string[] {
  if (!ts.isInterfaceDeclaration(node)) return [];
  const hashes: string[] = [];
  const printer = ts.createPrinter({ removeComments: true });
  const sf = node.getSourceFile();
  for (const member of node.members) {
    const text = printer.printNode(ts.EmitHint.Unspecified, member, sf);
    hashes.push(sha256Truncated(text));
  }
  return hashes.sort();
}

/**
 * @module types/hash
 *
 * ハッシュ計算のための中間表現（Hashable）。
 *
 * SemanticNode を直接ハッシュしない。Unison プロジェクトの教訓に基づき、
 * 内部モデルの進化がハッシュを無効化しないよう、
 * ハッシュ入力専用の別型（Hashable）を経由する。
 *
 * Hashable に含まれるもの:
 * - ノード種別タグ、de Bruijn インデックス化されたパラメータ位置、
 *   子ハッシュ（再帰的 Merkle）、型参照ハッシュ（semanticHash のみ）
 *
 * Hashable に含まれないもの:
 * - ソース位置、コメント、フォーマット、元の変数名、diagnostic、
 *   コントラクト参照、ファイルパス
 *
 * 全てのハッシュ計算に `hashVersion` プレフィックスを含め、
 * 将来のハッシュスキーム移行を可能にする。
 */

import type { SemanticId } from "./semantic.js";

// ---------------------------------------------------------------------------
// Hash version
// ---------------------------------------------------------------------------

/**
 * 現在のハッシュスキームバージョン。
 * ハッシュ計算の入力に含まれ、スキーム変更時にインクリメントする。
 */
export const HASH_VERSION = 1;

// ---------------------------------------------------------------------------
// Hashable variants
// ---------------------------------------------------------------------------

interface HashableBase {
  readonly hashVersion: number;
  readonly childHashes: readonly string[];
}

/** 関数宣言のハッシュ入力 */
export interface HashableFunction extends HashableBase {
  readonly kind: "FunctionDeclaration";
  /** de Bruijn インデックス化されたパラメータ数 */
  readonly paramCount: number;
  /** 本体の正規化された構造表現 */
  readonly bodyHash: string | null;
  /** ジェネリック型パラメータ数 */
  readonly typeParamCount: number;
}

/** アロー関数のハッシュ入力 */
export interface HashableArrowFunction extends HashableBase {
  readonly kind: "ArrowFunction";
  readonly paramCount: number;
  readonly bodyHash: string | null;
  readonly typeParamCount: number;
}

/** クラス宣言のハッシュ入力 */
export interface HashableClass extends HashableBase {
  readonly kind: "ClassDeclaration";
  /** メンバーハッシュのソート済み配列 */
  readonly memberHashes: readonly string[];
  readonly typeParamCount: number;
  readonly heritageHashes: readonly string[];
}

/** 変数宣言のハッシュ入力 */
export interface HashableVariable extends HashableBase {
  readonly kind: "VariableDeclaration";
  /** const / let / var */
  readonly declarationKind: string;
  /** 初期化式のハッシュ */
  readonly initializerHash: string | null;
}

/** 型エイリアスのハッシュ入力 */
export interface HashableTypeAlias extends HashableBase {
  readonly kind: "TypeAliasDeclaration";
  readonly typeParamCount: number;
  /** 型本体のハッシュ */
  readonly typeHash: string;
}

/** インタフェースのハッシュ入力 */
export interface HashableInterface extends HashableBase {
  readonly kind: "InterfaceDeclaration";
  readonly typeParamCount: number;
  readonly memberHashes: readonly string[];
  readonly heritageHashes: readonly string[];
}

/** enum のハッシュ入力 */
export interface HashableEnum extends HashableBase {
  readonly kind: "EnumDeclaration";
  /** メンバー名 + 値のハッシュ（順序保持） */
  readonly memberHashes: readonly string[];
}

/**
 * ハッシュ計算に使用するノードの正規化された中間表現。
 *
 * `toHashable(node)` で SemanticNode から変換し、
 * `computeSyntaxHash(hashable)` / `computeSemanticHash(hashable, typeInfo)` でハッシュを得る。
 */
export type Hashable =
  | HashableFunction
  | HashableArrowFunction
  | HashableClass
  | HashableVariable
  | HashableTypeAlias
  | HashableInterface
  | HashableEnum;

// ---------------------------------------------------------------------------
// Type resolution map
// ---------------------------------------------------------------------------

/**
 * semanticHash 計算用の型解決マップ。
 *
 * SemanticId → 解決済み型文字列のマッピング。
 * `computeSemanticHash` に渡すことで、構造ハッシュに型情報を加味した
 * 意味ハッシュを計算する。型エイリアスは 1 段階のみ展開される。
 */
export type TypeResolutionMap = ReadonlyMap<SemanticId, string>;

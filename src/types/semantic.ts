/**
 * @module types/semantic
 *
 * セマンティックツリーの核となるデータ型。
 * TypeScript ソースコードを正規化・構造化した不変のツリー表現を定義する。
 */

// ---------------------------------------------------------------------------
// Branded ID types
// ---------------------------------------------------------------------------

declare const semanticIdBrand: unique symbol;
declare const symbolIdBrand: unique symbol;
declare const typeIdBrand: unique symbol;

/**
 * セマンティックノードの一意な識別子。
 *
 * ノードの `syntaxHash`（構造ハッシュ）から導出される content-addressed ID。
 * 変数名やフォーマットの変更に対して不変であり、
 * 同じ構造を持つコードは常に同じ SemanticId を生成する。
 *
 * branded type により、SymbolId や TypeId との混同をコンパイル時に防止する。
 */
export type SemanticId = string & { readonly [semanticIdBrand]: never };

/**
 * TypeScript シンボルの識別子。
 *
 * TS Compiler API の `ts.Symbol` に対応する。
 * 同じ宣言を参照する全てのノードが同一の SymbolId を共有する。
 */
export type SymbolId = string & { readonly [symbolIdBrand]: never };

/**
 * 解決済み型の識別子。
 *
 * TS Compiler API の型チェッカーが解決した型に対応する。
 * semanticHash の計算時に型の同一性判定に使用される。
 */
export type TypeId = string & { readonly [typeIdBrand]: never };

// ---------------------------------------------------------------------------
// Node kinds
// ---------------------------------------------------------------------------

/**
 * v1 でサポートするノード種別。
 *
 * - 7 つの宣言ノード: 関数、アロー関数、クラス、変数、型エイリアス、インタフェース、enum
 * - ImportDeclaration: 定義ノードではないが、capability 推論と参照解決に必要
 * - SourceFile: ソースファイルのルートノード
 * - Unknown: 未対応構文（diagnostic 付きでスキップされたノード）
 */
export type NodeKind =
  | "FunctionDeclaration"
  | "ArrowFunction"
  | "ClassDeclaration"
  | "VariableDeclaration"
  | "TypeAliasDeclaration"
  | "InterfaceDeclaration"
  | "EnumDeclaration"
  | "ImportDeclaration"
  | "SourceFile"
  | "Unknown";

// ---------------------------------------------------------------------------
// Source span
// ---------------------------------------------------------------------------

/**
 * 元のソースコード上の位置情報。
 *
 * 正規化を経ても best-effort で保持される provenance 情報。
 * デバッグやエラー報告、materialize 時のソースマップ生成に使用する。
 */
export interface SourceSpan {
  readonly file: string;
  readonly start: number;
  readonly end: number;
}

// ---------------------------------------------------------------------------
// Semantic node
// ---------------------------------------------------------------------------

/**
 * セマンティックツリーの基本ノード。
 *
 * TypeScript の AST を正規化した不変の表現。以下の正規化が適用済み:
 * - de Bruijn indexing により束縛変数名が位置インデックスに置換されている
 * - 宣言はスコープ内で安定キー（kind + name）によりソートされている
 * - フォーマット依存の情報（空白、コメント、元の変数名）は除去されている
 *
 * `openness` フィールドはコントラクトオーバーレイパスによって後から設定される。
 * ツリー構築時には空配列。
 */
export interface SemanticNode {
  /** content-addressed ID（syntaxHash 由来） */
  readonly id: SemanticId;

  /** ノード種別 */
  readonly kind: NodeKind;

  /** 宣言名。無名関数や式ノードの場合は null */
  readonly name: string | null;

  /** 子ノード（正規化済み、ソート済み） */
  readonly children: readonly SemanticNode[];

  /** 親ノードの ID。ルートノードの場合は null */
  readonly parent: SemanticId | null;

  /** 構造ハッシュ。rename/format に不変。identity の基盤 */
  readonly syntaxHash: string;

  /** 意味ハッシュ。構造 + 解決済み型 + 参照を含む。変更検知に使用 */
  readonly semanticHash: string;

  /** 対応する TS シンボルへの参照 */
  readonly symbolRef: SymbolId | null;

  /** 解決済み型への参照 */
  readonly typeRef: TypeId | null;

  /**
   * このノードに付与されたコントラクトへの参照（ContractId の配列）。
   *
   * コントラクトの実データは `SemanticProgram.contracts` に格納される。
   * ここにはポインタのみ。コントラクトオーバーレイパスで設定される。
   */
  readonly openness: readonly import("./contract.js").ContractId[];

  /**
   * この関数/メソッド本体内で参照されているモジュール名。
   * capability 推論で関数レベルの精度を実現するために使用する。
   * import バインディングの走査結果。非関数ノードでは空配列。
   */
  readonly referencedModules: readonly string[];

  /** 元のソースコード上の位置（best-effort） */
  readonly span: SourceSpan | null;

  /** このノードに関連する診断情報 */
  readonly diagnostics: readonly import("./diagnostic.js").Diagnostic[];
}

// ---------------------------------------------------------------------------
// Definition node
// ---------------------------------------------------------------------------

/**
 * エクスポートされた（または公開された）定義ノード。
 *
 * SemanticNode の拡張で、モジュール外部から参照可能な宣言を表す。
 * `definitions` レコードに格納され、Agent の resolve 操作の主な対象となる。
 */
export interface DefinitionNode extends SemanticNode {
  /** この定義がエクスポートされている名前のリスト */
  readonly exportNames: readonly string[];

  /** デフォルトエクスポートかどうか */
  readonly isDefault: boolean;
}

// ---------------------------------------------------------------------------
// Symbol / Type records
// ---------------------------------------------------------------------------

/**
 * TypeScript シンボルの解決済み情報。
 *
 * 同じシンボルを参照する複数のノードを結びつけるレコード。
 * 宣言サイト、参照サイト、型情報を統合する。
 */
export interface SymbolRecord {
  readonly id: SymbolId;
  readonly name: string;
  readonly declarations: readonly SemanticId[];
  readonly typeId: TypeId | null;
}

/**
 * 解決済み型の情報。
 *
 * TS Compiler API の型チェッカーが解決した型の正規化された表現。
 * semanticHash の計算で型の同一性を判定するために使用する。
 */
export interface TypeRecord {
  readonly id: TypeId;
  /** 型の文字列表現（checker.typeToString() の結果を正規化したもの） */
  readonly text: string;
  /** 型エイリアスの場合、1 段階展開した結果 */
  readonly expanded: string | null;
}

// ---------------------------------------------------------------------------
// Normalized source file (intermediate)
// ---------------------------------------------------------------------------

/**
 * 正規化パスの出力。プログラム組み立ての入力。
 *
 * ingest → normalize の結果を保持する中間表現。
 * まだハッシュは計算されておらず、プログラム組み立て時に identity パスを経て完成する。
 */
export interface NormalizedSourceFile {
  readonly fileName: string;
  readonly nodes: readonly SemanticNode[];
  readonly symbols: readonly SymbolRecord[];
  readonly types: readonly TypeRecord[];
  readonly diagnostics: readonly import("./diagnostic.js").Diagnostic[];
}

// ---------------------------------------------------------------------------
// Provenance
// ---------------------------------------------------------------------------

/**
 * SemanticProgram のビルドメタデータ。
 *
 * いつ・何から・どのバージョンで構築されたかを記録する。
 * ハッシュの再現性検証やデバッグに使用。
 */
export interface Provenance {
  readonly sourceFiles: readonly string[];
  readonly tsVersion: string;
  readonly hashVersion: number;
  readonly builtAt: number;
}

// ---------------------------------------------------------------------------
// Semantic program
// ---------------------------------------------------------------------------

/**
 * セマンティックプログラム — sema の中心データ構造。
 *
 * TypeScript ソースコードの完全なセマンティック表現を保持する不変のスナップショット。
 * 全てのノード、定義、シンボル、型、コントラクトがここに集約される。
 *
 * **不変性**: commit() は新しい SemanticProgram を返す。古いスナップショットは有効なまま残る。
 *
 * **deep module 設計**: この型を直接操作する必要はない。
 * `buildProgram()` で構築し、`createAgent()` 経由で問い合わせ・変更する。
 */
export interface SemanticProgram {
  /** 全ノードの ID → ノードマップ */
  readonly nodes: ReadonlyMap<SemanticId, SemanticNode>;

  /** エクスポートされた定義の ID → 定義ノードマップ */
  readonly definitions: ReadonlyMap<SemanticId, DefinitionNode>;

  /** シンボル ID → シンボル情報マップ */
  readonly symbols: ReadonlyMap<SymbolId, SymbolRecord>;

  /** 型 ID → 型情報マップ */
  readonly types: ReadonlyMap<TypeId, TypeRecord>;

  /** コントラクト ID → コントラクトマップ */
  readonly contracts: ReadonlyMap<import("./contract.js").ContractId, import("./contract.js").Contract>;

  /** コントラクトを主体ノード・種別で引くためのインデックス */
  readonly overlays: import("./contract.js").OverlayIndex;

  /** パイプライン全体で蓄積された診断情報 */
  readonly diagnostics: readonly import("./diagnostic.js").Diagnostic[];

  /** ビルドメタデータ */
  readonly provenance: Provenance;
}

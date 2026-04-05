/**
 * @module types/agent
 *
 * エージェントサーフェスの型定義。
 *
 * Agent はセマンティックプログラムに対する全操作の単一インタフェース。
 * テキスト範囲ではなくセマンティック選択を操作対象とする（ADR-007）。
 *
 * deep module 設計: 7 つのメソッドで query → validate → transform → commit → materialize の
 * 全パイプラインをカバーする。内部の複雑さ（グラフ走査、ハッシュ再計算、
 * AST 再構築）はインタフェースの裏に隠蔽される。
 */

import type {
  SemanticId,
  SemanticNode,
  DefinitionNode,
  NodeKind,
  SemanticProgram,
} from "./semantic.js";
import type { Contract } from "./contract.js";
import type { Diagnostic } from "./diagnostic.js";

// ---------------------------------------------------------------------------
// Agent interface
// ---------------------------------------------------------------------------

/**
 * セマンティックプログラムに対する全操作を提供する単一インタフェース。
 *
 * 読み取り系（resolve / inspect / slice）と書き込み系（validate / transform / commit / materialize）
 * の 7 メソッドで構成される。各メソッドはセマンティック単位で動作し、
 * テキスト上の行番号や文字オフセットを意識する必要がない。
 *
 * **使い方:**
 * ```typescript
 * const program = buildProgram(source);
 * const agent = createAgent(program);
 *
 * // 関数を名前で探す
 * const ids = agent.resolve({ name: "processData" });
 *
 * // 詳細を取得（コントラクト付き）
 * const view = agent.inspect(ids[0]);
 *
 * // コントラクト違反を検証
 * const report = agent.validate({ kind: "FunctionDeclaration" });
 *
 * // 変換してコミット
 * const patches = agent.transform({ name: "oldName" }, renameTransform);
 * const result = agent.commit(...patches);
 *
 * // 有効な TypeScript に戻す
 * const output = agent.materialize(...ids);
 * ```
 */
export interface Agent {
  /**
   * セレクタに一致するノードの ID を返す。
   *
   * 名前、ノード種別、glob パターンの組み合わせで定義ノードを検索する。
   * セレクタの各フィールドは AND 条件。全て省略すると全定義を返す。
   *
   * @param selector - 検索条件。省略時は全定義ノードを返す
   * @returns 一致したノードの SemanticId 配列（一致なしの場合は空配列）
   */
  resolve(selector?: Selector): SemanticId[];

  /**
   * ノードの完全な詳細情報をコントラクト付きで返す。
   *
   * ノード自体の全フィールドに加え、`openness` が参照するコントラクトの
   * 実データを解決して `NodeView` に統合する。
   *
   * @param id - 対象ノードの SemanticId
   * @returns ノードの詳細ビュー
   * @throws 存在しない ID を指定した場合
   */
  inspect(id: SemanticId): NodeView;

  /**
   * 指定ノード群から到達可能な最小連結部分グラフを抽出する。
   *
   * 起点ノードから parent/children および symbolRef エッジを辿り、
   * `depth` で指定した深さまでの連結部分グラフを返す。
   * 循環参照は自動的に検出・終了される。
   *
   * @param ids - 起点ノードの SemanticId 配列
   * @param depth - 探索の最大深さ（デフォルト: 1）。0 で起点のみ
   * @returns 連結部分グラフ
   */
  slice(ids: SemanticId[], depth?: number): SemanticSlice;

  /**
   * セレクタに一致するノードのコントラクト違反を検証する。
   *
   * v1 の検証ルール:
   * - ケイパビリティ違反: grants にないリソースへのアクセス
   * - 副作用不整合: async 関数が async とマークされていない
   *
   * セレクタを省略すると全ノードを検証する。
   *
   * @param selector - 検証対象の選択条件。省略時は全ノード
   * @returns 違反リストと検証サマリーを含むレポート
   */
  validate(selector?: Selector): ValidationReport;

  /**
   * セレクタに一致するノードにユーザー定義の変換関数を適用し、パッチを生成する。
   *
   * 変換関数はノードごとに呼び出され、SemanticPatch または null を返す。
   * null を返すとそのノードはスキップされる。
   * この段階ではプログラムは変更されない — パッチの生成のみ。
   *
   * @param selector - 変換対象の選択条件
   * @param fn - ノードを受け取りパッチまたは null を返す変換関数
   * @returns 生成されたパッチの配列
   */
  transform(selector: Selector, fn: TransformFn): SemanticPatch[];

  /**
   * パッチを適用して新しい SemanticProgram を生成する。
   *
   * 不変性を保証: 元のプログラムは変更されない。
   * 直接影響を受けるノードのハッシュは再計算される。
   * 推移的な依存ノードは `CommitResult.program` で `rehash()` を呼ぶまで stale のまま。
   *
   * パッチの対象ノードのハッシュが現在のプログラムと一致しない場合、
   * stale patch として拒否される。
   *
   * @param patches - 適用するパッチ（1 つ以上）
   * @returns コミット結果（新プログラム + 変更サマリー）
   * @throws stale patch、孤立子ノードの生成、その他の整合性エラー
   */
  commit(...patches: SemanticPatch[]): CommitResult;

  /**
   * ノードを有効な TypeScript ソースコードに変換する。
   *
   * 指定されたノードを `ts.factory` で AST に再構築し、
   * `ts.Printer` でテキストに変換する。
   * commit 後のノードは変更が反映された状態で出力される。
   *
   * @param ids - 出力対象のノード SemanticId（1 つ以上）
   * @returns 有効な TypeScript ソースコード文字列
   * @throws 存在しない ID を指定した場合
   */
  materialize(...ids: SemanticId[]): string;
}

// ---------------------------------------------------------------------------
// Selector
// ---------------------------------------------------------------------------

/**
 * ノード検索条件。
 *
 * 各フィールドは AND 条件で結合される。
 * 全て省略すると全定義ノードに一致する。
 */
export interface Selector {
  /** 定義名による完全一致 */
  readonly name?: string;
  /** ノード種別によるフィルタ */
  readonly kind?: NodeKind;
  /** 定義名に対する glob パターン（例: "handle*", "use*"） */
  readonly glob?: string;
}

// ---------------------------------------------------------------------------
// Node view
// ---------------------------------------------------------------------------

/**
 * `inspect()` が返すノードの詳細ビュー。
 *
 * SemanticNode の全フィールドに加え、
 * `openness` が参照するコントラクトの実データが展開されている。
 */
export interface NodeView {
  readonly node: SemanticNode;
  /** このノードが DefinitionNode の場合のみ設定 */
  readonly definition: DefinitionNode | null;
  /** openness が参照するコントラクトの実データ */
  readonly contracts: readonly Contract[];
}

// ---------------------------------------------------------------------------
// Semantic slice
// ---------------------------------------------------------------------------

/**
 * `slice()` が返す連結部分グラフ。
 *
 * 起点ノードから到達可能なノードの部分集合と、
 * それらを結ぶエッジのリスト。
 */
export interface SemanticSlice {
  /** 部分グラフに含まれるノード */
  readonly nodes: ReadonlyMap<SemanticId, SemanticNode>;
  /** ノード間のエッジ（source → target） */
  readonly edges: readonly SliceEdge[];
  /** 探索の起点ノード */
  readonly roots: readonly SemanticId[];
}

/** 部分グラフ内のエッジ */
export interface SliceEdge {
  readonly source: SemanticId;
  readonly target: SemanticId;
  readonly kind: "parent" | "child" | "symbolRef" | "typeRef";
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

/**
 * `validate()` が返すコントラクト違反レポート。
 */
export interface ValidationReport {
  /** 検出された違反の一覧 */
  readonly violations: readonly Violation[];
  /** 検証したノード数 */
  readonly checkedCount: number;
  /** 違反が 0 件かどうか */
  readonly ok: boolean;
}

/** 個々のコントラクト違反 */
export interface Violation {
  readonly nodeId: SemanticId;
  readonly contractId: import("./contract.js").ContractId;
  readonly rule: string;
  readonly message: string;
  readonly severity: import("./diagnostic.js").DiagnosticSeverity;
}

// ---------------------------------------------------------------------------
// Transform
// ---------------------------------------------------------------------------

/**
 * ノードを受け取り、パッチまたは null を返す変換関数。
 *
 * null を返すと「変更不要」を意味し、そのノードはスキップされる。
 */
export type TransformFn = (node: SemanticNode) => SemanticPatch | null;

// ---------------------------------------------------------------------------
// Semantic patch
// ---------------------------------------------------------------------------

/**
 * セマンティックレベルのパッチ。
 *
 * テキスト diff ではなく、ノード単位の変更を記述する。
 * `transform()` で生成し、`commit()` で適用する。
 *
 * `expectedHash` によるスタルネス検出:
 * commit 時にパッチ対象ノードの現在のハッシュと比較し、
 * 不一致の場合は他の変更との衝突として拒否する。
 */
export interface SemanticPatch {
  /** 変更対象ノードの ID */
  readonly targetId: SemanticId;
  /** パッチ生成時点での対象ノードのハッシュ（stale 検出用） */
  readonly expectedHash: string;
  /** 置換後のノードデータ（部分的: 変更するフィールドのみ） */
  readonly replacement: Partial<Pick<SemanticNode, "name" | "children" | "kind">>;
}

// ---------------------------------------------------------------------------
// Commit result
// ---------------------------------------------------------------------------

/**
 * `commit()` の結果。
 *
 * 新しい不変プログラムと変更のサマリーを含む。
 * `program` から新しい Agent を作成して操作を継続できる。
 */
export interface CommitResult {
  /** パッチ適用後の新しい SemanticProgram */
  readonly program: SemanticProgram;
  /** 変更されたノードの ID 一覧 */
  readonly changedIds: readonly SemanticId[];
  /** コミットに関する診断情報 */
  readonly diagnostics: readonly Diagnostic[];
}

// ---------------------------------------------------------------------------
// Build options
// ---------------------------------------------------------------------------

/**
 * `buildProgram()` のオプション。
 *
 * deep module 設計: デフォルトで全ての推論が有効。
 * ほとんどの場合、オプションを指定する必要はない。
 */
export interface BuildOptions {
  /** tsconfig.json のパス。省略時はデフォルトのコンパイラオプションを使用 */
  readonly tsconfig?: string;
  /** 副作用コントラクトの自動推論を有効にするか（デフォルト: true） */
  readonly inferEffects?: boolean;
  /** ケイパビリティコントラクトの自動推論を有効にするか（デフォルト: true） */
  readonly inferCapabilities?: boolean;
}

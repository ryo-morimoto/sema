/**
 * @module sema
 *
 * TypeScript セマンティック基盤。
 *
 * TS ソースコードを正規化されたセマンティックツリーに変換し、
 * コンテンツアドレス型の安定した identity を付与し、
 * 副作用・ケイパビリティ・ワールドのコントラクトをオーバーレイとして合成し、
 * セマンティック単位での問い合わせ・検証・変換・コミット・テキスト出力を提供する。
 *
 * ## Deep module 設計
 *
 * 公開 API は 3 関数のみ。内部パイプライン（ingest → normalize → identity →
 * contract inference → program assembly）の複雑さは全て隠蔽される。
 *
 * ```typescript
 * import { buildProgram, createAgent } from "sema";
 *
 * // 1. ソースからプログラムを構築（全パイプラインが自動実行される）
 * const program = buildProgram(`
 *   export async function fetchUser(id: string): Promise<User> {
 *     return await db.query(id);
 *   }
 * `);
 *
 * // 2. エージェントを作成して操作
 * const agent = createAgent(program);
 * const [id] = agent.resolve({ name: "fetchUser" });
 * const view = agent.inspect(id);
 * // view.contracts → [EffectContract{ async: true }, CapabilityContract{ grants: ["db:query"] }]
 *
 * // 3. 検証・変換・コミット・テキスト出力
 * const report = agent.validate();
 * const patches = agent.transform({ name: "fetchUser" }, renameNode("getUser"));
 * const { program: updated } = agent.commit(...patches);
 * const output = createAgent(updated).materialize(id);
 * ```
 */

// ---------------------------------------------------------------------------
// Re-export all public types
// ---------------------------------------------------------------------------

export type {
  // Identity
  SemanticId,
  SymbolId,
  TypeId,
  ContractId,

  // Tree
  NodeKind,
  SourceSpan,
  SemanticNode,
  DefinitionNode,
  SymbolRecord,
  TypeRecord,
  SemanticProgram,
  Provenance,

  // Contract
  ContractKind,
  EffectContract,
  CapabilityContract,
  WorldContract,
  WorldSpec,
  Contract,
  OverlayIndex,

  // Hash
  Hashable,
  TypeResolutionMap,

  // Agent
  Agent,
  Selector,
  NodeView,
  SemanticSlice,
  SliceEdge,
  ValidationReport,
  Violation,
  TransformFn,
  SemanticPatch,
  CommitResult,
  BuildOptions,

  // Diagnostic
  Diagnostic,
  DiagnosticSeverity,
  DiagnosticPhase,
} from "./types/index.js";

export { HASH_VERSION } from "./types/index.js";

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

import type { SemanticProgram } from "./types/semantic.js";
import type { SemanticId } from "./types/semantic.js";
import type { WorldSpec } from "./types/contract.js";
import type { Agent, BuildOptions } from "./types/agent.js";
import { buildProgramFromSource } from "./kernel/program.js";
import { attachContracts } from "./contracts/index.js";
import { declareWorld } from "./contracts/world.js";
import { createAgentImpl } from "./agent/index.js";

/**
 * TypeScript ソースコードからセマンティックプログラムを構築する。
 *
 * 1 回の呼び出しで以下の全パイプラインを実行する:
 * 1. **Ingest** — TS Compiler API でソースを解析し、サポート対象ノードを抽出
 * 2. **Normalize** — de Bruijn indexing、宣言ソート、trivia 除去で正規化
 * 3. **Identity** — Hashable 中間表現を経由して syntaxHash / semanticHash を計算
 * 4. **Contract inference** — 副作用（async/throw）とケイパビリティ（fs/net/process）を自動推論
 * 5. **Program assembly** — 全データを SemanticProgram に統合
 *
 * 未対応構文はスキップされ diagnostic として記録される。有効な TS に対してクラッシュしない。
 *
 * @param source - TypeScript ソースコード文字列
 * @param options - ビルドオプション（省略可。デフォルトで全推論が有効）
 * @returns 不変のセマンティックプログラム
 *
 * @example
 * ```typescript
 * const program = buildProgram(`
 *   export function add(a: number, b: number): number {
 *     return a + b;
 *   }
 * `);
 * // program.nodes — 全ノード
 * // program.definitions — エクスポートされた定義
 * // program.contracts — 推論されたコントラクト
 * // program.diagnostics — スキップされた構文等の診断情報
 * ```
 */
export function buildProgram(
  source: string,
  options?: BuildOptions,
): SemanticProgram {
  const program = buildProgramFromSource(source, options);
  return attachContracts(program, options);
}

/**
 * セマンティックプログラムにワールドコントラクトを宣言的に付与する。
 *
 * 副作用やケイパビリティは `buildProgram` で自動推論されるが、
 * ワールドコントラクト（外部サービス依存、通信先制約、信頼前提、義務）は
 * 開発者が明示的に宣言する必要がある。
 *
 * 不変性を保証: 元のプログラムは変更されず、新しい SemanticProgram を返す。
 *
 * @param program - コントラクトを付与する対象のプログラム
 * @param subjectIds - コントラクトの対象ノード群
 * @param spec - ワールドコントラクトの仕様
 * @returns ワールドコントラクトが追加された新しい SemanticProgram
 *
 * @example
 * ```typescript
 * const secured = declareWorldContract(program, [fetchUserId], {
 *   requiredServices: ["postgres", "redis"],
 *   allowedOutbound: ["api.internal.example.com"],
 *   trustAssumptions: ["auth token is validated by gateway"],
 *   obligations: ["must log audit trail", "must close DB connection"],
 * });
 * ```
 */
export function declareWorldContract(
  program: SemanticProgram,
  subjectIds: SemanticId[],
  spec: WorldSpec,
): SemanticProgram {
  return declareWorld(program, subjectIds, spec);
}

/**
 * セマンティックプログラムに対するエージェントを作成する。
 *
 * Agent はプログラムへの全操作（読み取り・検証・変換・コミット・テキスト出力）を
 * 提供する単一インタフェース。7 つのメソッドでセマンティックレベルの操作を行う:
 *
 * | メソッド | 役割 |
 * |---------|------|
 * | `resolve` | セレクタでノードを検索 → SemanticId[] |
 * | `inspect` | ノードの詳細をコントラクト付きで取得 |
 * | `slice` | ノード群の最小連結部分グラフを抽出 |
 * | `validate` | コントラクト違反を検証 |
 * | `transform` | ユーザー定義関数でパッチを生成 |
 * | `commit` | パッチを適用して新プログラムを生成 |
 * | `materialize` | ノードを有効な TypeScript に変換 |
 *
 * @param program - 操作対象のセマンティックプログラム
 * @returns 全操作を提供する Agent インタフェース
 *
 * @example
 * ```typescript
 * const agent = createAgent(program);
 *
 * // 探す → 見る → 検証する → 変える → 確定する → 出力する
 * const ids = agent.resolve({ kind: "FunctionDeclaration" });
 * const view = agent.inspect(ids[0]);
 * const report = agent.validate({ name: "fetchUser" });
 * const patches = agent.transform({ name: "old" }, renameTo("new"));
 * const { program: next } = agent.commit(...patches);
 * const code = createAgent(next).materialize(...ids);
 * ```
 */
export function createAgent(program: SemanticProgram): Agent {
  return createAgentImpl(program);
}

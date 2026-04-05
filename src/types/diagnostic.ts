/**
 * @module types/diagnostic
 *
 * 診断情報の型定義。
 *
 * sema は未対応構文やエラーでクラッシュしない。代わりに Diagnostic を蓄積し、
 * パイプラインの各段階（ingest, normalize, identity, contract inference）で
 * 発生した問題を構造化データとして報告する。
 */

import type { SemanticId, SourceSpan } from "./semantic.js";

// ---------------------------------------------------------------------------
// Severity
// ---------------------------------------------------------------------------

/** 診断の重大度 */
export type DiagnosticSeverity = "error" | "warning" | "info";

// ---------------------------------------------------------------------------
// Diagnostic
// ---------------------------------------------------------------------------

/**
 * パイプライン中に発生した問題の構造化された記録。
 *
 * - `error`: 処理を中断するほどの問題（例: tsconfig が見つからない）
 * - `warning`: ノードをスキップした、型が解決できなかった等
 * - `info`: 情報提供（例: 未対応構文をスキップした旨の通知）
 *
 * `nodeId` が設定されている場合、`SemanticProgram.nodes` で該当ノードを参照できる。
 * `span` が設定されている場合、元のソースコード上の位置を示す。
 */
export interface Diagnostic {
  readonly severity: DiagnosticSeverity;
  readonly message: string;
  /** この diagnostic が関連するノードの ID（存在しない場合は null） */
  readonly nodeId: SemanticId | null;
  /** 元のソースコード上の位置 */
  readonly span: SourceSpan | null;
  /** diagnostic を生成したパイプライン段階 */
  readonly phase: DiagnosticPhase;
}

/** diagnostic が発生したパイプラインの段階 */
export type DiagnosticPhase =
  | "ingest"
  | "normalize"
  | "identity"
  | "contract"
  | "validate";

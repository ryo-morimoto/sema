/**
 * @module types/contract
 *
 * コントラクトオーバーレイの型定義。
 *
 * コントラクトはノードに埋め込まれず、独立したオーバーレイとして存在する。
 * ノードは `openness` フィールドで ContractId を参照するのみ。
 * コントラクトの実データは `SemanticProgram.contracts` に格納される。
 *
 * 3 種のコントラクト:
 * - **Effect**: 関数が持つ副作用（async, throw, Promise 返却）
 * - **Capability**: 関数がアクセスするリソース（fs, net, process, console）
 * - **World**: ユーザーが宣言する外部依存・信頼境界（プログラマティック API のみ）
 */

import type { SemanticId } from "./semantic.js";

// ---------------------------------------------------------------------------
// Branded ID
// ---------------------------------------------------------------------------

declare const contractIdBrand: unique symbol;

/**
 * コントラクトの一意な識別子。
 *
 * SemanticId, SymbolId, TypeId との混同をコンパイル時に防止する。
 */
export type ContractId = string & { readonly [contractIdBrand]: never };

// ---------------------------------------------------------------------------
// Contract kinds
// ---------------------------------------------------------------------------

/** コントラクトの種別 */
export type ContractKind = "effect" | "capability" | "world";

// ---------------------------------------------------------------------------
// Effect contract
// ---------------------------------------------------------------------------

/**
 * 副作用コントラクト。
 *
 * 関数が持つ副作用を宣言的に記述する。
 * `inferEffects()` によりシグネチャから自動推論される:
 * - async キーワード → `async: true`
 * - throw 文 / エラーユニオン返却型 → `errorTypes` に列挙
 * - Promise 返却型 → `async: true`
 *
 * 対象ノードは `subjectIds` で参照する（ノードへの埋め込みではない）。
 */
export interface EffectContract {
  readonly kind: "effect";
  readonly id: ContractId;
  readonly subjectIds: readonly SemanticId[];
  readonly async: boolean;
  readonly errorTypes: readonly string[];
  readonly successType: string | null;
}

// ---------------------------------------------------------------------------
// Capability contract
// ---------------------------------------------------------------------------

/**
 * ケイパビリティコントラクト。
 *
 * 関数がアクセスするシステムリソースを宣言的に記述する。
 * `inferCapabilities()` により import パターンやグローバルアクセスから自動推論される:
 * - `import fs from 'fs'` → `grants: ["fs:read", "fs:write"]`
 * - `fetch(...)` → `grants: ["net:http"]`
 * - `process.env` → `grants: ["env:read"]`
 * - `console.log` → `grants: ["io:console"]`
 *
 * Agent の `validate()` でケイパビリティ違反（grants にないリソースへのアクセス）を検知できる。
 */
export interface CapabilityContract {
  readonly kind: "capability";
  readonly id: ContractId;
  readonly subjectIds: readonly SemanticId[];
  readonly grants: readonly string[];
}

// ---------------------------------------------------------------------------
// World contract
// ---------------------------------------------------------------------------

/**
 * ユーザーが `declareWorldContract()` API で宣言する外部依存・信頼境界コントラクト。
 *
 * 自動推論ではなく、開発者が明示的に「この関数群はこのサービスに依存し、
 * このプロトコルでのみ通信し、この義務を負う」と宣言するためのもの。
 *
 * v1 では JSDoc やデコレータからの自動パースは行わない（プログラマティック API のみ）。
 */
export interface WorldContract {
  readonly kind: "world";
  readonly id: ContractId;
  readonly subjectIds: readonly SemanticId[];
  readonly spec: WorldSpec;
}

/**
 * ワールドコントラクトの仕様。
 *
 * 対象ノード群が外部世界とどのような関係を持つかを記述する。
 */
export interface WorldSpec {
  /** 必要とする外部サービス名 */
  readonly requiredServices: readonly string[];
  /** 許可されるアウトバウンド通信先 */
  readonly allowedOutbound: readonly string[];
  /** 信頼の前提（例: "database is consistent", "auth token is valid"） */
  readonly trustAssumptions: readonly string[];
  /** 対象ノードが負う義務（例: "must close connection", "must log audit trail"） */
  readonly obligations: readonly string[];
}

// ---------------------------------------------------------------------------
// Contract union
// ---------------------------------------------------------------------------

/** 全コントラクト種別のユニオン型 */
export type Contract = EffectContract | CapabilityContract | WorldContract;

// ---------------------------------------------------------------------------
// Overlay index
// ---------------------------------------------------------------------------

/**
 * コントラクトの検索インデックス。
 *
 * `SemanticProgram.overlays` に格納され、
 * 主体ノードや種別からコントラクトを高速に引くためのルックアップ構造。
 */
export interface OverlayIndex {
  /** ノード ID → そのノードに付与されたコントラクト ID 群 */
  readonly bySubject: ReadonlyMap<SemanticId, readonly ContractId[]>;
  /** コントラクト種別 → その種別の全コントラクト ID 群 */
  readonly byKind: ReadonlyMap<ContractKind, readonly ContractId[]>;
}

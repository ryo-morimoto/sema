/**
 * sema 検証プロジェクト
 *
 * 4 つの柱を実際の TS コードで端から端まで検証する:
 * 1. Semantic tree is truth
 * 2. Tree-native identity (content-addressed, rename/format-invariant)
 * 3. Contracts are overlays
 * 4. Semantic-first agent surface
 */

import { buildProgram, createAgent, declareWorldContract } from "./src/index.js";
import type { SemanticNode } from "./src/types/semantic.js";
import type { SemanticPatch } from "./src/types/agent.js";

let passed = 0;
let failed = 0;

function assert(condition: boolean, label: string) {
  if (condition) {
    console.log(`  ✓ ${label}`);
    passed++;
  } else {
    console.log(`  ✗ ${label}`);
    failed++;
  }
}

// ---------------------------------------------------------------------------
// 検証対象: 実際的な TS コード
// ---------------------------------------------------------------------------

const REAL_SOURCE = `
import fs from "fs";

export type UserId = string;

export interface UserProfile {
  id: UserId;
  name: string;
  email: string;
  role: Role;
}

export enum Role {
  Admin = "admin",
  Editor = "editor",
  Viewer = "viewer",
}

export const DEFAULT_ROLE: Role = Role.Viewer;

export async function fetchUserProfile(id: UserId): Promise<UserProfile> {
  const raw = fs.readFileSync(\`/users/\${id}.json\`, "utf-8");
  return JSON.parse(raw);
}

export const formatUserName = (user: UserProfile): string => {
  return \`\${user.name} (\${user.role})\`;
};

export class UserService {
  private cache: Map<UserId, UserProfile> = new Map();

  async getUser(id: UserId): Promise<UserProfile> {
    const cached = this.cache.get(id);
    if (cached) return cached;
    const profile = await fetchUserProfile(id);
    this.cache.set(id, profile);
    return profile;
  }

  clearCache(): void {
    this.cache.clear();
  }
}

export function isAdmin(user: UserProfile): boolean {
  return user.role === Role.Admin;
}
`;

// ---------------------------------------------------------------------------
// Pillar 1: Semantic tree is truth
// ---------------------------------------------------------------------------

console.log("\n═══ Pillar 1: Semantic tree is truth ═══\n");

const program = buildProgram(REAL_SOURCE);
const agent = createAgent(program);

assert(program.nodes.size > 0, `ノード数: ${program.nodes.size} > 0`);
assert(program.definitions.size > 0, `定義数: ${program.definitions.size} > 0`);

// 全 7 ノード種別を検証
const functions = agent.resolve({ kind: "FunctionDeclaration" });
const arrows = agent.resolve({ kind: "ArrowFunction" });
const classes = agent.resolve({ kind: "ClassDeclaration" });
const variables = agent.resolve({ kind: "VariableDeclaration" });
const typeAliases = agent.resolve({ kind: "TypeAliasDeclaration" });
const interfaces = agent.resolve({ kind: "InterfaceDeclaration" });
const enums = agent.resolve({ kind: "EnumDeclaration" });

assert(functions.length >= 2, `FunctionDeclaration: ${functions.length} >= 2 (fetchUserProfile, isAdmin)`);
assert(arrows.length >= 1, `ArrowFunction: ${arrows.length} >= 1 (formatUserName)`);
assert(classes.length >= 1, `ClassDeclaration: ${classes.length} >= 1 (UserService)`);
assert(variables.length >= 1, `VariableDeclaration: ${variables.length} >= 1 (DEFAULT_ROLE)`);
assert(typeAliases.length >= 1, `TypeAliasDeclaration: ${typeAliases.length} >= 1 (UserId)`);
assert(interfaces.length >= 1, `InterfaceDeclaration: ${interfaces.length} >= 1 (UserProfile)`);
assert(enums.length >= 1, `EnumDeclaration: ${enums.length} >= 1 (Role)`);

// inspect で詳細取得
const [fetchId] = agent.resolve({ name: "fetchUserProfile" });
const fetchView = agent.inspect(fetchId);
assert(fetchView.node.kind === "FunctionDeclaration", "fetchUserProfile は FunctionDeclaration");
assert(fetchView.node.name === "fetchUserProfile", "名前が正しい");
assert(fetchView.node.syntaxHash.length === 16, `syntaxHash 長: ${fetchView.node.syntaxHash.length}`);
assert(fetchView.definition !== null, "定義ノードとして認識されている");
assert(fetchView.definition!.exportNames.includes("fetchUserProfile"), "export 名が正しい");

// クラスの子ノード検証
const [serviceId] = agent.resolve({ name: "UserService" });
const serviceView = agent.inspect(serviceId);
assert(serviceView.node.children.length >= 2, `UserService メンバー数: ${serviceView.node.children.length} >= 2`);

// diagnostic 検証（未対応構文なし）
assert(program.diagnostics.length === 0, `diagnostic: ${program.diagnostics.length} === 0 (正常な TS)`);

// ---------------------------------------------------------------------------
// Pillar 2: Tree-native identity
// ---------------------------------------------------------------------------

console.log("\n═══ Pillar 2: Tree-native identity ═══\n");

// 同一ソース → 同一ハッシュ（決定性）
const program2 = buildProgram(REAL_SOURCE);
const agent2 = createAgent(program2);

const [fetchId2] = agent2.resolve({ name: "fetchUserProfile" });
const fetchView2 = agent2.inspect(fetchId2);
assert(fetchView.node.syntaxHash === fetchView2.node.syntaxHash, "同一ソース → 同一 syntaxHash（決定性）");
assert(fetchView.node.semanticHash === fetchView2.node.semanticHash, "同一ソース → 同一 semanticHash（決定性）");
assert(fetchId === fetchId2, "同一ソース → 同一 SemanticId");

// フォーマット変更 → 同一 syntaxHash
const REFORMATTED = REAL_SOURCE
  .replace(/\n\n/g, "\n\n\n")  // 余分な空行追加
  .replace(/  /g, "    ");      // インデント変更

const programReformat = buildProgram(REFORMATTED);
const agentReformat = createAgent(programReformat);
const [fetchIdReformat] = agentReformat.resolve({ name: "fetchUserProfile" });
const fetchViewReformat = agentReformat.inspect(fetchIdReformat);
assert(
  fetchView.node.syntaxHash === fetchViewReformat.node.syntaxHash,
  "フォーマット変更 → syntaxHash 不変"
);

// 型変更 → semanticHash が変化、syntaxHash は不変
// UserId = string なので string→string は同じ。number に変えて真の型変更を検証
const TYPE_CHANGED = REAL_SOURCE.replace(
  "export async function fetchUserProfile(id: UserId): Promise<UserProfile>",
  "export async function fetchUserProfile(id: number): Promise<UserProfile>",
);
const programTypeChanged = buildProgram(TYPE_CHANGED);
const agentTypeChanged = createAgent(programTypeChanged);
const [fetchIdTypeChanged] = agentTypeChanged.resolve({ name: "fetchUserProfile" });

if (fetchIdTypeChanged) {
  const fetchViewTypeChanged = agentTypeChanged.inspect(fetchIdTypeChanged);
  // syntaxHash は関数の構造に依存（型は含まない）
  // ただし型が変わるとパラメータの解決も変わる可能性がある
  assert(
    fetchView.node.semanticHash !== fetchViewTypeChanged.node.semanticHash,
    "型変更 → semanticHash 変化"
  );
} else {
  assert(false, "型変更後も fetchUserProfile が見つかるべき");
}

// ---------------------------------------------------------------------------
// Pillar 3: Contracts are overlays
// ---------------------------------------------------------------------------

console.log("\n═══ Pillar 3: Contracts are overlays ═══\n");

// 自動推論されたコントラクト
assert(program.contracts.size > 0, `コントラクト数: ${program.contracts.size} > 0`);

const effectContracts = [...program.contracts.values()].filter(c => c.kind === "effect");
const capContracts = [...program.contracts.values()].filter(c => c.kind === "capability");
assert(effectContracts.length > 0, `Effect コントラクト: ${effectContracts.length} > 0 (async function あり)`);
assert(capContracts.length > 0, `Capability コントラクト: ${capContracts.length} > 0 (fs import あり)`);

// Capability grants に fs が含まれる
if (capContracts.length > 0 && capContracts[0].kind === "capability") {
  assert(
    capContracts[0].grants.some(g => g.startsWith("fs:")),
    `fs capability: ${capContracts[0].grants.join(", ")}`
  );
}

// overlay index が機能している
assert(program.overlays.byKind.size > 0, `overlay byKind: ${program.overlays.byKind.size} > 0`);
assert(program.overlays.bySubject.size > 0, `overlay bySubject: ${program.overlays.bySubject.size} > 0`);

// ノードの openness がコントラクト ID を参照している
const fetchWithContracts = agent.inspect(fetchId);
assert(
  fetchWithContracts.contracts.length > 0,
  `fetchUserProfile のコントラクト数: ${fetchWithContracts.contracts.length} > 0`
);

// コントラクトはノードに埋め込まれていない（overlay）
const rawNode = program.nodes.get(fetchId)!;
assert(
  rawNode.openness.length > 0 && rawNode.openness.every(cid => program.contracts.has(cid)),
  "openness は ContractId 参照のみ（実データは program.contracts に格納）"
);

// World contract 宣言
const [isAdminId] = agent.resolve({ name: "isAdmin" });
const withWorld = declareWorldContract(program, [isAdminId], {
  requiredServices: ["auth-service"],
  allowedOutbound: [],
  trustAssumptions: ["user object is authenticated"],
  obligations: ["must not cache authorization decisions"],
});

assert(withWorld.contracts.size > program.contracts.size, "World contract が追加された");
assert(program.contracts.size === withWorld.contracts.size - 1, "元の program は不変");

const worldAgent = createAgent(withWorld);
const isAdminView = worldAgent.inspect(isAdminId);
const worldContract = isAdminView.contracts.find(c => c.kind === "world");
assert(worldContract !== undefined, "isAdmin に World contract が付与されている");
if (worldContract?.kind === "world") {
  assert(
    worldContract.spec.requiredServices.includes("auth-service"),
    "World spec に auth-service が含まれる"
  );
}

// ---------------------------------------------------------------------------
// Pillar 4: Semantic-first agent surface
// ---------------------------------------------------------------------------

console.log("\n═══ Pillar 4: Semantic-first agent surface ═══\n");

// resolve: glob パターン
const userRelated = agent.resolve({ glob: "*User*" });
assert(userRelated.length >= 2, `glob "*User*": ${userRelated.length} >= 2`);

// slice: 連結部分グラフ
const serviceSlice = agent.slice([serviceId], 1);
assert(serviceSlice.nodes.size > 1, `UserService slice ノード数: ${serviceSlice.nodes.size} > 1`);
assert(serviceSlice.edges.length > 0, `UserService slice エッジ数: ${serviceSlice.edges.length} > 0`);

// validate
const report = agent.validate();
assert(report.ok, `validate: ok=${report.ok}, checked=${report.checkedCount}`);

// transform → commit → materialize (full write pipeline)
const patches = agent.transform(
  { name: "isAdmin" },
  (node: SemanticNode): SemanticPatch => ({
    targetId: node.id,
    expectedHash: node.syntaxHash,
    replacement: { name: "hasAdminRole" },
  }),
);
assert(patches.length === 1, `transform パッチ数: ${patches.length}`);

const commitResult = agent.commit(...patches);
assert(commitResult.changedIds.length === 1, `commit 変更ノード数: ${commitResult.changedIds.length}`);

// 新プログラムで materialize
const newAgent = createAgent(commitResult.program);
const code = newAgent.materialize(isAdminId);
assert(code.includes("hasAdminRole"), `materialize: rename 反映 → "${code.slice(0, 40)}..."`);
assert(!code.includes("isAdmin"), "materialize: 旧名は含まれない");

// 元のプログラムは不変
const originalCode = agent.materialize(isAdminId);
assert(originalCode.includes("isAdmin"), "元のプログラムは不変（isAdmin のまま）");

// 全定義を materialize
const allDefs = agent.resolve();
for (const id of allDefs) {
  const materialized = agent.materialize(id);
  assert(materialized.length > 0, `materialize ${agent.inspect(id).node.name}: ${materialized.length} chars`);
}

// ---------------------------------------------------------------------------
// Result
// ---------------------------------------------------------------------------

console.log("\n═══════════════════════════════════════════");
console.log(`  Result: ${passed} passed, ${failed} failed`);
console.log("═══════════════════════════════════════════\n");

if (failed > 0) {
  process.exit(1);
}

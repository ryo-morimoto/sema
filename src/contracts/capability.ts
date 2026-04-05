/**
 * ケイパビリティコントラクトの推論（fs, net, process, console アクセス）。
 *
 * 関数レベルの精度: 各関数本体内で実際に参照されている import バインディングと
 * グローバルアクセスパターンに基づいて、関数ごとに個別のケイパビリティを付与する。
 *
 * @internal
 */

import type { SemanticId, SemanticProgram } from "../types/semantic.js";
import type { ContractId, CapabilityContract } from "../types/contract.js";

let contractCounter = 0;
function nextContractId(): ContractId {
  return `capability_${++contractCounter}` as ContractId;
}

/** モジュール名 → ケイパビリティのマッピング */
const MODULE_CAPABILITIES: Record<string, string[]> = {
  fs: ["fs:read", "fs:write"],
  "fs/promises": ["fs:read", "fs:write"],
  "node:fs": ["fs:read", "fs:write"],
  "node:fs/promises": ["fs:read", "fs:write"],
  net: ["net:socket"],
  "node:net": ["net:socket"],
  http: ["net:http"],
  "node:http": ["net:http"],
  https: ["net:https"],
  "node:https": ["net:https"],
  child_process: ["process:spawn"],
  "node:child_process": ["process:spawn"],
};

/** グローバルアクセスパターン → ケイパビリティ */
const GLOBAL_CAPABILITIES: Record<string, string[]> = {
  "__global:console": ["io:console"],
  "__global:fetch": ["net:http"],
  "__global:process": ["env:read"],
};

/**
 * 各関数ノードの `referencedModules` から関数レベルのケイパビリティコントラクトを推論する。
 *
 * ファイルレベルではなく、各関数が実際に参照しているモジュール/グローバルのみを
 * ケイパビリティとして付与する。
 */
export function inferCapabilities(program: SemanticProgram): CapabilityContract[] {
  const contracts: CapabilityContract[] = [];

  for (const [id, node] of program.nodes) {
    if (node.kind !== "FunctionDeclaration" && node.kind !== "ArrowFunction") {
      continue;
    }

    // Collect grants from this function's referenced modules
    const grants = new Set<string>();
    for (const moduleRef of node.referencedModules) {
      const moduleCaps = MODULE_CAPABILITIES[moduleRef];
      if (moduleCaps) {
        for (const cap of moduleCaps) grants.add(cap);
      }
      const globalCaps = GLOBAL_CAPABILITIES[moduleRef];
      if (globalCaps) {
        for (const cap of globalCaps) grants.add(cap);
      }
    }

    if (grants.size === 0) continue;

    contracts.push({
      kind: "capability",
      id: nextContractId(),
      subjectIds: [id],
      grants: [...grants].sort(),
    });
  }

  return contracts;
}

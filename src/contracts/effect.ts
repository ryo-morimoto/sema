/**
 * 副作用コントラクトの推論（async, throw, Promise）。
 * @internal
 */

import type { SemanticProgram } from "../types/semantic.js";
import type { ContractId, EffectContract } from "../types/contract.js";

let contractCounter = 0;
function nextContractId(): ContractId {
  return `effect_${++contractCounter}` as ContractId;
}

/**
 * SemanticProgram の関数ノードから副作用コントラクトを推論する。
 *
 * 検出パターン:
 * - ノード名に "async" を含む（簡易ヒューリスティック）
 * - 型テキストに "Promise" を含む
 */
export function inferEffects(program: SemanticProgram): EffectContract[] {
  const contracts: EffectContract[] = [];

  for (const [id, node] of program.nodes) {
    if (node.kind !== "FunctionDeclaration" && node.kind !== "ArrowFunction") {
      continue;
    }

    // Check type text from typeRef
    const typeRecord = node.typeRef ? program.types.get(node.typeRef) : null;
    const typeText = typeRecord?.text ?? "";

    // Also check all type records associated with this node's symbol
    let fullTypeText = typeText;
    if (node.symbolRef) {
      const symbol = program.symbols.get(node.symbolRef);
      if (symbol?.typeId) {
        const symType = program.types.get(symbol.typeId);
        if (symType) {
          fullTypeText = symType.text;
        }
      }
    }

    const isAsync = fullTypeText.includes("Promise");
    const hasErrorTypes = fullTypeText.includes("Error") || fullTypeText.includes("never");

    if (isAsync || hasErrorTypes) {
      const errorTypes: string[] = [];
      if (hasErrorTypes && fullTypeText.includes("Error")) {
        errorTypes.push("Error");
      }

      contracts.push({
        kind: "effect",
        id: nextContractId(),
        subjectIds: [id],
        async: isAsync,
        errorTypes,
        successType: fullTypeText.replace(/Promise<(.+)>/, "$1") || null,
      });
    }
  }

  return contracts;
}

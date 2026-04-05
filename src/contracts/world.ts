/**
 * ワールドコントラクトの宣言的 API。
 * @internal
 */

import type { SemanticId, SemanticProgram } from "../types/semantic.js";
import type { ContractId, WorldContract, WorldSpec } from "../types/contract.js";

let contractCounter = 0;
function nextContractId(): ContractId {
  return `world_${++contractCounter}` as ContractId;
}

/**
 * プログラムにワールドコントラクトを宣言的に付与する。
 * 新しい SemanticProgram を返す（元は不変）。
 */
export function declareWorld(
  program: SemanticProgram,
  subjectIds: SemanticId[],
  spec: WorldSpec,
): SemanticProgram {
  const contract: WorldContract = {
    kind: "world",
    id: nextContractId(),
    subjectIds,
    spec,
  };

  const newContracts = new Map(program.contracts);
  newContracts.set(contract.id, contract);

  // Update overlays
  const bySubject = new Map(program.overlays.bySubject);
  for (const subjectId of subjectIds) {
    const existing = bySubject.get(subjectId) ?? [];
    bySubject.set(subjectId, [...existing, contract.id]);
  }

  const byKind = new Map(program.overlays.byKind);
  const existingWorld = byKind.get("world") ?? [];
  byKind.set("world", [...existingWorld, contract.id]);

  // Update openness on subject nodes
  const newNodes = new Map(program.nodes);
  for (const subjectId of subjectIds) {
    const node = newNodes.get(subjectId);
    if (node) {
      newNodes.set(subjectId, {
        ...node,
        openness: [...node.openness, contract.id],
      });
    }
  }

  return {
    ...program,
    nodes: newNodes,
    contracts: newContracts,
    overlays: { bySubject, byKind },
  };
}

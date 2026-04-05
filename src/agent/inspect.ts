/**
 * ノード詳細取得（コントラクト解決付き）。
 * @internal
 */

import type { SemanticId, SemanticProgram } from "../types/semantic.js";
import type { NodeView } from "../types/agent.js";
import type { Contract } from "../types/contract.js";

/**
 * ノードの完全な詳細情報をコントラクト付きで返す。
 */
export function inspect(program: SemanticProgram, id: SemanticId): NodeView {
  const node = program.nodes.get(id);
  if (!node) {
    throw new Error(`Node not found: ${id}`);
  }

  const definition = program.definitions.get(id) ?? null;

  // Resolve contracts from openness refs
  const contracts: Contract[] = [];
  for (const contractId of node.openness) {
    const contract = program.contracts.get(contractId);
    if (contract) {
      contracts.push(contract);
    }
  }

  return { node, definition, contracts };
}

/**
 * コントラクト推論・宣言の統合エントリポイント。
 * @internal
 */

import type { SemanticProgram } from "../types/semantic.js";
import type { Contract } from "../types/contract.js";
import type { BuildOptions } from "../types/agent.js";
import { inferEffects } from "./effect.js";
import { inferCapabilities } from "./capability.js";

/**
 * プログラムにコントラクトを推論・付与して返す。
 */
export function attachContracts(
  program: SemanticProgram,
  options?: BuildOptions,
): SemanticProgram {
  const shouldInferEffects = options?.inferEffects !== false;
  const shouldInferCapabilities = options?.inferCapabilities !== false;

  const allContracts: Contract[] = [];

  if (shouldInferEffects) {
    allContracts.push(...inferEffects(program));
  }
  if (shouldInferCapabilities) {
    allContracts.push(...inferCapabilities(program));
  }

  if (allContracts.length === 0) return program;

  // Build new contract map
  const newContracts = new Map(program.contracts);
  for (const contract of allContracts) {
    newContracts.set(contract.id, contract);
  }

  // Build overlay index
  const bySubject = new Map(program.overlays.bySubject);
  const byKind = new Map(program.overlays.byKind);

  for (const contract of allContracts) {
    // byKind
    const existing = byKind.get(contract.kind) ?? [];
    byKind.set(contract.kind, [...existing, contract.id]);

    // bySubject
    for (const subjectId of contract.subjectIds) {
      const subjectContracts = bySubject.get(subjectId) ?? [];
      bySubject.set(subjectId, [...subjectContracts, contract.id]);
    }
  }

  // Update openness on subject nodes
  const newNodes = new Map(program.nodes);
  for (const contract of allContracts) {
    for (const subjectId of contract.subjectIds) {
      const node = newNodes.get(subjectId);
      if (node) {
        newNodes.set(subjectId, {
          ...node,
          openness: [...node.openness, contract.id],
        });
      }
    }
  }

  return {
    ...program,
    nodes: newNodes,
    contracts: newContracts,
    overlays: { bySubject, byKind },
  };
}

export { inferEffects } from "./effect.js";
export { inferCapabilities } from "./capability.js";
export { declareWorld } from "./world.js";

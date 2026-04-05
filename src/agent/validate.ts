/**
 * コントラクト違反の検証。
 * @internal
 */

import type { SemanticId, SemanticProgram } from "../types/semantic.js";
import type { Selector, ValidationReport, Violation } from "../types/agent.js";
import type { EffectContract, CapabilityContract } from "../types/contract.js";
import { resolve } from "./resolve.js";

/**
 * コントラクト違反を検証してレポートを返す。
 */
export function validate(
  program: SemanticProgram,
  selector?: Selector,
): ValidationReport {
  const ids = resolve(program, selector);
  const violations: Violation[] = [];

  for (const id of ids) {
    const node = program.nodes.get(id);
    if (!node) continue;

    // Check contracts on this node
    for (const contractId of node.openness) {
      const contract = program.contracts.get(contractId);
      if (!contract) continue;

      if (contract.kind === "effect") {
        const effectViolations = checkEffectContract(id, contract, program);
        violations.push(...effectViolations);
      }

      if (contract.kind === "capability") {
        const capViolations = checkCapabilityContract(id, contract, program);
        violations.push(...capViolations);
      }
    }
  }

  return {
    violations,
    checkedCount: ids.length,
    ok: violations.length === 0,
  };
}

function checkEffectContract(
  _nodeId: SemanticId,
  contract: EffectContract,
  _program: SemanticProgram,
): Violation[] {
  const violations: Violation[] = [];

  // v1: Check if async function is properly annotated
  if (contract.async) {
    // This is informational — the function IS async, which is correct
    // A violation would be if it's NOT marked async but has async effects
    // For now, no violations for properly marked functions
  }

  return violations;
}

function checkCapabilityContract(
  _nodeId: SemanticId,
  _contract: CapabilityContract,
  _program: SemanticProgram,
): Violation[] {
  // v1: capability contracts are informational, not enforced
  // Future: check if grants match actual resource access
  return [];
}

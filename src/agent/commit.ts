/**
 * パッチ適用と新 SemanticProgram 生成。
 * @internal
 */

import type { SemanticProgram } from "../types/semantic.js";
import type { SemanticPatch, CommitResult } from "../types/agent.js";
import { applyPatch } from "../kernel/program.js";

/**
 * パッチを適用して新しい SemanticProgram を生成する。
 */
export function commit(
  program: SemanticProgram,
  patches: SemanticPatch[],
): CommitResult {
  const result = applyPatch(program, patches);
  return {
    program: result.program,
    changedIds: result.changedIds,
    diagnostics: result.diagnostics,
  };
}

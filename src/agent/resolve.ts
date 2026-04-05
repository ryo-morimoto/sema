/**
 * セレクタによるノード検索。
 * @internal
 */

import type { SemanticId, SemanticProgram } from "../types/semantic.js";
import type { Selector } from "../types/agent.js";

/**
 * セレクタに一致するノードの SemanticId を返す。
 */
export function resolve(program: SemanticProgram, selector?: Selector): SemanticId[] {
  const results: SemanticId[] = [];

  // Search definitions first, then all nodes
  const searchSet = program.definitions.size > 0
    ? program.definitions
    : program.nodes;

  for (const [id, node] of searchSet) {
    if (selector?.name !== undefined && node.name !== selector.name) continue;
    if (selector?.kind !== undefined && node.kind !== selector.kind) continue;
    if (selector?.glob !== undefined && node.name !== null) {
      if (!matchGlob(node.name, selector.glob)) continue;
    }
    results.push(id);
  }

  return results;
}

function matchGlob(name: string, pattern: string): boolean {
  const regex = new RegExp(
    "^" +
    pattern
      .replace(/[.+^${}()|[\]\\]/g, "\\$&")
      .replace(/\*/g, ".*")
      .replace(/\?/g, ".") +
    "$",
  );
  return regex.test(name);
}

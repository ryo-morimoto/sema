/**
 * 最小連結部分グラフの抽出。
 * @internal
 */

import type { SemanticId, SemanticNode, SemanticProgram } from "../types/semantic.js";
import type { SemanticSlice, SliceEdge } from "../types/agent.js";

/**
 * 指定ノード群から到達可能な最小連結部分グラフを抽出する。
 */
export function slice(
  program: SemanticProgram,
  ids: SemanticId[],
  depth = 1,
): SemanticSlice {
  const visited = new Map<SemanticId, SemanticNode>();
  const edges: SliceEdge[] = [];
  const queue: Array<{ id: SemanticId; currentDepth: number }> = [];

  // Initialize queue with root nodes
  for (const id of ids) {
    const node = program.nodes.get(id);
    if (node) {
      visited.set(id, node);
      queue.push({ id, currentDepth: 0 });
    }
  }

  // BFS
  while (queue.length > 0) {
    const { id, currentDepth } = queue.shift()!;
    if (currentDepth >= depth) continue;

    const node = program.nodes.get(id);
    if (!node) continue;

    // Follow parent edge
    if (node.parent) {
      const parentNode = program.nodes.get(node.parent);
      if (parentNode && !visited.has(node.parent)) {
        visited.set(node.parent, parentNode);
        queue.push({ id: node.parent, currentDepth: currentDepth + 1 });
      }
      edges.push({ source: id, target: node.parent, kind: "parent" });
    }

    // Follow children edges
    for (const child of node.children) {
      if (!visited.has(child.id)) {
        visited.set(child.id, child);
        queue.push({ id: child.id, currentDepth: currentDepth + 1 });
      }
      edges.push({ source: id, target: child.id, kind: "child" });
    }

    // Follow symbolRef edge
    if (node.symbolRef) {
      const symbol = program.symbols.get(node.symbolRef);
      if (symbol) {
        for (const declId of symbol.declarations) {
          const declNode = program.nodes.get(declId);
          if (declNode && !visited.has(declId)) {
            visited.set(declId, declNode);
            queue.push({ id: declId, currentDepth: currentDepth + 1 });
          }
          edges.push({ source: id, target: declId, kind: "symbolRef" });
        }
      }
    }

    // Follow typeRef edge
    if (node.typeRef) {
      // TypeRef doesn't point to a node directly, but could link to type alias nodes
      // For v1, we skip this traversal
    }
  }

  return {
    nodes: visited,
    edges,
    roots: ids,
  };
}

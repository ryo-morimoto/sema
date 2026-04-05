/**
 * ユーザー定義変換関数の適用とパッチ生成。
 * @internal
 */

import type { SemanticProgram } from "../types/semantic.js";
import type { Selector, TransformFn, SemanticPatch } from "../types/agent.js";
import { resolve } from "./resolve.js";

/**
 * セレクタに一致するノードにユーザー定義の変換関数を適用し、パッチを生成する。
 */
export function transform(
  program: SemanticProgram,
  selector: Selector,
  fn: TransformFn,
): SemanticPatch[] {
  const ids = resolve(program, selector);
  const patches: SemanticPatch[] = [];

  for (const id of ids) {
    const node = program.nodes.get(id);
    if (!node) continue;

    const patch = fn(node);
    if (patch) {
      patches.push(patch);
    }
  }

  return patches;
}

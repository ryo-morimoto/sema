/**
 * Agent サーフェスの組み立て。
 * @internal
 */

import type { SemanticId, SemanticProgram } from "../types/semantic.js";
import type {
  Agent,
  Selector,
  NodeView,
  SemanticSlice,
  ValidationReport,
  TransformFn,
  SemanticPatch,
  CommitResult,
} from "../types/agent.js";
import { resolve } from "./resolve.js";
import { inspect } from "./inspect.js";
import { slice } from "./slice.js";
import { validate } from "./validate.js";
import { transform } from "./transform.js";
import { commit } from "./commit.js";
import { materialize } from "./materialize.js";

/**
 * SemanticProgram に対する Agent を作成する。
 */
export function createAgentImpl(program: SemanticProgram): Agent {
  return {
    resolve: (selector?: Selector) => resolve(program, selector),
    inspect: (id: SemanticId) => inspect(program, id),
    slice: (ids: SemanticId[], depth?: number) => slice(program, ids, depth),
    validate: (selector?: Selector) => validate(program, selector),
    transform: (selector: Selector, fn: TransformFn) =>
      transform(program, selector, fn),
    commit: (...patches: SemanticPatch[]) => commit(program, patches),
    materialize: (...ids: SemanticId[]) => materialize(program, ids),
  };
}

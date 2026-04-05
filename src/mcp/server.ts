/**
 * @module mcp/server
 *
 * sema MCP サーバー — 2 ツールで完結する agent-native 設計。
 *
 * | ツール | 役割 |
 * |--------|------|
 * | `sema_analyze` | ファイルを分析し、関数ごとの purity/effects/capabilities/依存を返す |
 * | `sema_patch` | セマンティックパッチを適用し、変更後のコードを返す |
 *
 * `analyze` は 1 回の呼び出しで agent が必要な全情報を返す。
 * 探索型ツール（resolve/inspect/slice/validate）は内部で使用するが MCP には公開しない。
 */

import { readFileSync } from "node:fs";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { buildProgram, createAgent } from "../index.js";
import type { SemanticId } from "../types/semantic.js";
import type { SemanticProgram } from "../types/semantic.js";
import type { Agent } from "../types/agent.js";

function textResult(data: unknown) {
  return { content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }] };
}

function errorResult(message: string) {
  return { content: [{ type: "text" as const, text: message }], isError: true as const };
}

/** sema MCP サーバーを構築して返す。 */
export function createSemaServer(): McpServer {
  const server = new McpServer({ name: "sema", version: "0.1.0" });

  let currentProgram: SemanticProgram | null = null;
  let currentAgent: Agent | null = null;

  // ---------------------------------------------------------------------------
  // sema_analyze — 1 回で全情報を返す agent-native ツール
  // ---------------------------------------------------------------------------

  server.registerTool("sema_analyze", {
    description: `TypeScript ファイルをセマンティック分析し、agent が直接使える形式で結果を返す。

返される情報:
- functions: 各関数の名前、型シグネチャ、purity（pure/effectful）、effects、capabilities、依存先
- types: 型定義の一覧（名前と定義）
- imports: import されているモジュールと使用箇所
- capabilities: ファイル全体で必要なケイパビリティ

1 回の呼び出しで分析が完結する。追加のツール呼び出しは不要。`,
    inputSchema: {
      file: z.string().describe("分析対象の TypeScript ファイルパス"),
    },
    annotations: { readOnlyHint: true },
  }, async (args) => {
    const source = readFileSync(args.file, "utf-8");
    currentProgram = buildProgram(source);
    currentAgent = createAgent(currentProgram);

    return textResult(buildAnalysis(currentProgram, currentAgent));
  });

  // ---------------------------------------------------------------------------
  // sema_patch — セマンティックパッチを適用して変更後コードを返す
  // ---------------------------------------------------------------------------

  server.registerTool("sema_patch", {
    description: `セマンティックパッチ（rename 等）を適用し、変更後のコードを返す。

事前に sema_analyze を呼んでおく必要がある。
patches 配列で変更内容を指定する。各パッチには対象関数名と expectedHash（analyze 結果に含まれる）が必要。`,
    inputSchema: {
      patches: z.array(z.object({
        targetName: z.string().describe("変更対象の関数/クラス/型の名前"),
        expectedHash: z.string().describe("analyze 結果の syntaxHash（stale 検出用）"),
        newName: z.string().optional().describe("新しい名前（rename の場合）"),
      })).describe("適用するパッチの配列"),
    },
    annotations: { destructiveHint: true },
  }, async (args) => {
    if (!currentAgent || !currentProgram) {
      return errorResult("No program loaded. Call sema_analyze first.");
    }

    const patches = args.patches.map(p => {
      const ids = currentAgent!.resolve({ name: p.targetName });
      if (ids.length === 0) return null;
      return {
        targetId: ids[0],
        expectedHash: p.expectedHash,
        replacement: {
          ...(p.newName !== undefined ? { name: p.newName } : {}),
        },
      };
    }).filter((p): p is NonNullable<typeof p> => p !== null);

    if (patches.length === 0) {
      return errorResult("No matching nodes found for patch targets.");
    }

    const result = currentAgent.commit(...patches);

    currentProgram = result.program;
    currentAgent = createAgent(currentProgram);

    // Materialize changed nodes
    const changedCode = result.changedIds.map(id => ({
      id,
      name: currentProgram!.nodes.get(id)?.name,
      code: currentAgent!.materialize(id),
    }));

    return textResult({
      applied: result.changedIds.length,
      diagnostics: result.diagnostics,
      changedCode,
    });
  });

  return server;
}

// ---------------------------------------------------------------------------
// Analysis builder — agent-native 出力を構築
// ---------------------------------------------------------------------------

function buildAnalysis(program: SemanticProgram, agent: Agent) {
  const allIds = agent.resolve();

  // --- Functions ---
  const functions: Array<{
    name: string;
    kind: string;
    signature: string;
    purity: "pure" | "effectful";
    effects: string[];
    capabilities: string[];
    dependsOn: string[];
    syntaxHash: string;
  }> = [];

  // --- Types ---
  const types: Array<{ name: string; kind: string }> = [];

  // --- Imports ---
  const importModules: string[] = [];
  for (const [, node] of program.nodes) {
    if (node.kind === "ImportDeclaration" && node.name) {
      importModules.push(node.name);
    }
  }

  for (const id of allIds) {
    const view = agent.inspect(id);
    const node = view.node;

    // Type/Interface/Enum/TypeAlias → types bucket
    if (node.kind === "TypeAliasDeclaration" || node.kind === "InterfaceDeclaration" || node.kind === "EnumDeclaration") {
      types.push({ name: node.name ?? "anonymous", kind: node.kind });
      continue;
    }

    // Variable (non-function) → types bucket
    if (node.kind === "VariableDeclaration") {
      types.push({ name: node.name ?? "anonymous", kind: "const" });
      continue;
    }

    // Functions, ArrowFunctions, Classes → functions bucket
    const effects: string[] = [];
    const capabilities: string[] = [];

    for (const contract of view.contracts) {
      if (contract.kind === "effect") {
        if (contract.async) effects.push("async");
        effects.push(...contract.errorTypes);
      }
      if (contract.kind === "capability") {
        capabilities.push(...contract.grants);
      }
    }

    // Resolve type signature
    const typeRecord = node.typeRef ? program.types.get(node.typeRef) : null;
    const signature = typeRecord?.text ?? "unknown";

    // Compute dependsOn from children (for classes) and referencedModules
    const dependsOn: string[] = [];
    if (node.kind === "ClassDeclaration") {
      // Class methods may call other functions — scan children
      for (const child of node.children) {
        for (const mod of child.referencedModules) {
          if (!mod.startsWith("__global:")) continue;
          // Already handled by capabilities
        }
        // Look for function calls in children by checking their referenced modules
        // and cross-referencing with top-level function names
        // For now, scan the class's direct method calls by inspecting the source
      }
      // Use slice to find dependencies
      const sliceResult = agent.slice([id], 1);
      for (const [depId, depNode] of sliceResult.nodes) {
        if (depId !== id && depNode.name) {
          dependsOn.push(depNode.name);
        }
      }
    }

    const purity = effects.length === 0 && capabilities.length === 0 ? "pure" : "effectful";

    functions.push({
      name: node.name ?? "anonymous",
      kind: node.kind,
      signature,
      purity,
      effects: [...new Set(effects)],
      capabilities: [...new Set(capabilities)],
      dependsOn,
      syntaxHash: node.syntaxHash,
    });
  }

  // File-level capabilities
  const allCapabilities = [...new Set(functions.flatMap(f => f.capabilities))].sort();

  return {
    functions,
    types,
    imports: importModules,
    capabilities: allCapabilities,
  };
}

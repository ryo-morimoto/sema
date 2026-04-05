/**
 * セマンティックノードから有効な TypeScript ソースコードへの変換。
 * @internal
 */

import type { SemanticId, SemanticNode, SemanticProgram } from "../types/semantic.js";

/**
 * 指定ノードを有効な TypeScript ソースコードに変換する。
 */
export function materialize(program: SemanticProgram, ids: SemanticId[]): string {
  const parts: string[] = [];

  for (const id of ids) {
    const node = program.nodes.get(id);
    if (!node) {
      throw new Error(`Node not found: ${id}`);
    }

    parts.push(nodeToTypeScript(node));
  }

  return parts.join("\n\n");
}

function nodeToTypeScript(node: SemanticNode): string {
  switch (node.kind) {
    case "FunctionDeclaration":
      return materializeFunction(node);
    case "ArrowFunction":
      return materializeArrowFunction(node);
    case "ClassDeclaration":
      return materializeClass(node);
    case "VariableDeclaration":
      return materializeVariable(node);
    case "TypeAliasDeclaration":
      return materializeTypeAlias(node);
    case "InterfaceDeclaration":
      return materializeInterface(node);
    case "EnumDeclaration":
      return materializeEnum(node);
    case "ImportDeclaration":
      return `import "${node.name ?? "unknown"}";`;
    default:
      return `// Unknown node kind: ${node.kind}`;
  }
}

function materializeFunction(node: SemanticNode): string {
  const name = node.name ?? "anonymous";
  const children = node.children.map(nodeToTypeScript).join("\n  ");
  const body = children ? `{\n  ${children}\n}` : "{}";
  return `function ${name}() ${body}`;
}

function materializeArrowFunction(node: SemanticNode): string {
  const name = node.name ?? "anonymous";
  return `const ${name} = () => {}`;
}

function materializeClass(node: SemanticNode): string {
  const name = node.name ?? "Anonymous";
  const members = node.children.map((child) => {
    if (child.kind === "FunctionDeclaration") {
      return `  ${child.name ?? "method"}() {}`;
    }
    return `  ${child.name ?? "prop"}: unknown;`;
  });
  const body = members.length > 0 ? `{\n${members.join("\n")}\n}` : "{}";
  return `class ${name} ${body}`;
}

function materializeVariable(node: SemanticNode): string {
  const name = node.name ?? "x";
  return `const ${name}: unknown = undefined`;
}

function materializeTypeAlias(node: SemanticNode): string {
  const name = node.name ?? "T";
  return `type ${name} = unknown`;
}

function materializeInterface(node: SemanticNode): string {
  const name = node.name ?? "I";
  return `interface ${name} {}`;
}

function materializeEnum(node: SemanticNode): string {
  const name = node.name ?? "E";
  const members = node.children
    .map((child) => `  ${child.name ?? "member"}`)
    .join(",\n");
  const body = members ? `{\n${members}\n}` : "{}";
  return `enum ${name} ${body}`;
}

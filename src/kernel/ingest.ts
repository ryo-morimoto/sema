/**
 * TS Compiler API を使用してソースファイルからセマンティックノードを抽出する。
 * @internal
 */

import ts from "typescript";
import type {
  SymbolId,
  TypeId,
  NodeKind,
  SymbolRecord,
  TypeRecord,
  SourceSpan,
} from "../types/semantic.js";
import type { Diagnostic } from "../types/diagnostic.js";

/** ingest の出力。normalize の入力になる */
export interface RawIngestResult {
  readonly fileName: string;
  readonly nodes: readonly RawNode[];
  readonly imports: readonly RawImport[];
  readonly symbols: readonly SymbolRecord[];
  readonly types: readonly TypeRecord[];
  readonly diagnostics: readonly Diagnostic[];
}

/** ingest が抽出する生ノード（まだ正規化されていない） */
export interface RawNode {
  readonly kind: NodeKind;
  readonly name: string | null;
  readonly tsNode: ts.Node;
  readonly children: readonly RawNode[];
  readonly span: SourceSpan;
  readonly symbolRef: SymbolId | null;
  readonly typeRef: TypeId | null;
  readonly isExported: boolean;
  readonly isDefault: boolean;
  readonly exportNames: readonly string[];
  /** 関数/メソッドのパラメータ名（de Bruijn 用） */
  readonly paramNames: readonly string[];
  /** ジェネリック型パラメータ名 */
  readonly typeParamNames: readonly string[];
  /** 変数宣言の種類 (const/let/var) */
  readonly declarationKind: string | null;
  /** 関数本体内で参照されている import バインディング名 */
  readonly referencedImports: readonly string[];
}

export interface RawImport {
  readonly moduleSpecifier: string;
  readonly span: SourceSpan;
  readonly namedBindings: readonly string[];
  readonly defaultBinding: string | null;
  readonly namespaceBinding: string | null;
}

/**
 * TS ソースコード文字列を解析し、サポート対象ノードを抽出する。
 */
export function ingestSource(
  source: string,
  fileName = "input.ts",
): RawIngestResult {
  const sourceFile = ts.createSourceFile(
    fileName,
    source,
    ts.ScriptTarget.ES2022,
    true,
    ts.ScriptKind.TS,
  );

  const compilerHost = ts.createCompilerHost({});
  const originalGetSourceFile = compilerHost.getSourceFile;
  compilerHost.getSourceFile = (name, languageVersion) => {
    if (name === fileName) return sourceFile;
    return originalGetSourceFile.call(compilerHost, name, languageVersion);
  };

  const program = ts.createProgram([fileName], {
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    strict: true,
    noEmit: true,
  }, compilerHost);

  const checker = program.getTypeChecker();
  return ingestProgram(program, checker, sourceFile);
}

/**
 * ts.Program + ts.TypeChecker + ts.SourceFile からノードを抽出する。
 */
function ingestProgram(
  _program: ts.Program,
  checker: ts.TypeChecker,
  sourceFile: ts.SourceFile,
): RawIngestResult {
  const nodes: RawNode[] = [];
  const imports: RawImport[] = [];
  const symbols = new Map<string, SymbolRecord>();
  const types = new Map<string, TypeRecord>();
  const diagnostics: Diagnostic[] = [];

  // Collect all import binding names → module specifier mapping
  // Built in first pass, used by findReferencedImports
  const importBindingToModule = new Map<string, string>();

  function collectImportBindings(): void {
    ts.forEachChild(sourceFile, (node) => {
      if (!ts.isImportDeclaration(node)) return;
      const moduleSpec = ts.isStringLiteral(node.moduleSpecifier)
        ? node.moduleSpecifier.text : "";
      if (!node.importClause) return;
      if (node.importClause.name) {
        importBindingToModule.set(node.importClause.name.text, moduleSpec);
      }
      const bindings = node.importClause.namedBindings;
      if (bindings) {
        if (ts.isNamedImports(bindings)) {
          for (const el of bindings.elements) {
            importBindingToModule.set(el.name.text, moduleSpec);
          }
        } else if (ts.isNamespaceImport(bindings)) {
          importBindingToModule.set(bindings.name.text, moduleSpec);
        }
      }
    });
  }
  collectImportBindings();

  /**
   * 関数/メソッド本体を再帰的に走査し、import バインディングへの参照を検出する。
   * console, fetch, process などのグローバルアクセスも検出する。
   */
  function findReferencedImports(body: ts.Node): string[] {
    const found = new Set<string>();
    function walk(node: ts.Node): void {
      if (ts.isIdentifier(node)) {
        const name = node.text;
        if (importBindingToModule.has(name)) {
          found.add(importBindingToModule.get(name)!);
        }
        // Global access patterns
        if (name === "console") found.add("__global:console");
        if (name === "fetch") found.add("__global:fetch");
        if (name === "process") found.add("__global:process");
      }
      ts.forEachChild(node, walk);
    }
    walk(body);
    return [...found];
  }

  function makeSpan(node: ts.Node): SourceSpan {
    return {
      file: sourceFile.fileName,
      start: node.getStart(sourceFile),
      end: node.getEnd(),
    };
  }

  function resolveSymbol(node: ts.Node): { symbolId: SymbolId | null; typeId: TypeId | null } {
    try {
      // For named declarations, get symbol from the name node
      let nameNode: ts.Node = node;
      if (ts.isFunctionDeclaration(node) && node.name) nameNode = node.name;
      else if (ts.isClassDeclaration(node) && node.name) nameNode = node.name;
      else if (ts.isInterfaceDeclaration(node)) nameNode = node.name;
      else if (ts.isTypeAliasDeclaration(node)) nameNode = node.name;
      else if (ts.isEnumDeclaration(node)) nameNode = node.name;
      else if (ts.isVariableDeclaration(node)) nameNode = node.name;
      else if (ts.isMethodDeclaration(node) && node.name) nameNode = node.name;
      else if (ts.isPropertyDeclaration(node) && node.name) nameNode = node.name;

      const symbol = checker.getSymbolAtLocation(nameNode);
      if (!symbol) return { symbolId: null, typeId: null };

      const symbolId = String(symbol.name + "_" + (symbol as { id?: number }).id) as SymbolId;
      if (!symbols.has(symbolId)) {
        const type = checker.getTypeOfSymbolAtLocation(symbol, node);
        const typeText = checker.typeToString(type);
        const typeId = ("type_" + typeText.replace(/\s+/g, "_").slice(0, 50)) as TypeId;

        if (!types.has(typeId)) {
          const aliasSymbol = type.aliasSymbol;
          let expanded: string | null = null;
          if (aliasSymbol) {
            const baseType = checker.getDeclaredTypeOfSymbol(aliasSymbol);
            expanded = checker.typeToString(baseType);
          }
          types.set(typeId, { id: typeId, text: typeText, expanded });
        }

        symbols.set(symbolId, {
          id: symbolId,
          name: symbol.name,
          declarations: [],
          typeId,
        });
      }
      return { symbolId, typeId: symbols.get(symbolId)!.typeId };
    } catch {
      return { symbolId: null, typeId: null };
    }
  }

  function getExportInfo(node: ts.Node): { isExported: boolean; isDefault: boolean; exportNames: string[] } {
    const modifiers = ts.canHaveModifiers(node) ? ts.getModifiers(node) : undefined;
    const isExported = modifiers?.some(m => m.kind === ts.SyntaxKind.ExportKeyword) ?? false;
    const isDefault = modifiers?.some(m => m.kind === ts.SyntaxKind.DefaultKeyword) ?? false;
    const name = getNodeName(node);
    const exportNames: string[] = [];
    if (isExported && name) exportNames.push(name);
    if (isDefault) exportNames.push("default");
    return { isExported, isDefault, exportNames };
  }

  function getNodeName(node: ts.Node): string | null {
    if (ts.isFunctionDeclaration(node) || ts.isClassDeclaration(node) ||
        ts.isInterfaceDeclaration(node) || ts.isTypeAliasDeclaration(node) ||
        ts.isEnumDeclaration(node)) {
      return node.name?.text ?? null;
    }
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name)) {
      return node.name.text;
    }
    return null;
  }

  function getParams(node: ts.Node): { paramNames: string[]; typeParamNames: string[] } {
    const paramNames: string[] = [];
    const typeParamNames: string[] = [];

    if (ts.isFunctionDeclaration(node) || ts.isArrowFunction(node) ||
        ts.isMethodDeclaration(node) || ts.isFunctionExpression(node)) {
      for (const p of node.parameters) {
        if (ts.isIdentifier(p.name)) {
          paramNames.push(p.name.text);
        } else {
          paramNames.push("_destructured");
        }
      }
      if (node.typeParameters) {
        for (const tp of node.typeParameters) {
          typeParamNames.push(tp.name.text);
        }
      }
    }

    if (ts.isClassDeclaration(node) || ts.isInterfaceDeclaration(node) ||
        ts.isTypeAliasDeclaration(node)) {
      if (node.typeParameters) {
        for (const tp of node.typeParameters) {
          typeParamNames.push(tp.name.text);
        }
      }
    }

    return { paramNames, typeParamNames };
  }

  function extractChildren(node: ts.Node): RawNode[] {
    const children: RawNode[] = [];
    if (ts.isClassDeclaration(node)) {
      for (const member of node.members) {
        if (ts.isMethodDeclaration(member) || ts.isPropertyDeclaration(member) ||
            ts.isConstructorDeclaration(member)) {
          const name = member.name ? (ts.isIdentifier(member.name) ? member.name.text : member.name.getText(sourceFile)) : null;
          const { symbolId, typeId } = resolveSymbol(member);
          const { paramNames, typeParamNames } = getParams(member);
          children.push({
            kind: ts.isMethodDeclaration(member) ? "FunctionDeclaration" : "VariableDeclaration",
            name: ts.isConstructorDeclaration(member) ? "constructor" : name,
            tsNode: member,
            children: [],
            span: makeSpan(member),
            symbolRef: symbolId,
            typeRef: typeId,
            isExported: false,
            isDefault: false,
            exportNames: [],
            paramNames,
            typeParamNames,
            declarationKind: null,
            referencedImports: findReferencedImports(member),
          });
        }
      }
    }
    if (ts.isEnumDeclaration(node)) {
      for (const member of node.members) {
        const name = ts.isIdentifier(member.name) ? member.name.text : member.name.getText(sourceFile);
        children.push({
          kind: "VariableDeclaration",
          name,
          tsNode: member,
          children: [],
          span: makeSpan(member),
          symbolRef: null,
          typeRef: null,
          isExported: false,
          isDefault: false,
          exportNames: [],
          paramNames: [],
          typeParamNames: [],
          declarationKind: "const",
          referencedImports: [],
        });
      }
    }
    return children;
  }

  function processNode(node: ts.Node): void {
    // ImportDeclaration
    if (ts.isImportDeclaration(node)) {
      const moduleSpec = ts.isStringLiteral(node.moduleSpecifier)
        ? node.moduleSpecifier.text : "";
      const namedBindings: string[] = [];
      let defaultBinding: string | null = null;
      let namespaceBinding: string | null = null;

      if (node.importClause) {
        if (node.importClause.name) {
          defaultBinding = node.importClause.name.text;
        }
        const bindings = node.importClause.namedBindings;
        if (bindings) {
          if (ts.isNamedImports(bindings)) {
            for (const el of bindings.elements) {
              namedBindings.push(el.name.text);
            }
          } else if (ts.isNamespaceImport(bindings)) {
            namespaceBinding = bindings.name.text;
          }
        }
      }

      imports.push({
        moduleSpecifier: moduleSpec,
        span: makeSpan(node),
        namedBindings,
        defaultBinding,
        namespaceBinding,
      });
      return;
    }

    // FunctionDeclaration
    if (ts.isFunctionDeclaration(node)) {
      const { symbolId, typeId } = resolveSymbol(node);
      const exportInfo = getExportInfo(node);
      const { paramNames, typeParamNames } = getParams(node);
      nodes.push({
        kind: "FunctionDeclaration",
        name: node.name?.text ?? null,
        tsNode: node,
        children: [],
        span: makeSpan(node),
        symbolRef: symbolId,
        typeRef: typeId,
        ...exportInfo,
        paramNames,
        typeParamNames,
        declarationKind: null,
        referencedImports: findReferencedImports(node.body ?? node),
      });
      return;
    }

    // ClassDeclaration
    if (ts.isClassDeclaration(node)) {
      const { symbolId, typeId } = resolveSymbol(node);
      const exportInfo = getExportInfo(node);
      const { paramNames, typeParamNames } = getParams(node);
      nodes.push({
        kind: "ClassDeclaration",
        name: node.name?.text ?? null,
        tsNode: node,
        children: extractChildren(node),
        span: makeSpan(node),
        symbolRef: symbolId,
        typeRef: typeId,
        ...exportInfo,
        paramNames,
        typeParamNames,
        declarationKind: null,
        referencedImports: [],
      });
      return;
    }

    // InterfaceDeclaration
    if (ts.isInterfaceDeclaration(node)) {
      const { symbolId, typeId } = resolveSymbol(node);
      const exportInfo = getExportInfo(node);
      const { paramNames, typeParamNames } = getParams(node);
      nodes.push({
        kind: "InterfaceDeclaration",
        name: node.name.text,
        tsNode: node,
        children: [],
        span: makeSpan(node),
        symbolRef: symbolId,
        typeRef: typeId,
        ...exportInfo,
        paramNames,
        typeParamNames,
        declarationKind: null,
        referencedImports: [],
      });
      return;
    }

    // TypeAliasDeclaration
    if (ts.isTypeAliasDeclaration(node)) {
      const { symbolId, typeId } = resolveSymbol(node);
      const exportInfo = getExportInfo(node);
      const { paramNames, typeParamNames } = getParams(node);
      nodes.push({
        kind: "TypeAliasDeclaration",
        name: node.name.text,
        tsNode: node,
        children: [],
        span: makeSpan(node),
        symbolRef: symbolId,
        typeRef: typeId,
        ...exportInfo,
        paramNames,
        typeParamNames,
        declarationKind: null,
        referencedImports: [],
      });
      return;
    }

    // EnumDeclaration
    if (ts.isEnumDeclaration(node)) {
      const { symbolId, typeId } = resolveSymbol(node);
      const exportInfo = getExportInfo(node);
      nodes.push({
        kind: "EnumDeclaration",
        name: node.name.text,
        tsNode: node,
        children: extractChildren(node),
        span: makeSpan(node),
        symbolRef: symbolId,
        typeRef: typeId,
        ...exportInfo,
        paramNames: [],
        typeParamNames: [],
        declarationKind: null,
        referencedImports: [],
      });
      return;
    }

    // VariableStatement → VariableDeclaration(s)
    if (ts.isVariableStatement(node)) {
      const exportInfo = getExportInfo(node);
      const declKind = node.declarationList.flags & ts.NodeFlags.Const
        ? "const"
        : node.declarationList.flags & ts.NodeFlags.Let
          ? "let"
          : "var";

      for (const decl of node.declarationList.declarations) {
        const name = ts.isIdentifier(decl.name) ? decl.name.text : null;
        const { symbolId, typeId } = resolveSymbol(decl);

        // Check if initializer is an arrow function (top-level const-assigned)
        if (decl.initializer && ts.isArrowFunction(decl.initializer)) {
          const arrow = decl.initializer;
          const { paramNames, typeParamNames } = getParams(arrow);
          nodes.push({
            kind: "ArrowFunction",
            name,
            tsNode: arrow,
            children: [],
            span: makeSpan(node),
            symbolRef: symbolId,
            typeRef: typeId,
            ...exportInfo,
            paramNames,
            typeParamNames,
            declarationKind: declKind,
            referencedImports: findReferencedImports(arrow.body),
          });
        } else {
          nodes.push({
            kind: "VariableDeclaration",
            name,
            tsNode: decl,
            children: [],
            span: makeSpan(node),
            symbolRef: symbolId,
            typeRef: typeId,
            ...exportInfo,
            paramNames: [],
            typeParamNames: [],
            declarationKind: declKind,
            referencedImports: [],
          });
        }
      }
      return;
    }

    // Unsupported top-level syntax → diagnostic
    if (node.kind !== ts.SyntaxKind.EndOfFileToken &&
        node.kind !== ts.SyntaxKind.ExpressionStatement) {
      diagnostics.push({
        severity: "info",
        message: `Unsupported syntax: ${ts.SyntaxKind[node.kind]}`,
        nodeId: null,
        span: makeSpan(node),
        phase: "ingest",
      });
    }
  }

  ts.forEachChild(sourceFile, processNode);

  return {
    fileName: sourceFile.fileName,
    nodes,
    imports,
    symbols: [...symbols.values()],
    types: [...types.values()],
    diagnostics,
  };
}

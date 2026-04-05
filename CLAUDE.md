# sema

TypeScript semantic substrate — normalized tree, content-addressed identity, contract overlays, agent surface.

## 4 Pillars

1. **Semantic tree is truth** — normalized, format/rename-invariant representation
2. **Tree-native identity** — content-addressed hashing (syntaxHash for structure, semanticHash for meaning)
3. **Contracts are overlays** — effect/capability/world contracts reference nodes, never embed in them
4. **Semantic-first agent surface** — operations target semantic selections, not text ranges

## Architecture

```
src/
├── types/        # All type definitions (public interface)
├── kernel/       # Core: ingest → normalize → identity → program
├── contracts/    # Overlay: effect, capability, world inference
├── agent/        # Agent surface: resolve, inspect, slice, validate, transform, commit, materialize
├── mcp/          # MCP server: 7 tools exposing Agent operations over stdio
└── index.ts      # Public API entry point
```

## Public API (deep module)

3 entry points only:

- `buildProgram(source, options?)` — TS source → SemanticProgram (ingest + normalize + hash + contracts)
- `declareWorldContract(program, subjects, spec)` — attach user-declared world contract
- `createAgent(program)` — get Agent interface for query/validate/transform/commit/materialize

## Conventions

- **Immutable tree**: `commit()` returns new SemanticProgram, old snapshots remain valid
- **Branded IDs**: `SemanticId`, `SymbolId`, `TypeId`, `ContractId` — never mix
- **Hashable separation**: SemanticNode is NOT hashed directly; a separate Hashable type is the canonical hash input
- **Diagnostic accumulation**: skip unsupported syntax, collect diagnostics, never crash on valid TS
- **Tests**: `src/__tests__/` mirroring `src/`, not co-located

## MCP Server

7 tools over stdio (`pnpm mcp` or `sema-mcp`):

| Tool | Agent method | Annotations |
|------|-------------|-------------|
| `sema_build` | `buildProgram()` | — |
| `sema_resolve` | `agent.resolve()` | readOnly |
| `sema_inspect` | `agent.inspect()` | readOnly |
| `sema_slice` | `agent.slice()` | readOnly |
| `sema_validate` | `agent.validate()` | readOnly |
| `sema_commit` | `agent.commit()` | destructive |
| `sema_materialize` | `agent.materialize()` | readOnly |

`transform` is library-only (takes a function). Agents construct patches via inspect → commit.

## Commands

- `pnpm check` — type check
- `pnpm test` — run tests
- `pnpm build` — compile to dist/
- `pnpm mcp` — start MCP server (stdio)

## Key Decisions

- Parser: TS Compiler API (full type info from day 1)
- De Bruijn indexing for rename-invariant hashing
- Separate Hashable representation (Unison lesson)
- Immutable tree with structural sharing via object spread
- Hash version prefix for future migration

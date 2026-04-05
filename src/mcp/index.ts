#!/usr/bin/env node
/**
 * sema MCP サーバーのエントリポイント。
 *
 * stdio トランスポートで MCP プロトコルを話す。
 *
 * ## 起動方法
 *
 * ```bash
 * # 開発時
 * pnpm mcp
 *
 * # ビルド後
 * sema-mcp
 * ```
 *
 * ## Claude Code への接続
 *
 * ```jsonc
 * // ~/.claude/settings.json
 * {
 *   "mcpServers": {
 *     "sema": {
 *       "command": "npx",
 *       "args": ["tsx", "/path/to/sema/src/mcp/index.ts"]
 *     }
 *   }
 * }
 * ```
 */

import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createSemaServer } from "./server.js";

const server = createSemaServer();
const transport = new StdioServerTransport();
await server.connect(transport);

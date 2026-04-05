#!/usr/bin/env bash
set -euo pipefail

DIR="$(cd "$(dirname "$0")" && pwd)"
PROMPT=$(cat "$DIR/prompt.txt")
OUT_DIR="$DIR/results"
mkdir -p "$OUT_DIR"

echo "═══ Running WITHOUT MCP ═══"
echo ""
claude -p "$PROMPT" \
  --model "sonnet" \
  --bare \
  2>"$OUT_DIR/no-mcp-stderr.txt" \
  | tee "$OUT_DIR/no-mcp.txt"

echo ""
echo ""
echo "═══ Running WITH sema MCP ═══"
echo ""

# MCP-enabled prompt: instruct agent to use sema tools
MCP_PROMPT="あなたには sema MCP サーバーが接続されています。まず sema_build でファイルを読み込み、sema_resolve / sema_inspect を使って正確な情報を取得してから回答してください。

$PROMPT"

claude -p "$MCP_PROMPT" \
  --model "sonnet" \
  --bare \
  --mcp-config "$DIR/mcp-config.json" \
  2>"$OUT_DIR/with-mcp-stderr.txt" \
  | tee "$OUT_DIR/with-mcp.txt"

echo ""
echo ""
echo "═══ Results saved ═══"
echo "  Without MCP: $OUT_DIR/no-mcp.txt"
echo "  With MCP:    $OUT_DIR/with-mcp.txt"

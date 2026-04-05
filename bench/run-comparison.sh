#!/usr/bin/env bash
set -euo pipefail

DIR="$(cd "$(dirname "$0")" && pwd)"
OUT="$DIR/results/comparison"
mkdir -p "$OUT"

PROMPT_TEMPLATE='以下のファイルを分析して、次の4つの質問に回答してください。回答は JSON のみ返してください（説明不要）。

ファイル: __FILE__

1. pure_functions: 副作用を一切持たない純粋関数の名前をリストせよ（配列）
2. effectful_functions: 副作用を持つ関数の名前と副作用の種類（オブジェクト配列: name, effects[]）
3. capabilities: このファイルが必要とする外部ケイパビリティ（配列）
4. dependency_graph: 最も大きいクラスが直接依存している関数・型の名前（配列）

```json
{"pure_functions":[],"effectful_functions":[],"capabilities":[],"dependency_graph":[]}
```'

for SIZE in small big elephant; do
  FILE="$DIR/targets/${SIZE}.ts"
  LINES=$(wc -l < "$FILE")
  echo ""
  echo "════════════════════════════════════════"
  echo "  ${SIZE} (${LINES} lines)"
  echo "════════════════════════════════════════"

  PROMPT="${PROMPT_TEMPLATE//__FILE__/$FILE}"

  # --- no sema ---
  echo "  → no-sema..."
  claude -p "$PROMPT" --model "sonnet" --output-format json 2>/dev/null > "$OUT/${SIZE}-no-sema.json"
  NO_COST=$(jq '.total_cost_usd' "$OUT/${SIZE}-no-sema.json")
  NO_DUR=$(jq '.duration_ms' "$OUT/${SIZE}-no-sema.json")
  NO_TURNS=$(jq '.num_turns' "$OUT/${SIZE}-no-sema.json")
  NO_IN=$(jq '.usage.input_tokens + .usage.cache_creation_input_tokens + .usage.cache_read_input_tokens' "$OUT/${SIZE}-no-sema.json")
  NO_OUT=$(jq '.usage.output_tokens' "$OUT/${SIZE}-no-sema.json")
  echo "    cost=\$${NO_COST} dur=${NO_DUR}ms turns=${NO_TURNS} in=${NO_IN} out=${NO_OUT}"

  # --- with sema ---
  echo "  → sema analyze..."
  SEMA_START=$(($(date +%s%N)/1000000))
  pnpm exec tsx "$DIR/sema-cli.ts" "$FILE" > "$OUT/${SIZE}-sema-data.json" 2>/dev/null
  SEMA_END=$(($(date +%s%N)/1000000))
  SEMA_CLI_MS=$((SEMA_END - SEMA_START))

  SEMA_DATA=$(cat "$OUT/${SIZE}-sema-data.json")
  SEMA_CHARS=${#SEMA_DATA}

  SEMA_PROMPT="以下は sema セマンティック分析エンジンの出力です。このデータをそのまま使って回答してください。回答は JSON のみ（説明不要）。

## sema 分析結果
\`\`\`json
${SEMA_DATA}
\`\`\`

${PROMPT}"

  claude -p "$SEMA_PROMPT" --model "sonnet" --output-format json 2>/dev/null > "$OUT/${SIZE}-with-sema.json"
  S_COST=$(jq '.total_cost_usd' "$OUT/${SIZE}-with-sema.json")
  S_DUR=$(jq '.duration_ms' "$OUT/${SIZE}-with-sema.json")
  S_TURNS=$(jq '.num_turns' "$OUT/${SIZE}-with-sema.json")
  S_IN=$(jq '.usage.input_tokens + .usage.cache_creation_input_tokens + .usage.cache_read_input_tokens' "$OUT/${SIZE}-with-sema.json")
  S_OUT=$(jq '.usage.output_tokens' "$OUT/${SIZE}-with-sema.json")
  echo "    cost=\$${S_COST} dur=${S_DUR}ms(+cli:${SEMA_CLI_MS}ms) turns=${S_TURNS} in=${S_IN} out=${S_OUT} sema_chars=${SEMA_CHARS}"

  echo ""
done

echo "════════════════════════════════════════"
echo "  Done. Results in $OUT/"
echo "════════════════════════════════════════"

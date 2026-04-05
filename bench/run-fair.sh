#!/usr/bin/env bash
set -euo pipefail

# Fair benchmark: both conditions inject data into prompt (1 turn, no tool calls)
# Condition A: raw source code in prompt
# Condition B: sema analysis JSON in prompt

DIR="$(cd "$(dirname "$0")" && pwd)"
OUT="$DIR/results/fair"
mkdir -p "$OUT"

RUNS=10

QUESTION='次の4つの質問に回答してください。回答は JSON のみ返してください（説明不要）。

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
  SOURCE=$(cat "$FILE")
  echo "════ ${SIZE} (${LINES}L) ════"

  # Pre-generate sema data (not counted in timing)
  pnpm exec tsx "$DIR/sema-cli.ts" "$FILE" > "$OUT/${SIZE}-sema-data.json" 2>/dev/null
  SEMA_DATA=$(cat "$OUT/${SIZE}-sema-data.json")

  # Condition A: raw source in prompt
  RAW_PROMPT="以下の TypeScript ソースコードを分析してください。

\`\`\`typescript
${SOURCE}
\`\`\`

${QUESTION}"

  # Condition B: sema analysis in prompt
  SEMA_PROMPT="以下は sema セマンティック分析エンジンの出力です。このデータをそのまま使って回答してください。

\`\`\`json
${SEMA_DATA}
\`\`\`

${QUESTION}"

  for i in $(seq 1 $RUNS); do
    echo -n "  run ${i}/${RUNS}: "

    # A: raw source (system prompt prohibits tool use to ensure 1-turn)
    claude -p "$RAW_PROMPT" --model "sonnet" --output-format json \
      --system-prompt "ツールを一切使うな。与えられたデータのみから回答せよ。JSON のみ出力し、説明・補足・マークダウンのコードフェンスは一切付けるな。" \
      2>/dev/null \
      | tr -d '\000-\037' > "$OUT/${SIZE}-raw-${i}.json"
    R_COST=$(jq '.total_cost_usd // 0' "$OUT/${SIZE}-raw-${i}.json")
    R_DUR=$(jq '.duration_ms // 0' "$OUT/${SIZE}-raw-${i}.json")
    R_OUT=$(jq '.usage.output_tokens // 0' "$OUT/${SIZE}-raw-${i}.json")
    R_IN=$(jq '(.usage.input_tokens // 0) + (.usage.cache_creation_input_tokens // 0) + (.usage.cache_read_input_tokens // 0)' "$OUT/${SIZE}-raw-${i}.json")
    R_TURNS=$(jq '.num_turns // 0' "$OUT/${SIZE}-raw-${i}.json")
    echo -n "raw(\$${R_COST},${R_DUR}ms,in:${R_IN},out:${R_OUT},T:${R_TURNS}) "

    # B: sema (same system prompt for fairness)
    claude -p "$SEMA_PROMPT" --model "sonnet" --output-format json \
      --system-prompt "ツールを一切使うな。与えられたデータのみから回答せよ。JSON のみ出力し、説明・補足・マークダウンのコードフェンスは一切付けるな。" \
      2>/dev/null \
      | tr -d '\000-\037' > "$OUT/${SIZE}-sema-${i}.json"
    S_COST=$(jq '.total_cost_usd // 0' "$OUT/${SIZE}-sema-${i}.json")
    S_DUR=$(jq '.duration_ms // 0' "$OUT/${SIZE}-sema-${i}.json")
    S_OUT=$(jq '.usage.output_tokens // 0' "$OUT/${SIZE}-sema-${i}.json")
    S_IN=$(jq '(.usage.input_tokens // 0) + (.usage.cache_creation_input_tokens // 0) + (.usage.cache_read_input_tokens // 0)' "$OUT/${SIZE}-sema-${i}.json")
    S_TURNS=$(jq '.num_turns // 0' "$OUT/${SIZE}-sema-${i}.json")
    echo "sema(\$${S_COST},${S_DUR}ms,in:${S_IN},out:${S_OUT},T:${S_TURNS})"
  done
  echo ""
done

echo "═══ Done. Results in $OUT/ ═══"

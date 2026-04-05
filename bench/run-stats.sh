#!/usr/bin/env bash
set -euo pipefail

DIR="$(cd "$(dirname "$0")" && pwd)"
OUT="$DIR/results/stats"
mkdir -p "$OUT"

RUNS=10

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
  echo "════ ${SIZE} (${LINES}L) ════"

  # Pre-generate sema data once (deterministic)
  pnpm exec tsx "$DIR/sema-cli.ts" "$FILE" > "$OUT/${SIZE}-sema-data.json" 2>/dev/null
  SEMA_DATA=$(cat "$OUT/${SIZE}-sema-data.json")

  PROMPT="${PROMPT_TEMPLATE//__FILE__/$FILE}"
  SEMA_PROMPT="以下は sema セマンティック分析エンジンの出力です。このデータをそのまま使って回答してください。回答は JSON のみ（説明不要）。

## sema 分析結果
\`\`\`json
${SEMA_DATA}
\`\`\`

${PROMPT}"

  for i in $(seq 1 $RUNS); do
    echo -n "  run ${i}/${RUNS}: "

    # no-sema
    claude -p "$PROMPT" --model "sonnet" --output-format json 2>/dev/null \
      | tr -d '\000-\037' > "$OUT/${SIZE}-no-sema-${i}.json"
    NO_COST=$(jq '.total_cost_usd // 0' "$OUT/${SIZE}-no-sema-${i}.json")
    NO_DUR=$(jq '.duration_ms // 0' "$OUT/${SIZE}-no-sema-${i}.json")
    NO_OUT=$(jq '.usage.output_tokens // 0' "$OUT/${SIZE}-no-sema-${i}.json")
    echo -n "no-sema(\$${NO_COST},${NO_DUR}ms,${NO_OUT}tok) "

    # with-sema
    claude -p "$SEMA_PROMPT" --model "sonnet" --output-format json 2>/dev/null \
      | tr -d '\000-\037' > "$OUT/${SIZE}-with-sema-${i}.json"
    S_COST=$(jq '.total_cost_usd // 0' "$OUT/${SIZE}-with-sema-${i}.json")
    S_DUR=$(jq '.duration_ms // 0' "$OUT/${SIZE}-with-sema-${i}.json")
    S_OUT=$(jq '.usage.output_tokens // 0' "$OUT/${SIZE}-with-sema-${i}.json")
    echo "sema(\$${S_COST},${S_DUR}ms,${S_OUT}tok)"
  done
  echo ""
done

echo "═══ All runs complete. Results in $OUT/ ═══"

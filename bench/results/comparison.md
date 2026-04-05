# ベンチマーク比較: sema なし vs sema あり

## 条件
- モデル: sonnet (claude-sonnet-4-6)
- 題材: bench/target.ts (120行, fs/https import, pure関数3, effectful関数4, クラス1)
- 同一プロンプト (4問: pure_functions, effectful_functions, capabilities, dependency_graph)

## トークン消費

| 指標 | sema なし | sema あり | 差分 |
|------|----------|----------|------|
| input_tokens | 4 | 3 | -1 |
| output_tokens | 571 | 891 | +320 (+56%) |
| cache_creation | 29,342 | 29,077 | -265 |
| cache_read | 27,966 | 0 | -27,966 |
| **total_cost_usd** | **$0.1270** | **$0.1224** | **-$0.0046 (-3.6%)** |
| duration_ms | 10,179 | 13,757 | +3,578 (+35%) |
| num_turns | 2 | 1 | -1 |

### 分析
- sema ありは **1 ターンで完結** (sema なしは 2 ターン = ファイル読み + 回答)
- コスト差はほぼ同等 (-3.6%)。sema の分析 JSON (2,714 chars) がプロンプトに追加されるが、ファイル読み込みのツール呼び出しが省略されるため相殺
- sema ありは出力が +56% 長い (補足説明が多い)
- sema ありは +35% 遅い (sema CLI 実行 ~3s + 長い出力生成)

## 回答の正確性

### 正解ライン (ソースコードから手動判定)

```
pure_functions: [filterTasks, sortByPriority, formatTaskSummary]
effectful_functions:
  loadTasksFromDisk  → async, fs:read
  saveTasksToDisk    → async, fs:write
  fetchRemoteTasks   → async, net:https
  logTaskEvent       → io:console
capabilities: [fs:read, fs:write, net:https, io:console]
dependency_graph (TaskManager): [Task, TaskId, TaskFilter, TaskEvent, loadTasksFromDisk, saveTasksToDisk, logTaskEvent, filterTasks, sortByPriority]
```

### Q1: pure_functions

| | sema なし | sema あり |
|---|---|---|
| 回答 | filterTasks, sortByPriority, formatTaskSummary | 同一 |
| 正答率 | 3/3 ✓ | 3/3 ✓ |

### Q2: effectful_functions

| 関数 | 正解 | sema なし | sema あり |
|------|------|----------|----------|
| loadTasksFromDisk | async, fs:read | fs:read ✓ | async, fs:read, fs:write ▲ |
| saveTasksToDisk | async, fs:write | fs:write ✓ | async, fs:read, fs:write ▲ |
| fetchRemoteTasks | async, net:https | net:https ✓ | async, net:https ✓ |
| logTaskEvent | io:console | io:console, io:clock ▲ | io:console ✓ |
| TaskManager | (質問は standalone 関数のみ) | 不含 ✓ | 含む (推移的effects付き) △ |

- sema なしは `io:clock` (new Date()) を独自検出 — LLM の推論力
- sema ありは `fs:read/fs:write` を区別できていない — sema の粒度不足
- sema ありは `async` を明示的に検出 — sema の effect 推論
- sema ありは TaskManager を effectful_functions に含め推移的 effects を計算 — sema の dependsOn を活用

### Q3: capabilities

| | sema なし | sema あり |
|---|---|---|
| 回答 | fs:read, fs:write, net:https, io:console, io:clock | fs:read, fs:write, io:console, net:https |
| io:clock (Date) | ✓ 検出 | ✗ 未検出 |

### Q4: dependency_graph (TaskManager)

| | sema なし | sema あり |
|---|---|---|
| 関数依存 | 5/5 ✓ | 5/5 ✓ |
| 型依存 | 4/4 ✓ | 4/4 ✓ |
| 合計 | 9/9 ✓ | 9/9 ✓ |

## 正確性スコア

| 項目 | sema なし | sema あり | 評価 |
|------|----------|----------|------|
| Q1 pure_functions | 3/3 | 3/3 | 同等 |
| Q2 effectful 関数検出 | 4/4 | 4/4 (+TaskManager) | sema あり ▲ |
| Q2 effects 精度 | io:clock 検出 | async 検出, fs:r/w 未分離 | 一長一短 |
| Q3 capabilities | 5/5 (io:clock含む) | 4/4 | sema なし ▲ |
| Q4 dependency_graph | 9/9 | 9/9 | 同等 |

## 実装の妥当性

### sema が LLM に対して優位な点

1. **purity の明示化**: `purity: "pure"` を直接提供。LLM は推論不要でそのまま使った
2. **dependency_graph の計算済み提供**: LLM がソース全体を走査する必要がない
3. **構造化データ**: JSON 形式で hallucination リスクが低い
4. **ターン数削減**: ファイル読み込みのツール呼び出しが不要 (2 turns → 1 turn)
5. **TaskManager の推移的 effects**: dependsOn を使って自力で推移的 effectfulness を推論した

### sema が LLM に対して劣る点

1. **io:clock (Date) 未検出**: グローバルオブジェクトの副作用パターンが不足
2. **fs:read/fs:write 未分離**: readFileSync → read only、writeFileSync → write only が区別できていない
3. **async の二重報告**: effect に "async" + capability に "fs:read" があり、LLM がまとめて "effects" に入れた
4. **レイテンシ**: sema CLI 実行 (~3s) + 長い出力生成 = +35% 遅い

### 改善すべき点

| 優先度 | 改善 | 理由 |
|--------|------|------|
| 高 | fs:read/write を API 呼び出し粒度で分離 | readFileSync → read, writeFileSync → write |
| 高 | グローバル副作用パターン拡充 (Date, Math.random, setTimeout) | LLM が検出できて sema が検出できないのは信頼性の問題 |
| 中 | effects と capabilities の統合表現 | "async" と "fs:read" が別カテゴリにあると LLM が混乱する |
| 低 | レイテンシ最適化 | 3s は許容範囲だが MCP server ならプロセス常駐で改善可能 |

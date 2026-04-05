import { readFileSync, readdirSync } from "node:fs";

const dir = "bench/results/stats";
const sizes = ["small", "big", "elephant"] as const;
const lines: Record<string, number> = { small: 19, big: 368, elephant: 812 };

interface RunData {
  cost: number;
  dur: number;
  outTok: number;
  turns: number;
}

function parseRun(file: string): RunData | null {
  try {
    const raw = readFileSync(file, "utf-8").replace(/[\x00-\x1f]/g, "");
    const j = JSON.parse(raw);
    return {
      cost: j.total_cost_usd ?? 0,
      dur: j.duration_ms ?? 0,
      outTok: j.usage?.output_tokens ?? 0,
      turns: j.num_turns ?? 0,
    };
  } catch {
    return null;
  }
}

function stats(values: number[]) {
  const n = values.length;
  const sorted = [...values].sort((a, b) => a - b);
  const mean = values.reduce((a, b) => a + b, 0) / n;
  const variance = values.reduce((sum, v) => sum + (v - mean) ** 2, 0) / (n - 1);
  const sd = Math.sqrt(variance);
  const median = n % 2 === 0 ? (sorted[n / 2 - 1] + sorted[n / 2]) / 2 : sorted[Math.floor(n / 2)];
  const p25 = sorted[Math.floor(n * 0.25)];
  const p75 = sorted[Math.floor(n * 0.75)];
  const min = sorted[0];
  const max = sorted[n - 1];
  // 95% CI for mean (t-distribution approx for n=10: t=2.262)
  const t = 2.262;
  const ci95 = t * sd / Math.sqrt(n);
  return { n, mean, sd, median, p25, p75, min, max, ci95 };
}

function fmt(v: number, decimals = 2) { return v.toFixed(decimals); }

console.log("# sema ベンチマーク統計レポート (N=10 per condition)\n");

for (const size of sizes) {
  const noSema: RunData[] = [];
  const withSema: RunData[] = [];

  for (let i = 1; i <= 10; i++) {
    const ns = parseRun(`${dir}/${size}-no-sema-${i}.json`);
    const ws = parseRun(`${dir}/${size}-with-sema-${i}.json`);
    if (ns) noSema.push(ns);
    if (ws) withSema.push(ws);
  }

  console.log(`## ${size} (${lines[size]} lines) — N=${noSema.length} runs\n`);

  // Cost
  const nsCost = stats(noSema.map(r => r.cost));
  const wsCost = stats(withSema.map(r => r.cost));
  const costDiff = ((wsCost.mean - nsCost.mean) / nsCost.mean * 100);

  // Duration
  const nsDur = stats(noSema.map(r => r.dur));
  const wsDur = stats(withSema.map(r => r.dur));
  const durDiff = ((wsDur.mean - nsDur.mean) / nsDur.mean * 100);

  // Output tokens
  const nsOut = stats(noSema.map(r => r.outTok));
  const wsOut = stats(withSema.map(r => r.outTok));
  const outDiff = ((wsOut.mean - nsOut.mean) / nsOut.mean * 100);

  // Turns
  const nsTurns = stats(noSema.map(r => r.turns));
  const wsTurns = stats(withSema.map(r => r.turns));

  console.log("| 指標 | no-sema (mean ± 95%CI) | sema (mean ± 95%CI) | 差分 | p-value目安 |");
  console.log("|------|----------------------|-------------------|------|------------|");

  // Welch's t-test approximation
  function welchT(a: ReturnType<typeof stats>, b: ReturnType<typeof stats>): string {
    const t = (a.mean - b.mean) / Math.sqrt(a.sd**2/a.n + b.sd**2/b.n);
    const df = (a.sd**2/a.n + b.sd**2/b.n)**2 / ((a.sd**2/a.n)**2/(a.n-1) + (b.sd**2/b.n)**2/(b.n-1));
    // Rough p-value estimation
    const absT = Math.abs(t);
    if (absT > 3.5) return "p<0.01 **";
    if (absT > 2.5) return "p<0.05 *";
    if (absT > 1.5) return "p<0.15";
    return "n.s.";
  }

  console.log(`| コスト ($) | ${fmt(nsCost.mean, 4)} ± ${fmt(nsCost.ci95, 4)} | ${fmt(wsCost.mean, 4)} ± ${fmt(wsCost.ci95, 4)} | ${fmt(costDiff, 1)}% | ${welchT(nsCost, wsCost)} |`);
  console.log(`| 時間 (ms) | ${fmt(nsDur.mean, 0)} ± ${fmt(nsDur.ci95, 0)} | ${fmt(wsDur.mean, 0)} ± ${fmt(wsDur.ci95, 0)} | ${fmt(durDiff, 1)}% | ${welchT(nsDur, wsDur)} |`);
  console.log(`| 出力tok | ${fmt(nsOut.mean, 0)} ± ${fmt(nsOut.ci95, 0)} | ${fmt(wsOut.mean, 0)} ± ${fmt(wsOut.ci95, 0)} | ${fmt(outDiff, 1)}% | ${welchT(nsOut, wsOut)} |`);
  console.log(`| ターン | ${fmt(nsTurns.mean, 1)} ± ${fmt(nsTurns.ci95, 1)} | ${fmt(wsTurns.mean, 1)} ± ${fmt(wsTurns.ci95, 1)} | | |`);

  console.log("");

  // Detailed distributions
  console.log("<details><summary>分布詳細</summary>\n");
  console.log("| | no-sema | sema |");
  console.log("|---|---------|------|");
  console.log(`| コスト min | $${fmt(nsCost.min, 4)} | $${fmt(wsCost.min, 4)} |`);
  console.log(`| コスト p25 | $${fmt(nsCost.p25, 4)} | $${fmt(wsCost.p25, 4)} |`);
  console.log(`| コスト median | $${fmt(nsCost.median, 4)} | $${fmt(wsCost.median, 4)} |`);
  console.log(`| コスト p75 | $${fmt(nsCost.p75, 4)} | $${fmt(wsCost.p75, 4)} |`);
  console.log(`| コスト max | $${fmt(nsCost.max, 4)} | $${fmt(wsCost.max, 4)} |`);
  console.log(`| コスト SD | $${fmt(nsCost.sd, 4)} | $${fmt(wsCost.sd, 4)} |`);
  console.log(`| 時間 min | ${fmt(nsDur.min, 0)}ms | ${fmt(wsDur.min, 0)}ms |`);
  console.log(`| 時間 median | ${fmt(nsDur.median, 0)}ms | ${fmt(wsDur.median, 0)}ms |`);
  console.log(`| 時間 max | ${fmt(nsDur.max, 0)}ms | ${fmt(wsDur.max, 0)}ms |`);
  console.log(`| 時間 SD | ${fmt(nsDur.sd, 0)}ms | ${fmt(wsDur.sd, 0)}ms |`);
  console.log(`| 出力tok min | ${fmt(nsOut.min, 0)} | ${fmt(wsOut.min, 0)} |`);
  console.log(`| 出力tok median | ${fmt(nsOut.median, 0)} | ${fmt(wsOut.median, 0)} |`);
  console.log(`| 出力tok max | ${fmt(nsOut.max, 0)} | ${fmt(wsOut.max, 0)} |`);
  console.log(`| 出力tok SD | ${fmt(nsOut.sd, 0)} | ${fmt(wsOut.sd, 0)} |`);
  console.log("\n</details>\n");
}

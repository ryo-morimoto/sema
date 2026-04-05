import { readFileSync } from "node:fs";

const dir = "bench/results/fair";
const sizes = ["small", "big", "elephant"] as const;
const lineCount: Record<string, number> = { small: 19, big: 368, elephant: 812 };

interface Run {
  cost: number;
  dur: number;
  outTok: number;
  inTok: number;
  turns: number;
}

function parseRun(file: string): Run | null {
  try {
    const raw = readFileSync(file, "utf-8").replace(/[\x00-\x1f]/g, "");
    const j = JSON.parse(raw);
    return {
      cost: j.total_cost_usd ?? 0,
      dur: j.duration_ms ?? 0,
      outTok: j.usage?.output_tokens ?? 0,
      inTok:
        (j.usage?.input_tokens ?? 0) +
        (j.usage?.cache_creation_input_tokens ?? 0) +
        (j.usage?.cache_read_input_tokens ?? 0),
      turns: j.num_turns ?? 0,
    };
  } catch {
    return null;
  }
}

function stats(vals: number[]) {
  const n = vals.length;
  if (n === 0) return null;
  const sorted = [...vals].sort((a, b) => a - b);
  const mean = vals.reduce((a, b) => a + b, 0) / n;
  const sd = Math.sqrt(vals.reduce((s, v) => s + (v - mean) ** 2, 0) / (n - 1));
  const median = n % 2 ? sorted[Math.floor(n / 2)] : (sorted[n / 2 - 1] + sorted[n / 2]) / 2;
  const ci95 = 2.262 * sd / Math.sqrt(n); // t for df=9
  return { n, mean, sd, median, min: sorted[0], max: sorted[n - 1], ci95 };
}

function welchP(a: NonNullable<ReturnType<typeof stats>>, b: NonNullable<ReturnType<typeof stats>>): string {
  const t = Math.abs(a.mean - b.mean) / Math.sqrt(a.sd ** 2 / a.n + b.sd ** 2 / b.n);
  if (t > 4.0) return "p<0.001 ***";
  if (t > 3.0) return "p<0.01 **";
  if (t > 2.2) return "p<0.05 *";
  if (t > 1.7) return "p<0.10";
  return "n.s.";
}

function f(v: number, d = 2) { return v.toFixed(d); }
function pct(a: number, b: number) { return ((b - a) / a * 100).toFixed(1); }

console.log("# sema vs raw LLM — Fair Benchmark (N=10, 1 turn, no tools)\n");
console.log("Both conditions: data injected into prompt, system prompt prohibits tool use.\n");
console.log("- **raw**: TypeScript source code in prompt\n- **sema**: sema analysis JSON in prompt\n");

for (const size of sizes) {
  const raw: Run[] = [];
  const sema: Run[] = [];
  for (let i = 1; i <= 10; i++) {
    const r = parseRun(`${dir}/${size}-raw-${i}.json`);
    const s = parseRun(`${dir}/${size}-sema-${i}.json`);
    if (r) raw.push(r);
    if (s) sema.push(s);
  }

  console.log(`## ${size} (${lineCount[size]} lines) — N=${raw.length}\n`);

  if (raw.length === 0 || sema.length === 0) {
    console.log("(no data)\n");
    continue;
  }

  const rc = stats(raw.map(r => r.cost))!;
  const sc = stats(sema.map(r => r.cost))!;
  const rd = stats(raw.map(r => r.dur))!;
  const sd = stats(sema.map(r => r.dur))!;
  const ro = stats(raw.map(r => r.outTok))!;
  const so = stats(sema.map(r => r.outTok))!;
  const ri = stats(raw.map(r => r.inTok))!;
  const si = stats(sema.map(r => r.inTok))!;

  console.log("| 指標 | raw (mean ± 95%CI) | sema (mean ± 95%CI) | 差分 | Welch t |");
  console.log("|------|-------------------|--------------------|----|---------|");
  console.log(`| コスト ($) | ${f(rc.mean, 4)} ± ${f(rc.ci95, 4)} | ${f(sc.mean, 4)} ± ${f(sc.ci95, 4)} | ${pct(rc.mean, sc.mean)}% | ${welchP(rc, sc)} |`);
  console.log(`| 時間 (ms) | ${f(rd.mean, 0)} ± ${f(rd.ci95, 0)} | ${f(sd.mean, 0)} ± ${f(sd.ci95, 0)} | ${pct(rd.mean, sd.mean)}% | ${welchP(rd, sd)} |`);
  console.log(`| 入力 tok | ${f(ri.mean, 0)} ± ${f(ri.ci95, 0)} | ${f(si.mean, 0)} ± ${f(si.ci95, 0)} | ${pct(ri.mean, si.mean)}% | ${welchP(ri, si)} |`);
  console.log(`| 出力 tok | ${f(ro.mean, 0)} ± ${f(ro.ci95, 0)} | ${f(so.mean, 0)} ± ${f(so.ci95, 0)} | ${pct(ro.mean, so.mean)}% | ${welchP(ro, so)} |`);

  console.log("");
  console.log("| | raw SD | sema SD | raw range | sema range |");
  console.log("|---|--------|---------|-----------|------------|");
  console.log(`| コスト | ${f(rc.sd, 4)} | ${f(sc.sd, 4)} | ${f(rc.min, 4)}–${f(rc.max, 4)} | ${f(sc.min, 4)}–${f(sc.max, 4)} |`);
  console.log(`| 時間 | ${f(rd.sd, 0)} | ${f(sd.sd, 0)} | ${f(rd.min, 0)}–${f(rd.max, 0)} | ${f(sd.min, 0)}–${f(sd.max, 0)} |`);
  console.log(`| 出力tok | ${f(ro.sd, 0)} | ${f(so.sd, 0)} | ${f(ro.min, 0)}–${f(ro.max, 0)} | ${f(so.min, 0)}–${f(so.max, 0)} |`);

  // Raw data table
  console.log("\n<details><summary>生データ</summary>\n");
  console.log("| run | raw cost | raw dur | raw in | raw out | sema cost | sema dur | sema in | sema out |");
  console.log("|-----|---------|---------|--------|---------|----------|---------|---------|----------|");
  for (let i = 0; i < Math.max(raw.length, sema.length); i++) {
    const r = raw[i];
    const s = sema[i];
    console.log(`| ${i + 1} | ${r ? '$' + f(r.cost, 4) : '-'} | ${r ? f(r.dur, 0) + 'ms' : '-'} | ${r ? f(r.inTok, 0) : '-'} | ${r ? f(r.outTok, 0) : '-'} | ${s ? '$' + f(s.cost, 4) : '-'} | ${s ? f(s.dur, 0) + 'ms' : '-'} | ${s ? f(s.inTok, 0) : '-'} | ${s ? f(s.outTok, 0) : '-'} |`);
  }
  console.log("\n</details>\n");
}

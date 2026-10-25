import { writeFileSync, mkdirSync } from 'node:fs';
import { buildSeries } from './core/indicators';
import { runBacktest } from './core/backtest';
import { trendAt } from './core/trend';
import { DEFAULT_SETTINGS } from './core/types';
import type { Candle, Settings, Trade } from './core/types';

/**
 * Quét tham số trên BTC 4h với tách giai đoạn:
 *   HUẤN LUYỆN (chọn tham số): lệnh vào trước SPLIT;  KIỂM TRA (không dùng để chọn): lệnh vào từ SPLIT.
 * Xếp hạng chỉ dựa trên huấn luyện, rồi xem kiểm tra có giữ được không.
 */
const SYMBOL = process.env.SYMBOL || 'BTCUSDT';
const INTERVAL = process.env.INTERVAL || '4h';
const SPLIT = Date.parse(process.env.SPLIT || '2023-01-01');
const MIN_TRAIN = Number(process.env.MIN_TRAIN || 40);
const MS: Record<string, number> = { '15m': 900_000, '30m': 1_800_000, '1h': 3_600_000, '2h': 7_200_000, '4h': 14_400_000, '1d': 86_400_000 };
const HOSTS = ['https://data-api.binance.vision', 'https://api.binance.com'];

async function klines(interval: string): Promise<Candle[]> {
  const out: Candle[] = [];
  let from = Date.UTC(2017, 7, 17);
  for (;;) {
    let rows: unknown[][] | null = null;
    for (const h of HOSTS) {
      try { const r = await fetch(`${h}/api/v3/klines?symbol=${SYMBOL}&interval=${interval}&startTime=${from}&limit=1000`); if (r.ok) { rows = (await r.json()) as unknown[][]; break; } } catch { /* host khác */ }
    }
    if (!rows) throw new Error('Không tải được nến');
    if (!rows.length) break;
    for (const k of rows) out.push({ t: Number(k[0]), o: +(k[1] as string), h: +(k[2] as string), l: +(k[3] as string), c: +(k[4] as string), v: +(k[5] as string) });
    from = Number(rows[rows.length - 1][0]) + 1;
    if (rows.length < 1000) break;
  }
  return out.filter((c) => c.t + MS[interval] <= Date.now());
}

const tf = await klines(INTERVAL), d1 = await klines('1d');
console.log(`${SYMBOL} ${INTERVAL}: ${tf.length} nến; tách tại ${new Date(SPLIT).toISOString().slice(0, 10)}`);

const SMA: [number, number][] = [[64, 128], [50, 200], [32, 64], [20, 50], [100, 200]];
const GRID = {
  lookbackWith: [20, 40, 60],
  lookbackCounter: [40, 80, 120],
  minGap: [6, 9, 12],
  pivot: [[3, 2], [2, 2], [5, 3]] as [number, number][],
  rsi: [[30, 70], [25, 75], [35, 65]] as [number, number][],
  rr: [1, 1.5, 2],
};

interface Row { sma: string; lbW: number; lbC: number; gap: number; piv: string; rsi: string; rr: number;
  trN: number; trW: number; trR: number; trExp: number; teN: number; teW: number; teR: number; teExp: number; }
const rows: Row[] = [];
const agg = (l: Trade[], rr: number) => {
  const w = l.filter((t) => t.result === 'win').length, lo = l.filter((t) => t.result === 'loss').length;
  const n = w + lo, r = w * rr - lo;
  return { n, w, r, exp: n ? r / n : 0 };
};

// Toàn bộ tổ hợp, xáo trộn theo hạt giống cố định rồi lấy MAX cấu hình (nhanh hơn, vẫn phủ đều)
type Combo = { f: number; sl: number; lbW: number; lbC: number; gap: number; pl: number; pr: number; lo: number; hi: number; rr: number };
const combos: Combo[] = [];
for (const [f, sl] of SMA) for (const lbW of GRID.lookbackWith) for (const lbC of GRID.lookbackCounter) for (const gap of GRID.minGap)
  for (const [pl, pr] of GRID.pivot) for (const [lo, hi] of GRID.rsi) for (const rr of GRID.rr) combos.push({ f, sl, lbW, lbC, gap, pl, pr, lo, hi, rr });
let seed = 12345;
const rnd = () => { seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
for (let i = combos.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [combos[i], combos[j]] = [combos[j], combos[i]]; }
const MAX = Number(process.env.MAX || 1200);
const picked = combos.slice(0, MAX).sort((x, y) => x.f - y.f || x.sl - y.sl);
console.log(`Tổ hợp: ${combos.length}, chạy ${picked.length}`);

const prep = new Map<string, { tfS: ReturnType<typeof buildSeries>; d1S: ReturnType<typeof buildSeries>; pre: { d1Trends: ReturnType<typeof trendAt>[]; tfTrends: ReturnType<typeof trendAt>[] } }>();
let done = 0;
for (const c of picked) {
  const key = `${c.f}/${c.sl}`;
  let p = prep.get(key);
  if (!p) {
    const tfS = buildSeries(tf, c.f, c.sl), d1S = buildSeries(d1, c.f, c.sl);
    p = { tfS, d1S, pre: { d1Trends: d1S.close.map((_, k) => trendAt(d1S, k)), tfTrends: tfS.close.map((_, k) => trendAt(tfS, k)) } };
    prep.clear(); prep.set(key, p);
  }
  const cfg: Settings = { ...DEFAULT_SETTINGS, lookbackWith: c.lbW, lookbackCounter: c.lbC, minGap: c.gap, pivotLeft: c.pl, pivotRight: c.pr, rsiLow: c.lo, rsiHigh: c.hi, rr: c.rr };
  const res = runBacktest(p.tfS, p.d1S, MS[INTERVAL], cfg, Math.max(130, c.sl + 5), p.pre);
  const tr = agg(res.trades.filter((t) => t.entryTime < SPLIT), c.rr), te = agg(res.trades.filter((t) => t.entryTime >= SPLIT), c.rr);
  rows.push({ sma: key, lbW: c.lbW, lbC: c.lbC, gap: c.gap, piv: `${c.pl}-${c.pr}`, rsi: `${c.lo}/${c.hi}`, rr: c.rr,
    trN: tr.n, trW: tr.w, trR: +tr.r.toFixed(1), trExp: +tr.exp.toFixed(3), teN: te.n, teW: te.w, teR: +te.r.toFixed(1), teExp: +te.exp.toFixed(3) });
  if (++done % 100 === 0) console.log(`đã chạy ${done}/${picked.length}`);
}

mkdirSync('results/zzz', { recursive: true });
const header = Object.keys(rows[0]).join(',');
writeFileSync('results/zzz/sweep_all.csv', header + '\n' + rows.map((r) => Object.values(r).join(',')).join('\n'));

const med = (a: number[]) => { const s = [...a].sort((x, y) => x - y); return s.length ? s[Math.floor(s.length / 2)] : 0; };
const ok = rows.filter((r) => r.trN >= MIN_TRAIN && r.teN >= 15);
const top = [...ok].sort((a, b) => b.trExp - a.trExp).slice(0, 15);
const fmt = (r: Row) => `| ${r.sma} | ${r.lbW}/${r.lbC} | ${r.gap} | ${r.piv} | ${r.rsi} | ${r.rr} | ${r.trN} | ${(r.trW / (r.trN || 1) * 100).toFixed(0)}% | ${r.trR} | ${r.trExp} | ${r.teN} | ${(r.teW / (r.teN || 1) * 100).toFixed(0)}% | ${r.teR} | ${r.teExp} |`;
const th = '| SMA | lookback 1/2 | minGap | pivot L-R | RSI | R:R | HL lệnh | HL thắng | HL tổng R | HL R/lệnh | KT lệnh | KT thắng | KT tổng R | KT R/lệnh |\n|' + '---|'.repeat(14);

const posTrain = ok.filter((r) => r.trExp > 0);
const posBoth = posTrain.filter((r) => r.teExp > 0);
const bySma: string[] = [];
for (const [f, sl] of SMA) {
  const g = ok.filter((r) => r.sma === `${f}/${sl}`);
  bySma.push(`| ${f}/${sl} | ${g.length} | ${med(g.map((r) => r.trExp)).toFixed(3)} | ${med(g.map((r) => r.teExp)).toFixed(3)} | ${(g.filter((r) => r.teExp > 0).length / (g.length || 1) * 100).toFixed(0)}% |`);
}
const dim = (name: string, key: (r: Row) => string | number, vals: (string | number)[]) =>
  `\n**${name}** (trung vị R/lệnh huấn luyện → kiểm tra):\n\n| Giá trị | Số cấu hình | HL | KT |\n|---|---|---|---|\n` +
  vals.map((v) => { const g = ok.filter((r) => key(r) === v); return `| ${v} | ${g.length} | ${med(g.map((r) => r.trExp)).toFixed(3)} | ${med(g.map((r) => r.teExp)).toFixed(3)} |`; }).join('\n') + '\n';

const md = `# Quét tham số zzz · ${SYMBOL} ${INTERVAL}

- Huấn luyện (HL): lệnh vào trước ${new Date(SPLIT).toISOString().slice(0, 10)}. Kiểm tra (KT): từ ngày đó, KHÔNG dùng để chọn.
- Đã chạy ${rows.length} cấu hình; ${ok.length} cấu hình đủ lệnh (HL ≥ ${MIN_TRAIN}, KT ≥ 15).
- Chưa tính phí/trượt giá. R/lệnh > 0 mới có lãi (trước phí).

## Mức nhiễu (quan trọng)
- Cấu hình có R/lệnh > 0 ở HL: ${posTrain.length}/${ok.length}
- Trong số đó, vẫn > 0 ở KT: ${posBoth.length}/${posTrain.length} (${(posBoth.length / (posTrain.length || 1) * 100).toFixed(0)}%)
- Trung vị R/lệnh toàn bộ: HL ${med(ok.map((r) => r.trExp)).toFixed(3)}, KT ${med(ok.map((r) => r.teExp)).toFixed(3)}
- Nếu tỷ lệ "vẫn dương ở KT" gần 50% thì phần thắng ở HL chủ yếu là may mắn.

## Top 15 theo HL, xem KT
${th}
${top.map(fmt).join('\n')}

## Theo cặp SMA (xu hướng)
| SMA | Số cấu hình | HL trung vị | KT trung vị | % KT dương |
|---|---|---|---|---|
${bySma.join('\n')}
${dim('lookback kênh 1', (r) => r.lbW, GRID.lookbackWith)}${dim('lookback kênh 2', (r) => r.lbC, GRID.lookbackCounter)}${dim('minGap', (r) => r.gap, GRID.minGap)}${dim('pivot', (r) => r.piv, GRID.pivot.map((p) => p.join('-')))}${dim('RSI', (r) => r.rsi, GRID.rsi.map((p) => p.join('/')))}${dim('R:R', (r) => r.rr, GRID.rr)}`;
writeFileSync('results/zzz/sweep.md', md);
console.log(md);

import { writeFileSync, mkdirSync } from 'node:fs';
import { buildSeries } from './core/indicators';
import { trendAt } from './core/trend';
import type { Candle } from './core/types';

/**
 * Xuất đặc điểm TẠI MỌI NẾN (không chỉ nến zzz báo tín hiệu) cùng kết quả nếu vào lệnh theo hướng D1:
 * SL = SL_ATR × ATR, TP = RR × SL; nến chạm cả SL và TP = thua. Dùng để khai phá quy luật vào lệnh.
 */
const SYMBOL = process.env.SYMBOL || 'BTCUSDT';
const INTERVAL = process.env.INTERVAL || '4h';
const SL_ATR = Number(process.env.SL_ATR || 1.5);
const RR = Number(process.env.RR || 1.5);
const MS: Record<string, number> = { '1h': 3_600_000, '2h': 7_200_000, '4h': 14_400_000, '1d': 86_400_000 };
const DAY = 86_400_000;
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
const tfS = buildSeries(tf), d1S = buildSeries(d1);
const tfT = tfS.close.map((_, k) => trendAt(tfS, k)), d1T = d1S.close.map((_, k) => trendAt(d1S, k));
const n = tf.length;
const atr: number[] = new Array(n).fill(NaN);
{ let sum = 0; for (let i = 1; i < n; i++) {
  const tr = Math.max(tf[i].h - tf[i].l, Math.abs(tf[i].h - tf[i - 1].c), Math.abs(tf[i].l - tf[i - 1].c));
  if (i <= 14) { sum += tr; if (i === 14) atr[i] = sum / 14; } else atr[i] = (atr[i - 1] * 13 + tr) / 14;
} }
const avgVol = (i: number) => { let s = 0, c = 0; for (let j = Math.max(0, i - 20); j < i; j++) { s += tf[j].v; c++; } return c ? s / c : 1; };

const head = ['i', 't', 'dir', 'out_idx', 'win', 'risk_pct',
  'rsi', 'dist_sma64', 'dist_sma128', 'dist_ema20', 'sma_gap', 'bb_pos', 'bb_width', 'atr_pct', 'vol_rel',
  'pullback20', 'ret6', 'ret20', 'candle_dir', 'close_pos', 'rsi_d1', 'd1_age', 'tf_agree', 'range_atr'];
const lines = [head.join(',')];
let dp = -1;
for (let i = 130; i < n - 1; i++) {
  const close = tf[i].t + MS[INTERVAL];
  while (dp + 1 < d1.length && d1[dp + 1].t + DAY <= close) dp++;
  if (dp < 0 || isNaN(atr[i])) continue;
  const trend = d1T[dp].trend;
  if (trend === 'SIDEWAYS') continue;
  const s = trend === 'UP' ? 1 : -1, c = tf[i], a = atr[i];
  const risk = SL_ATR * a, entry = c.c, sl = entry - s * risk, tp = entry + s * RR * risk;
  let out = -1, win = 0;
  for (let j = i + 1; j < n; j++) {
    const hitSL = s === 1 ? tf[j].l <= sl : tf[j].h >= sl, hitTP = s === 1 ? tf[j].h >= tp : tf[j].l <= tp;
    if (hitSL || hitTP) { out = j; win = hitSL ? 0 : 1; break; }
  }
  if (out < 0) continue;
  const m64 = tfS.sma64[i] as number, m128 = tfS.sma128[i] as number, e20 = tfS.ema20[i] as number, up = tfS.bbUpper[i] as number, lo = tfS.bbLower[i] as number, r = tfS.rsi[i] as number;
  if ([m64, m128, e20, up, lo, r].some((x) => x === null || x === undefined)) continue;
  let hh = -Infinity, ll = Infinity; for (let j = i - 19; j <= i; j++) { hh = Math.max(hh, tf[j].h); ll = Math.min(ll, tf[j].l); }
  let age = 0; for (let k = dp; k >= 0 && d1T[k].trend === trend; k--) age++;
  const agree = tfT[i].trend === trend ? 1 : tfT[i].trend === 'SIDEWAYS' ? 0 : -1;
  const rng = c.h - c.l || 1e-9;
  const row = [i, c.t, s, out, win, (risk / entry * 100).toFixed(4),
    (s === 1 ? r : 100 - r).toFixed(2), ((c.c - m64) / a * s).toFixed(3), ((c.c - m128) / a * s).toFixed(3), ((c.c - e20) / a * s).toFixed(3),
    ((m64 / m128 - 1) * 100 * s).toFixed(3), (s === 1 ? (c.c - lo) / (up - lo) : (up - c.c) / (up - lo)).toFixed(3), ((up - lo) / c.c * 100).toFixed(3), (a / c.c * 100).toFixed(3),
    (c.v / avgVol(i)).toFixed(3), (s === 1 ? (hh - c.c) / a : (c.c - ll) / a).toFixed(3), ((c.c - tf[i - 6].c) / a * s).toFixed(3), ((c.c - tf[i - 20].c) / a * s).toFixed(3),
    ((c.c - c.o) / a * s).toFixed(3), (s === 1 ? (c.c - c.l) / rng : (c.h - c.c) / rng).toFixed(3),
    (s === 1 ? d1S.rsi[dp] ?? NaN : 100 - (d1S.rsi[dp] ?? NaN)).toFixed(2), age, agree, (rng / a).toFixed(3)];
  lines.push(row.join(','));
}
mkdirSync('results/zzz', { recursive: true });
writeFileSync(`results/zzz/mine_${SYMBOL}.csv`, lines.join('\n'));
console.log(`${SYMBOL}: ${lines.length - 1} nến có kết quả`);

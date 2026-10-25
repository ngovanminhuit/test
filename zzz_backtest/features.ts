import { writeFileSync, mkdirSync } from 'node:fs';
import { buildSeries } from './core/indicators';
import { runBacktest } from './core/backtest';
import { trendAt } from './core/trend';
import { DEFAULT_SETTINGS } from './core/types';
import type { Candle } from './core/types';

/** Xuất đặc điểm của từng lệnh (thắng/thua) tại thời điểm vào lệnh, để phân tích quy luật. */
const SYMBOL = process.env.SYMBOL || 'BTCUSDT';
const INTERVAL = process.env.INTERVAL || '4h';
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
const cfg = { ...DEFAULT_SETTINGS, rr: RR };
const res = runBacktest(tfS, d1S, MS[INTERVAL], cfg, 130, { d1Trends: d1T, tfTrends: tfT });

// ATR(14) đơn giản
const atr: (number | null)[] = tf.map(() => null);
{ let sum = 0; for (let i = 1; i < tf.length; i++) {
  const tr = Math.max(tf[i].h - tf[i].l, Math.abs(tf[i].h - tf[i - 1].c), Math.abs(tf[i].l - tf[i - 1].c));
  if (i <= 14) { sum += tr; if (i === 14) atr[i] = sum / 14; } else atr[i] = ((atr[i - 1] as number) * 13 + tr) / 14;
} }
const avgVol = (i: number, n = 20) => { let s = 0, c = 0; for (let j = Math.max(0, i - n); j < i; j++) { s += tf[j].v; c++; } return c ? s / c : 0; };

const head = ['id', 'channel', 'direction', 'entry_time', 'year', 'hour', 'dow', 'result', 'r', 'mfe_r', 'mae_r', 'bars_held',
  'risk_pct', 'risk_atr', 'rsi', 'rsi_d1', 'dist_sma128_pct', 'sma_gap_pct', 'bb_width_pct', 'bb_pos', 'ema20_dist_pct', 'atr_pct',
  'vol_rel', 'body_atr', 'range_atr', 'tf_trend', 'd1_age', 'ret_20_pct', 'ret_d1_10_pct'];
const lines = [head.join(',')];
let id = 0;
for (const t of res.trades) {
  if (t.result === 'open') continue;
  const i = t.entryIdx, c = tf[i];
  const buy = t.direction === 'BUY', sgn = buy ? 1 : -1;
  const risk = Math.abs(t.entry - t.stopLoss);
  let dp = -1; for (let k = 0; k < d1.length; k++) { if (d1[k].t + DAY <= c.t + MS[INTERVAL]) dp = k; else break; }
  let age = 0; if (dp >= 0) { const tr = d1T[dp].trend; for (let k = dp; k >= 0 && d1T[k].trend === tr; k--) age++; }
  // MFE/MAE theo R (cùng chiều lệnh) đến khi đóng lệnh
  let mfe = 0, mae = 0;
  for (let j = i + 1; j <= (t.exitIdx ?? i + 1); j++) {
    const fav = buy ? tf[j].h - t.entry : t.entry - tf[j].l, adv = buy ? t.entry - tf[j].l : tf[j].h - t.entry;
    mfe = Math.max(mfe, fav / risk); mae = Math.max(mae, adv / risk);
  }
  const a = atr[i] ?? NaN, m64 = tfS.sma64[i], m128 = tfS.sma128[i], up = tfS.bbUpper[i], lo = tfS.bbLower[i], e20 = tfS.ema20[i];
  const row = [
    id++, t.channel, t.direction, new Date(c.t).toISOString(), new Date(c.t).getUTCFullYear(), new Date(c.t).getUTCHours(), new Date(c.t).getUTCDay(),
    t.result, t.result === 'win' ? RR : -1, mfe.toFixed(3), mae.toFixed(3), (t.exitIdx ?? i) - i,
    (risk / t.entry * 100).toFixed(3), (risk / a).toFixed(3), (tfS.rsi[i] ?? NaN).toFixed(2), dp >= 0 ? (d1S.rsi[dp] ?? NaN).toFixed(2) : 'NaN',
    m128 ? ((c.c / m128 - 1) * 100 * sgn).toFixed(3) : 'NaN', m64 && m128 ? ((m64 / m128 - 1) * 100 * sgn).toFixed(3) : 'NaN',
    up && lo ? ((up - lo) / c.c * 100).toFixed(3) : 'NaN', up && lo ? ((c.c - lo) / (up - lo)).toFixed(3) : 'NaN',
    e20 ? ((c.c / e20 - 1) * 100 * sgn).toFixed(3) : 'NaN', (a / c.c * 100).toFixed(3),
    (c.v / (avgVol(i) || 1)).toFixed(3), (Math.abs(c.c - c.o) / a).toFixed(3), ((c.h - c.l) / a).toFixed(3),
    tfT[i].trend, age,
    i >= 20 ? ((c.c / tf[i - 20].c - 1) * 100 * sgn).toFixed(3) : 'NaN', dp >= 10 ? ((d1[dp].c / d1[dp - 10].c - 1) * 100 * sgn).toFixed(3) : 'NaN',
  ];
  lines.push(row.join(','));
}
mkdirSync('results/zzz', { recursive: true });
const TAG = SYMBOL === 'BTCUSDT' ? '' : `_${SYMBOL}`;
writeFileSync(`results/zzz/trades_features${TAG}.csv`, lines.join('\n'));
console.log(`Đã xuất ${lines.length - 1} lệnh`);

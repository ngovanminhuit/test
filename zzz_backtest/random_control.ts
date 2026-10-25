import { writeFileSync, mkdirSync } from 'node:fs';
import { buildSeries } from './core/indicators';
import { runBacktest } from './core/backtest';
import { trendAt } from './core/trend';
import { DEFAULT_SETTINGS } from './core/types';
import type { Candle } from './core/types';

/**
 * Đối chứng vào lệnh ngẫu nhiên.
 * Với mỗi R:R: lấy N lệnh của zzz (kênh, hướng, độ rủi ro SL tính theo ATR). Mô phỏng M lần, mỗi lần chọn N nến NGẪU NHIÊN
 * (D1 có xu hướng), hướng = hướng D1, SL = rủi ro lấy ngẫu nhiên từ phân bố rủi ro (theo ATR) của chính các lệnh zzz,
 * TP = R:R × rủi ro, cùng luật khớp lệnh (chạm cả SL và TP trong một nến = thua).
 * So kết quả của zzz với phân bố ngẫu nhiên: p = tỷ lệ mô phỏng ngẫu nhiên đạt hoặc vượt zzz.
 */
const SYMBOL = process.env.SYMBOL || 'BTCUSDT';
const INTERVAL = process.env.INTERVAL || '4h';
const SIMS = Number(process.env.SIMS || 10000);
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

let seed = 987654321;
const rnd = () => { seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };

const tf = await klines(INTERVAL), d1 = await klines('1d');
const tfS = buildSeries(tf), d1S = buildSeries(d1);
const tfT = tfS.close.map((_, k) => trendAt(tfS, k)), d1T = d1S.close.map((_, k) => trendAt(d1S, k));
const n = tf.length;

const atr: number[] = new Array(n).fill(NaN);
{ let sum = 0; for (let i = 1; i < n; i++) {
  const tr = Math.max(tf[i].h - tf[i].l, Math.abs(tf[i].h - tf[i - 1].c), Math.abs(tf[i].l - tf[i - 1].c));
  if (i <= 14) { sum += tr; if (i === 14) atr[i] = sum / 14; } else atr[i] = (atr[i - 1] * 13 + tr) / 14;
} }

// Hướng D1 tại mỗi nến khung giao dịch (cùng quy tắc nến ngày đã đóng như backtest)
const dir: (0 | 1 | -1)[] = new Array(n).fill(0);
{ let dp = -1; for (let i = 0; i < n; i++) {
  const close = tf[i].t + MS[INTERVAL];
  while (dp + 1 < d1.length && d1[dp + 1].t + DAY <= close) dp++;
  if (dp >= 0) dir[i] = d1T[dp].trend === 'UP' ? 1 : d1T[dp].trend === 'DOWN' ? -1 : 0;
} }
const WARM = 130;
const eligible: number[] = [];
for (let i = WARM; i < n - 1; i++) if (dir[i] !== 0 && !isNaN(atr[i])) eligible.push(i);

function sim(i: number, d: 1 | -1, riskAbs: number, rr: number): 'win' | 'loss' | 'open' {
  const entry = tf[i].c, sl = entry - d * riskAbs, tp = entry + d * rr * riskAbs;
  for (let j = i + 1; j < n; j++) {
    const hitSL = d === 1 ? tf[j].l <= sl : tf[j].h >= sl;
    const hitTP = d === 1 ? tf[j].h >= tp : tf[j].l <= tp;
    if (hitSL || hitTP) return hitSL ? 'loss' : 'win';
  }
  return 'open';
}

const q = (a: number[], p: number) => { const s = [...a].sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.floor(p * s.length))]; };
let md = `# Đối chứng vào lệnh ngẫu nhiên · ${SYMBOL} ${INTERVAL}\n\n- ${n} nến, ${eligible.length} nến đủ điều kiện (D1 có xu hướng) để vào ngẫu nhiên. Mỗi R:R chạy ${SIMS} lần mô phỏng.\n- Ngẫu nhiên: nến vào ngẫu nhiên, hướng theo D1, rủi ro SL (theo ATR) lấy ngẫu nhiên từ phân bố của chính các lệnh zzz, TP = R:R × rủi ro. Chưa tính phí/trượt giá.\n- p = tỷ lệ mô phỏng ngẫu nhiên đạt hoặc vượt kết quả zzz (p nhỏ → zzz tốt hơn ngẫu nhiên). Cùng N lệnh.\n`;
const json: Record<string, unknown> = {};
for (const rr of [1, 1.5, 2]) {
  const res = runBacktest(tfS, d1S, MS[INTERVAL], { ...DEFAULT_SETTINGS, rr }, WARM, { d1Trends: d1T, tfTrends: tfT });
  const z = res.trades.filter((t) => t.result !== 'open');
  const N = z.length, zw = z.filter((t) => t.result === 'win').length, zR = zw * rr - (N - zw);
  const riskAtr = z.map((t) => Math.abs(t.entry - t.stopLoss) / atr[t.entryIdx]).filter((x) => isFinite(x));
  const Rs: number[] = [], Ws: number[] = [];
  for (let s = 0; s < SIMS; s++) {
    let w = 0, l = 0;
    for (let k = 0; k < N; k++) {
      const i = eligible[Math.floor(rnd() * eligible.length)];
      const risk = riskAtr[Math.floor(rnd() * riskAtr.length)] * atr[i];
      const r = sim(i, dir[i] as 1 | -1, risk, rr);
      if (r === 'win') w++; else if (r === 'loss') l++;
    }
    const m = w + l;
    Rs.push(w * rr - l); Ws.push(m ? w / m : 0);
  }
  const pR = Rs.filter((x) => x >= zR).length / SIMS, pW = Ws.filter((x) => x >= zw / N).length / SIMS;
  const mean = Rs.reduce((a, b) => a + b, 0) / SIMS;
  md += `\n## R:R = ${rr} (hòa vốn ${(100 / (1 + rr)).toFixed(1)}%)\n\n| | zzz | Ngẫu nhiên (trung bình) | Ngẫu nhiên 5%–95% |\n|---|---|---|---|\n| Số lệnh | ${N} | ${N} | |\n| Tỷ lệ thắng | ${(zw / N * 100).toFixed(1)}% | ${(Ws.reduce((a, b) => a + b, 0) / SIMS * 100).toFixed(1)}% | ${(q(Ws, 0.05) * 100).toFixed(1)}% – ${(q(Ws, 0.95) * 100).toFixed(1)}% |\n| Tổng R | ${zR.toFixed(1)} | ${mean.toFixed(1)} | ${q(Rs, 0.05).toFixed(1)} – ${q(Rs, 0.95).toFixed(1)} |\n| R/lệnh | ${(zR / N).toFixed(3)} | ${(mean / N).toFixed(3)} | |\n\n- p (tổng R ≥ zzz) = **${pR.toFixed(3)}**; p (tỷ lệ thắng ≥ zzz) = **${pW.toFixed(3)}**\n`;
  json[`rr${rr}`] = { N, zzzWinRate: zw / N, zzzR: zR, randomMeanR: mean, pR, pW };
}
mkdirSync('results/zzz', { recursive: true });
const TAG = SYMBOL === 'BTCUSDT' ? '' : `_${SYMBOL}`;
writeFileSync(`results/zzz/random${TAG}.md`, md);
writeFileSync(`results/zzz/random${TAG}.json`, JSON.stringify(json, null, 2));
console.log(md);

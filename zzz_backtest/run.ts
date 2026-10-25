import { writeFileSync, mkdirSync } from 'node:fs';
import { buildSeries } from './core/indicators';
import { runBacktest } from './core/backtest';
import { DEFAULT_SETTINGS } from './core/types';
import type { Candle, Trade } from './core/types';

const SYMBOL = process.env.SYMBOL ?? 'BTCUSDT';
const HOSTS = ['https://data-api.binance.vision', 'https://api.binance.com'];
const START = Date.UTC(2017, 7, 17);

async function klines(interval: string): Promise<Candle[]> {
  const out: Candle[] = [];
  let from = START;
  for (;;) {
    let rows: unknown[][] | null = null;
    for (const h of HOSTS) {
      try {
        const r = await fetch(`${h}/api/v3/klines?symbol=${SYMBOL}&interval=${interval}&startTime=${from}&limit=1000`);
        if (r.ok) { rows = (await r.json()) as unknown[][]; break; }
      } catch { /* thử host khác */ }
    }
    if (!rows) throw new Error('Không tải được nến ' + interval);
    if (!rows.length) break;
    for (const k of rows) out.push({ t: Number(k[0]), o: +(k[1] as string), h: +(k[2] as string), l: +(k[3] as string), c: +(k[4] as string), v: +(k[5] as string) });
    from = Number(rows[rows.length - 1][0]) + 1;
    if (rows.length < 1000) break;
  }
  // bỏ nến đang chạy
  const now = Date.now();
  const ms = interval === '1d' ? 86_400_000 : 14_400_000;
  return out.filter((c) => c.t + ms <= now);
}

const pct = (a: number, b: number) => (b ? ((a / b) * 100).toFixed(1) + '%' : '-');
function stat(list: Trade[], rr: number) {
  const w = list.filter((t) => t.result === 'win').length;
  const l = list.filter((t) => t.result === 'loss').length;
  const o = list.filter((t) => t.result === 'open').length;
  const total = w + l;
  const netR = w * rr - l;
  return { total, w, l, o, rate: pct(w, total), netR: +netR.toFixed(2), exp: total ? +(netR / total).toFixed(3) : 0 };
}
function maxDrawdownR(list: Trade[], rr: number) {
  let eq = 0, peak = 0, dd = 0;
  for (const t of [...list].filter((x) => x.result !== 'open').sort((a, b) => (a.exitTime ?? 0) - (b.exitTime ?? 0))) {
    eq += t.result === 'win' ? rr : -1; peak = Math.max(peak, eq); dd = Math.max(dd, peak - eq);
  }
  return +dd.toFixed(2);
}

const tf = await klines('4h');
const d1 = await klines('1d');
console.log(`4h: ${tf.length} nến (${new Date(tf[0].t).toISOString()} → ${new Date(tf[tf.length - 1].t).toISOString()}), 1d: ${d1.length}`);
const tfS = buildSeries(tf), d1S = buildSeries(d1);

let md = `# zzz (4v2) backtest ${SYMBOL} 4h\n\nDữ liệu: ${tf.length} nến 4h, ${new Date(tf[0].t).toISOString().slice(0, 10)} → ${new Date(tf[tf.length - 1].t).toISOString().slice(0, 10)}. Vào ở giá đóng cửa nến tín hiệu; SL theo nến N/M; TP = R:R × rủi ro; nến chạm cả SL lẫn TP tính thua; chưa tính phí/trượt giá.\n`;
const json: Record<string, unknown> = {};
for (const rr of [1, 1.5, 2]) {
  const cfg = { ...DEFAULT_SETTINGS, rr };
  const res = runBacktest(tfS, d1S, 14_400_000, cfg);
  const rows: string[] = [];
  const groups: Record<string, Trade[]> = {
    'Tất cả': res.trades,
    'Kênh 1 (cùng xu hướng)': res.trades.filter((t) => t.channel === 'with'),
    'Kênh 2 (ngược xu hướng)': res.trades.filter((t) => t.channel === 'counter'),
    'Mua': res.trades.filter((t) => t.direction === 'BUY'),
    'Bán': res.trades.filter((t) => t.direction === 'SELL'),
  };
  for (const [k, v] of Object.entries(groups)) {
    const s = stat(v, rr);
    rows.push(`| ${k} | ${s.total} | ${s.w} | ${s.l} | ${s.o} | ${s.rate} | ${s.netR} | ${s.exp} | ${maxDrawdownR(v, rr)} |`);
    json[`rr${rr}.${k}`] = s;
  }
  md += `\n## R:R = ${rr} (hoà vốn ở tỷ lệ thắng ${(100 / (1 + rr)).toFixed(1)}%)\n\n| Nhóm | Lệnh đóng | Thắng | Thua | Đang mở | Tỷ lệ thắng | Tổng R | R/lệnh | Sụt R tối đa |\n|---|---|---|---|---|---|---|---|---|\n${rows.join('\n')}\n`;
  const years = [...new Set(res.trades.map((t) => new Date(t.entryTime).getUTCFullYear()))].sort();
  md += `\nTheo năm (R:R ${rr}):\n\n| Năm | Lệnh | Thắng | Thua | Tỷ lệ thắng | Tổng R |\n|---|---|---|---|---|---|\n`;
  for (const y of years) {
    const s = stat(res.trades.filter((t) => new Date(t.entryTime).getUTCFullYear() === y), rr);
    md += `| ${y} | ${s.total} | ${s.w} | ${s.l} | ${s.rate} | ${s.netR} |\n`;
  }
  if (rr === 1.5) {
    mkdirSync('results', { recursive: true });
    writeFileSync('results/zzz_btc4h_trades.csv', 'channel,direction,entry_time,entry,stop,take_profit,exit_time,result\n' + res.trades.map((t) =>
      [t.channel, t.direction, new Date(t.entryTime).toISOString(), t.entry, t.stopLoss, t.takeProfit, t.exitTime ? new Date(t.exitTime).toISOString() : '', t.result].join(',')).join('\n'));
  }
}
mkdirSync('results', { recursive: true });
writeFileSync('results/zzz_btc4h.md', md);
writeFileSync('results/zzz_btc4h.json', JSON.stringify(json, null, 2));
console.log(md);

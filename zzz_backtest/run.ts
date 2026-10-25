import { readFileSync, readdirSync, writeFileSync, mkdirSync } from 'node:fs';
import { buildSeries } from './core/indicators';
import { runBacktest } from './core/backtest';
import { DEFAULT_SETTINGS } from './core/types';
import type { Candle, Settings, Trade } from './core/types';

/**
 * Phòng thử nghiệm zzz. Mỗi thử nghiệm là một file JSON trong experiments/:
 *   { name, note, symbol, interval, from, to, rr: [..], settings: { ...ghi đè Settings } }
 * Mã lõi (core/) là BẢN SAO riêng của repo này: sửa thoải mái, không ảnh hưởng website.
 * Chạy: EXPS=base,lookback-ngan npx tsx run.ts   (hoặc EXPS=all)
 */
interface Exp {
  name: string; note?: string; symbol: string; interval: string;
  from?: string; to?: string | null; rr: number[]; settings: Partial<Settings>;
}

const HOSTS = ['https://data-api.binance.vision', 'https://api.binance.com'];
const MS: Record<string, number> = {
  '1m': 60_000, '5m': 300_000, '15m': 900_000, '30m': 1_800_000, '1h': 3_600_000, '2h': 7_200_000,
  '4h': 14_400_000, '6h': 21_600_000, '12h': 43_200_000, '1d': 86_400_000,
};
const cache = new Map<string, Candle[]>();

async function klines(symbol: string, interval: string, fromMs: number): Promise<Candle[]> {
  const key = `${symbol}|${interval}|${fromMs}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const out: Candle[] = [];
  let from = fromMs;
  for (;;) {
    let rows: unknown[][] | null = null;
    for (const h of HOSTS) {
      try {
        const r = await fetch(`${h}/api/v3/klines?symbol=${symbol}&interval=${interval}&startTime=${from}&limit=1000`);
        if (r.ok) { rows = (await r.json()) as unknown[][]; break; }
      } catch { /* thử host khác */ }
    }
    if (!rows) throw new Error(`Không tải được nến ${symbol} ${interval}`);
    if (!rows.length) break;
    for (const k of rows) out.push({ t: Number(k[0]), o: +(k[1] as string), h: +(k[2] as string), l: +(k[3] as string), c: +(k[4] as string), v: +(k[5] as string) });
    from = Number(rows[rows.length - 1][0]) + 1;
    if (rows.length < 1000) break;
  }
  const now = Date.now();
  const res = out.filter((c) => c.t + MS[interval] <= now);
  cache.set(key, res);
  return res;
}

const pct = (a: number, b: number) => (b ? ((a / b) * 100).toFixed(1) + '%' : '-');
function stat(list: Trade[], rr: number) {
  const w = list.filter((t) => t.result === 'win').length;
  const l = list.filter((t) => t.result === 'loss').length;
  const o = list.filter((t) => t.result === 'open').length;
  const total = w + l, netR = w * rr - l;
  return { total, w, l, o, rate: pct(w, total), netR: +netR.toFixed(2), exp: total ? +(netR / total).toFixed(3) : 0 };
}
function maxDD(list: Trade[], rr: number) {
  let eq = 0, peak = 0, dd = 0;
  for (const t of list.filter((x) => x.result !== 'open').sort((a, b) => (a.exitTime ?? 0) - (b.exitTime ?? 0))) {
    eq += t.result === 'win' ? rr : -1; peak = Math.max(peak, eq); dd = Math.max(dd, peak - eq);
  }
  return +dd.toFixed(2);
}

const all = readdirSync('experiments').filter((f) => f.endsWith('.json')).map((f) => f.replace(/\.json$/, ''));
const want = (process.env.EXPS ?? 'all') === 'all' ? all : process.env.EXPS!.split(',').map((s) => s.trim()).filter(Boolean);
const outDir = 'results/zzz';
const TAG = (process.env.SYMBOL && process.env.SYMBOL !== 'BTCUSDT') ? `_${process.env.SYMBOL}` : '';
mkdirSync(outDir, { recursive: true });
const summary: string[] = [];

for (const name of want) {
  const exp = JSON.parse(readFileSync(`experiments/${name}.json`, 'utf8')) as Exp;
  const symbol = process.env.SYMBOL || exp.symbol;
  const interval = process.env.INTERVAL || exp.interval;
  if (!MS[interval]) throw new Error('Khung không hỗ trợ: ' + interval);
  const fromMs = exp.from ? Date.parse(exp.from) : Date.UTC(2017, 7, 17);
  const toMs = exp.to ? Date.parse(exp.to) : Infinity;
  const tfAll = await klines(symbol, interval, fromMs);
  const d1All = await klines(symbol, '1d', fromMs);
  const tf = tfAll.filter((c) => c.t <= toMs), d1 = d1All.filter((c) => c.t <= toMs);
  console.log(`[${name}] ${symbol} ${interval}: ${tf.length} nến`);
  const tfS = buildSeries(tf), d1S = buildSeries(d1);

  let md = `# Thử nghiệm: ${name}\n\n${exp.note ?? ''}\n\n- Cặp: ${symbol} · Khung: ${interval} · ${tf.length} nến (${new Date(tf[0].t).toISOString().slice(0, 10)} → ${new Date(tf[tf.length - 1].t).toISOString().slice(0, 10)})\n- Tham số ghi đè: \`${JSON.stringify(exp.settings)}\`\n- Vào ở giá đóng cửa nến tín hiệu, nến chạm cả SL và TP tính thua, chưa tính phí/trượt giá.\n`;
  const json: Record<string, unknown> = { name, symbol, interval, settings: exp.settings };
  for (const rr of exp.rr) {
    const cfg: Settings = { ...DEFAULT_SETTINGS, ...exp.settings, rr };
    const res = runBacktest(tfS, d1S, MS[interval], cfg);
    const groups: Record<string, Trade[]> = {
      'Tất cả': res.trades,
      'Kênh 1': res.trades.filter((t) => t.channel === 'with'),
      'Kênh 2': res.trades.filter((t) => t.channel === 'counter'),
      'Mua': res.trades.filter((t) => t.direction === 'BUY'),
      'Bán': res.trades.filter((t) => t.direction === 'SELL'),
    };
    const rows: string[] = [];
    for (const [k, v] of Object.entries(groups)) {
      const s = stat(v, rr);
      rows.push(`| ${k} | ${s.total} | ${s.w} | ${s.l} | ${s.o} | ${s.rate} | ${s.netR} | ${s.exp} | ${maxDD(v, rr)} |`);
      json[`rr${rr}.${k}`] = s;
    }
    md += `\n## R:R = ${rr} (hòa vốn ở ${(100 / (1 + rr)).toFixed(1)}%)\n\n| Nhóm | Lệnh đóng | Thắng | Thua | Đang mở | Tỷ lệ thắng | Tổng R | R/lệnh | Sụt R tối đa |\n|---|---|---|---|---|---|---|---|---|\n${rows.join('\n')}\n`;
    const years = [...new Set(res.trades.map((t) => new Date(t.entryTime).getUTCFullYear()))].sort();
    md += `\n| Năm | Lệnh | Thắng | Thua | Tỷ lệ thắng | Tổng R |\n|---|---|---|---|---|---|\n`;
    for (const y of years) {
      const s = stat(res.trades.filter((t) => new Date(t.entryTime).getUTCFullYear() === y), rr);
      md += `| ${y} | ${s.total} | ${s.w} | ${s.l} | ${s.rate} | ${s.netR} |\n`;
    }
    const a = stat(res.trades, rr);
    summary.push(`| ${name} | ${symbol} ${interval} | ${rr} | ${a.total} | ${a.rate} | ${a.netR} | ${a.exp} | ${maxDD(res.trades, rr)} |`);
    writeFileSync(`${outDir}/${name}${TAG}_rr${rr}_trades.csv`, 'channel,direction,entry_time,entry,stop,take_profit,exit_time,result\n' + res.trades.map((t) =>
      [t.channel, t.direction, new Date(t.entryTime).toISOString(), t.entry, t.stopLoss, t.takeProfit, t.exitTime ? new Date(t.exitTime).toISOString() : '', t.result].join(',')).join('\n'));
  }
  writeFileSync(`${outDir}/${name}${TAG}.md`, md);
  writeFileSync(`${outDir}/${name}${TAG}.json`, JSON.stringify(json, null, 2));
}

const sum = `# Tổng hợp thử nghiệm zzz\n\nCập nhật: ${new Date().toISOString()}\n\n| Thử nghiệm | Cặp/khung | R:R | Lệnh | Tỷ lệ thắng | Tổng R | R/lệnh | Sụt R |\n|---|---|---|---|---|---|---|---|\n${summary.join('\n')}\n`;
writeFileSync(`${outDir}/SUMMARY${TAG}.md`, sum);
console.log(sum);

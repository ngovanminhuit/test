import { isPivotLow } from './indicators';
import type {
  ChannelResult, Condition, Direction, Series, Settings, Trend, TrendResult,
} from './types';

/**
 * "Góc nhìn" theo hướng lệnh. Với lệnh SELL ta lật giá (nhân -1) và RSI (100 - RSI),
 * nhờ đó toàn bộ logic chỉ cần viết một lần cho lệnh BUY:
 *   đáy ↔ đỉnh, dải BB dưới ↔ dải BB trên, RSI 30 ↔ RSI 70, "cao hơn đỉnh N-1" ↔ "thấp hơn đáy M-1".
 */
interface View {
  high: number[]; // với SELL = -low
  low: number[]; // với SELL = -high
  close: number[];
  band: (number | null)[]; // BUY: BB dưới; SELL: -BB trên
  rsi: (number | null)[]; // SELL: 100 - RSI
  back: (x: number) => number; // đổi giá trị trong view về giá thật
}

function makeView(s: Series, dir: Direction): View {
  if (dir === 'BUY') {
    return { high: s.high, low: s.low, close: s.close, band: s.bbLower, rsi: s.rsi, back: (x) => x };
  }
  return {
    high: s.low.map((x) => -x),
    low: s.high.map((x) => -x),
    close: s.close.map((x) => -x),
    band: s.bbUpper.map((x) => (x === null ? null : -x)),
    rsi: s.rsi.map((x) => (x === null ? null : 100 - x)),
    back: (x) => -x,
  };
}

/** Điều kiện BB: có nến chọc ra ngoài dải (BUY: dải dưới) rồi đã có nến đóng cửa trở lại trong dải. */
function bbReentry(v: View, i: number, lookback: number) {
  const start = Math.max(1, i - lookback + 1);
  let outIdx = -1;
  for (let j = i; j >= start; j--) {
    const b = v.band[j];
    if (b !== null && v.low[j] <= b) { outIdx = j; break; }
  }
  if (outIdx === -1) return { pass: false, outIdx: -1, inIdx: -1 };
  let inIdx = -1;
  for (let k = outIdx; k <= i; k++) {
    const b = v.band[k];
    if (b !== null && v.close[k] > b) { inIdx = k; break; }
  }
  const nowInside = v.band[i] !== null && v.close[i] > (v.band[i] as number);
  return { pass: inIdx !== -1 && nowInside, outIdx, inIdx };
}

/** Nến k chạm hoặc cắt qua biên BB (BUY: dải dưới), và từ k đến i đã có nến đóng cửa trở lại trong dải. */
function touchesBandAndReturns(v: View, k: number, i: number): boolean {
  const b = v.band[k];
  if (b === null || v.low[k] > b) return false;
  for (let j = k; j <= i; j++) {
    const bj = v.band[j];
    if (bj !== null && v.close[j] > bj) return true;
  }
  return false;
}

/** Điều kiện RSI: có đoạn RSI ≤ 30 (BUY) trong cửa sổ, và hiện RSI đã trở lại trên 30. */
function rsiReturn(v: View, i: number, lookback: number, level: number) {
  const start = Math.max(1, i - lookback + 1);
  let e = -1;
  for (let j = i; j >= start; j--) {
    const r = v.rsi[j];
    if (r !== null && r <= level) { e = j; break; }
  }
  if (e === -1) return { pass: false, s: -1, e: -1, minIdx: -1 };
  let s = e;
  while (s - 1 >= start && v.rsi[s - 1] !== null && (v.rsi[s - 1] as number) <= level) s--;
  let minIdx = s;
  for (let j = s; j <= e; j++) if ((v.rsi[j] as number) < (v.rsi[minIdx] as number)) minIdx = j;
  const now = v.rsi[i];
  return { pass: e < i && now !== null && now > level, s, e, minIdx };
}

function argMinLow(v: View, from: number, to: number) {
  let idx = -1;
  for (let j = Math.max(0, from); j <= to; j++) if (idx === -1 || v.low[j] < v.low[idx]) idx = j;
  return idx;
}

const fmt = (x: number) => {
  const a = Math.abs(x);
  const d = a >= 1000 ? 2 : a >= 1 ? 4 : 6;
  return x.toLocaleString('en-US', { maximumFractionDigits: d });
};

const ago = (k: number) => (k === 0 ? 'Nến hiện tại' : `Cách đây ${k} nến, giá`);

const cond = (label: string, state: Condition['state'], detail: string): Condition => ({ label, state, detail });

export interface EvalInput {
  d1: TrendResult;
  tf: TrendResult;
  series: Series;
  i: number;
  cfg: Settings;
}

const dirOf = (t: Trend): Direction | null => (t === 'UP' ? 'BUY' : t === 'DOWN' ? 'SELL' : null);

/* ------------------------------------------------------------------ */
/* KÊNH 1 — CÙNG XU HƯỚNG                                              */
/* ------------------------------------------------------------------ */
export function evalWithTrend({ d1, tf, series, i, cfg }: EvalInput): ChannelResult {
  const dir = dirOf(d1.trend);
  const buy = dir !== 'SELL';
  const words = {
    d1: buy ? 'tăng' : 'giảm',
    band: buy ? 'dải dưới' : 'dải trên',
    rsiLv: buy ? cfg.rsiLow : cfg.rsiHigh,
    anchor: buy ? 'N' : 'M',
  };

  const c1 = cond('Biểu đồ ngày có xu hướng', dir ? 'pass' : 'fail',
    dir ? `D1 đang ${d1.trend === 'UP' ? 'tăng' : 'giảm'} (${Math.max(d1.upScore, d1.downScore)}/${d1.maxScore} điểm)` : 'D1 chưa có xu hướng rõ ràng');

  const sameTrend = dir !== null && tf.trend === d1.trend;
  const c2 = cond('Khung giao dịch cùng xu hướng D1', !dir ? 'wait' : sameTrend ? 'pass' : 'fail',
    !dir ? 'Chờ D1 có xu hướng' : sameTrend ? `Khung giao dịch cũng đang ${words.d1}` : `Khung giao dịch: ${tf.trend === 'SIDEWAYS' ? 'không có xu hướng' : tf.trend === 'UP' ? 'tăng' : 'giảm'}`);

  const base: ChannelResult = {
    id: 'with', name: 'Cùng xu hướng', direction: dir, conditions: [c1, c2], entry: cond('Nến vào lệnh', 'wait', ''),
    ready: false, passed: 0, marks: [], anchorIdx: null, triggerLevel: null, stopLoss: null,
  };

  if (!dir) {
    base.conditions.push(cond('Cắt Bollinger Band rồi đi vào trong', 'wait', 'Chờ D1 có xu hướng'));
    base.conditions.push(cond(`RSI chạm ${cfg.rsiLow}/${cfg.rsiHigh} rồi quay lại`, 'wait', 'Chờ D1 có xu hướng'));
    base.entry = cond('Nến vào lệnh', 'wait', 'Chờ D1 có xu hướng');
    return finalize(base);
  }

  const v = makeView(series, dir);
  const bb = bbReentry(v, i, cfg.lookbackWith);
  const rs = rsiReturn(v, i, cfg.lookbackWith, buy ? cfg.rsiLow : 100 - cfg.rsiHigh);

  base.conditions.push(cond('Cắt Bollinger Band rồi đi vào trong', bb.pass ? 'pass' : 'fail',
    bb.pass ? `${ago(i - bb.outIdx)} chọc ${words.band}, đã đóng cửa trở lại trong dải`
      : bb.outIdx >= 0 ? `Đã chọc ${words.band} nhưng giá chưa quay vào trong` : `Chưa chạm ${words.band} trong ${cfg.lookbackWith} nến`));

  base.conditions.push(cond(`RSI ${buy ? '≤' : '≥'} ${words.rsiLv} rồi đi lại theo D1`, rs.pass ? 'pass' : 'fail',
    rs.pass ? `RSI về ${fmt(series.rsi[rs.minIdx] as number)} rồi quay lại ${buy ? 'trên' : 'dưới'} ${words.rsiLv} (hiện ${fmt(series.rsi[i] as number)})`
      : rs.e >= 0 ? `RSI vẫn đang ở vùng ${buy ? 'quá bán' : 'quá mua'}` : `RSI chưa chạm ${words.rsiLv} trong ${cfg.lookbackWith} nến`));

  // Nến N (BUY) = nến có râu thấp nhất của nhịp điều chỉnh; M (SELL) = nến có râu cao nhất
  const events = [bb.outIdx, rs.s].filter((x) => x >= 0);
  if (events.length === 0) {
    base.entry = cond('Nến vào lệnh', 'wait', 'Chưa có nhịp điều chỉnh để xác định nến ' + words.anchor);
    return finalize(base);
  }
  const from = Math.min(...events) - cfg.pivotLeft;
  const N = argMinLow(v, from, i - 1);
  if (N < 1) {
    base.entry = cond('Nến vào lệnh', 'wait', 'Không đủ dữ liệu trước nến ' + words.anchor);
    return finalize(base);
  }
  const trigger = v.high[N - 1];
  const ok = v.close[i] > trigger;
  const realTrigger = v.back(trigger);
  base.anchorIdx = N;
  base.triggerLevel = realTrigger;
  base.stopLoss = v.back(v.low[N]);
  base.marks.push({ idx: N, price: v.back(v.low[N]), label: words.anchor, side: buy ? 'below' : 'above' });
  base.entry = cond('Nến vào lệnh', ok ? 'pass' : 'fail',
    `Nến ${words.anchor} có râu ${buy ? 'thấp' : 'cao'} nhất ${fmt(v.back(v.low[N]))}. Giá hiện tại ${fmt(series.close[i])} ${ok ? (buy ? '>' : '<') : (buy ? '≤' : '≥')} ${buy ? 'đỉnh' : 'đáy'} nến ${words.anchor}-1 (${fmt(realTrigger)})`);
  return finalize(base);
}

/* ------------------------------------------------------------------ */
/* KÊNH 2 — NGƯỢC XU HƯỚNG (khung giao dịch đi ngược / đi ngang)        */
/* ------------------------------------------------------------------ */
export function evalCounterTrend({ d1, tf, series, i, cfg }: EvalInput): ChannelResult {
  const dir = dirOf(d1.trend);
  const buy = dir !== 'SELL';
  const w = {
    band: buy ? 'dải dưới' : 'dải trên',
    rsiLv: buy ? cfg.rsiLow : cfg.rsiHigh,
    pt: buy ? 'đáy' : 'đỉnh',
    Pt: buy ? 'Đáy' : 'Đỉnh',
    anchor: buy ? 'N' : 'M',
  };

  const c1 = cond('Biểu đồ ngày có xu hướng', dir ? 'pass' : 'fail',
    dir ? `D1 đang ${d1.trend === 'UP' ? 'tăng' : 'giảm'} (${Math.max(d1.upScore, d1.downScore)}/${d1.maxScore} điểm)` : 'D1 chưa có xu hướng rõ ràng');

  const notSame = dir !== null && tf.trend !== d1.trend;
  const c2 = cond('Khung giao dịch đi ngang hoặc ngược D1', !dir ? 'wait' : notSame ? 'pass' : 'fail',
    !dir ? 'Chờ D1 có xu hướng'
      : notSame ? (tf.trend === 'SIDEWAYS' ? 'Khung giao dịch không có xu hướng' : `Khung giao dịch đang ${tf.trend === 'UP' ? 'tăng' : 'giảm'}, ngược D1`)
        : 'Khung giao dịch đang cùng xu hướng D1 (thuộc kênh 1)');

  const base: ChannelResult = {
    id: 'counter', name: 'Ngược xu hướng', direction: dir, conditions: [c1, c2], entry: cond('Nến vào lệnh', 'wait', ''),
    ready: false, passed: 0, marks: [], anchorIdx: null, triggerLevel: null, stopLoss: null,
  };

  if (!dir) {
    base.conditions.push(cond('Cắt Bollinger Band rồi đi vào trong', 'wait', 'Chờ D1 có xu hướng'));
    base.conditions.push(cond('RSI tạo đáy/đỉnh 1, giá tạo đáy/đỉnh 2', 'wait', 'Chờ D1 có xu hướng'));
    base.entry = cond('Nến vào lệnh', 'wait', 'Chờ D1 có xu hướng');
    return finalize(base);
  }

  const v = makeView(series, dir);
  const bb = bbReentry(v, i, cfg.lookbackCounter);
  base.conditions.push(cond('Cắt Bollinger Band rồi đi vào trong', bb.pass ? 'pass' : 'fail',
    bb.pass ? `${ago(i - bb.outIdx)} chọc ${w.band}, đã đóng cửa trở lại trong dải`
      : bb.outIdx >= 0 ? `Đã chọc ${w.band} nhưng giá chưa quay vào trong` : `Chưa chạm ${w.band} trong ${cfg.lookbackCounter} nến`));

  // Điểm 1: nến cực trị quanh đoạn RSI quá bán/quá mua
  const rs = rsiReturn(v, i, cfg.lookbackCounter, buy ? cfg.rsiLow : 100 - cfg.rsiHigh);
  const label4 = `RSI ${buy ? '≤' : '≥'} ${w.rsiLv} tạo ${w.pt} 1, rồi có ${w.pt} 2 ${buy ? 'cao' : 'thấp'} hơn (cách ≥ ${cfg.minGap} nến), ${w.pt} 2 chạm hoặc cắt qua ${w.band} rồi quay lại trong dải`;
  if (!rs.pass) {
    base.conditions.push(cond(label4, 'fail',
      rs.e >= 0 ? `RSI vẫn đang ở vùng ${buy ? 'quá bán' : 'quá mua'}, chưa hình thành ${w.pt} 1` : `RSI chưa chạm ${w.rsiLv} trong ${cfg.lookbackCounter} nến`));
    base.entry = cond('Nến vào lệnh', 'wait', `Chờ ${w.pt} số 2`);
    return finalize(base);
  }
  const p1 = argMinLow(v, rs.s - cfg.pivotLeft, Math.min(i, rs.e + cfg.pivotRight));
  base.marks.push({ idx: p1, price: v.back(v.low[p1]), label: `${w.Pt} 1`, side: buy ? 'below' : 'above' });

  // Cấu trúc: sau điểm 1 giá không được phá điểm 1
  let broken = false;
  for (let j = p1 + 1; j <= i; j++) if (v.low[j] <= v.low[p1]) { broken = true; break; }

  // Điểm 2: pivot gần nhất sau điểm 1, cách ≥ minGap nến, cao hơn điểm 1 (BUY)
  let p2 = -1;
  if (!broken) {
    for (let k = i - cfg.pivotRight; k >= p1 + cfg.minGap; k--) {
      if (isPivotLow(v.low, k, cfg.pivotLeft, cfg.pivotRight, i) && v.low[k] > v.low[p1] && touchesBandAndReturns(v, k, i)) { p2 = k; break; }
    }
  }

  if (broken) {
    base.conditions.push(cond(label4, 'fail', `Giá đã phá ${w.pt} 1 (${fmt(v.back(v.low[p1]))}), cấu trúc không còn hợp lệ`));
    base.entry = cond('Nến vào lệnh', 'wait', `Chờ cấu trúc ${w.pt} mới`);
    return finalize(base);
  }
  if (p2 === -1) {
    base.conditions.push(cond(label4, 'fail',
      `${w.Pt} 1 tại ${fmt(v.back(v.low[p1]))}, chưa có ${w.pt} 2 ${buy ? 'cao' : 'thấp'} hơn, cách ≥ ${cfg.minGap} nến, chạm hoặc cắt qua ${w.band} rồi quay lại trong dải`));
    base.entry = cond('Nến vào lệnh', 'wait', `Chờ ${w.pt} số 2`);
    return finalize(base);
  }

  base.marks.push({ idx: p2, price: v.back(v.low[p2]), label: `${w.Pt} 2`, side: buy ? 'below' : 'above' });
  base.conditions.push(cond(label4, 'pass',
    `${w.Pt} 1 ${fmt(v.back(v.low[p1]))} → ${w.pt} 2 ${fmt(v.back(v.low[p2]))}, cách nhau ${p2 - p1} nến`));

  const N = p2;
  const trigger = v.high[N - 1];
  const ok = v.close[i] > trigger;
  base.anchorIdx = N;
  base.triggerLevel = v.back(trigger);
  base.stopLoss = v.back(v.low[N]);
  base.entry = cond('Nến vào lệnh', ok ? 'pass' : 'fail',
    `${w.anchor} = râu ${w.pt} 2. Giá hiện tại ${fmt(series.close[i])} ${ok ? (buy ? '>' : '<') : (buy ? '≤' : '≥')} ${buy ? 'đỉnh' : 'đáy'} nến ${w.anchor}-1 (${fmt(v.back(trigger))})`);
  return finalize(base);
}

function finalize(r: ChannelResult): ChannelResult {
  r.passed = r.conditions.filter((c) => c.state === 'pass').length + (r.entry.state === 'pass' ? 1 : 0);
  r.ready = r.passed === 5;
  return r;
}

export function evaluateChannels(input: EvalInput) {
  return { with: evalWithTrend(input), counter: evalCounterTrend(input) };
}


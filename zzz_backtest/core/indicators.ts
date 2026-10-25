import type { Candle, Series } from './types';

type Num = number | null;

export function sma(values: number[], period: number): Num[] {
  const out: Num[] = new Array(values.length).fill(null);
  let sum = 0;
  for (let i = 0; i < values.length; i++) {
    sum += values[i];
    if (i >= period) sum -= values[i - period];
    if (i >= period - 1) out[i] = sum / period;
  }
  return out;
}

export function ema(values: number[], period: number): Num[] {
  const out: Num[] = new Array(values.length).fill(null);
  if (values.length < period) return out;
  const k = 2 / (period + 1);
  let seed = 0;
  for (let i = 0; i < period; i++) seed += values[i];
  let prev = seed / period;
  out[period - 1] = prev;
  for (let i = period; i < values.length; i++) {
    prev = (values[i] - prev) * k + prev;
    out[i] = prev;
  }
  return out;
}

/** RSI theo phương pháp làm mượt Wilder (giống TradingView). */
export function rsi(values: number[], period = 14): Num[] {
  const out: Num[] = new Array(values.length).fill(null);
  if (values.length <= period) return out;
  let gain = 0;
  let loss = 0;
  for (let i = 1; i <= period; i++) {
    const d = values[i] - values[i - 1];
    if (d > 0) gain += d;
    else loss -= d;
  }
  let avgGain = gain / period;
  let avgLoss = loss / period;
  const calc = () => (avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss));
  out[period] = calc();
  for (let i = period + 1; i < values.length; i++) {
    const d = values[i] - values[i - 1];
    avgGain = (avgGain * (period - 1) + (d > 0 ? d : 0)) / period;
    avgLoss = (avgLoss * (period - 1) + (d < 0 ? -d : 0)) / period;
    out[i] = calc();
  }
  return out;
}

export function bollinger(values: number[], period = 20, mult = 2) {
  const upper: Num[] = new Array(values.length).fill(null);
  const mid: Num[] = new Array(values.length).fill(null);
  const lower: Num[] = new Array(values.length).fill(null);
  for (let i = period - 1; i < values.length; i++) {
    let sum = 0;
    for (let j = i - period + 1; j <= i; j++) sum += values[j];
    const m = sum / period;
    let sq = 0;
    for (let j = i - period + 1; j <= i; j++) sq += (values[j] - m) ** 2;
    const sd = Math.sqrt(sq / period);
    mid[i] = m;
    upper[i] = m + mult * sd;
    lower[i] = m - mult * sd;
  }
  return { upper, mid, lower };
}

/** Hồi quy tuyến tính trên đoạn [end-len+1, end]. slope tính theo % giá mỗi nến. */
export function linearRegression(values: number[], end: number, len: number) {
  const start = Math.max(0, end - len + 1);
  const n = end - start + 1;
  if (n < 10) return null;
  let sx = 0, sy = 0, sxy = 0, sxx = 0, syy = 0;
  for (let k = 0; k < n; k++) {
    const y = values[start + k];
    sx += k; sy += y; sxy += k * y; sxx += k * k; syy += y * y;
  }
  const den = n * sxx - sx * sx;
  if (den === 0) return null;
  const slope = (n * sxy - sx * sy) / den;
  const intercept = (sy - slope * sx) / n;
  const rNum = n * sxy - sx * sy;
  const rDen = Math.sqrt(den * (n * syy - sy * sy));
  const r2 = rDen === 0 ? 0 : (rNum / rDen) ** 2;
  const meanY = sy / n;
  return { slope, intercept, r2, slopePct: meanY ? (slope / meanY) * 100 : 0, start, n };
}

/** Kênh hồi quy tuyến tính ±2σ cho `len` nến cuối — chỉ để vẽ. */
export function regressionChannel(values: number[], len = 120) {
  const n = values.length;
  const mid: Num[] = new Array(n).fill(null);
  const up: Num[] = new Array(n).fill(null);
  const lo: Num[] = new Array(n).fill(null);
  const lr = linearRegression(values, n - 1, len);
  if (!lr) return { mid, upper: up, lower: lo };
  let sq = 0;
  for (let k = 0; k < lr.n; k++) sq += (values[lr.start + k] - (lr.intercept + lr.slope * k)) ** 2;
  const sd = Math.sqrt(sq / lr.n);
  for (let k = 0; k < lr.n; k++) {
    const v = lr.intercept + lr.slope * k;
    mid[lr.start + k] = v;
    up[lr.start + k] = v + 2 * sd;
    lo[lr.start + k] = v - 2 * sd;
  }
  return { mid, upper: up, lower: lo };
}

/**
 * Đáy pivot tại k: thấp hơn hẳn `left` nến bên trái và `right` nến bên phải.
 * `end` là chỉ số nến cuối cùng được phép "nhìn thấy" (tránh nhìn trước tương lai khi backtest).
 */
export function isPivotLow(low: number[], k: number, left: number, right: number, end: number): boolean {
  if (k - left < 0 || k + right > end) return false;
  for (let j = k - left; j <= k + right; j++) {
    if (j !== k && low[j] <= low[k]) return false;
  }
  return true;
}

export function isPivotHigh(high: number[], k: number, left: number, right: number, end: number): boolean {
  if (k - left < 0 || k + right > end) return false;
  for (let j = k - left; j <= k + right; j++) {
    if (j !== k && high[j] >= high[k]) return false;
  }
  return true;
}

/** smaFast/smaSlow: chu kỳ hai đường xu hướng (mặc định 64/128). Trường vẫn tên sma64/sma128 để không đổi phần còn lại. */
export function buildSeries(candles: Candle[], smaFast = 64, smaSlow = 128): Series {
  const open = candles.map((c) => c.o);
  const high = candles.map((c) => c.h);
  const low = candles.map((c) => c.l);
  const close = candles.map((c) => c.c);
  const bb = bollinger(close, 20, 2);
  return {
    candles,
    open,
    high,
    low,
    close,
    ema20: ema(close, 20),
    sma64: sma(close, smaFast),
    sma128: sma(close, smaSlow),
    rsi: rsi(close, 14),
    bbUpper: bb.upper,
    bbMid: bb.mid,
    bbLower: bb.lower,
  };
}

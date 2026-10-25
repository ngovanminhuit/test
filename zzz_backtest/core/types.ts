/** Một cây nến OHLCV. t = thời điểm mở nến (ms). */
export interface Candle {
  t: number;
  o: number;
  h: number;
  l: number;
  c: number;
  v: number;
}

export type Trend = 'UP' | 'DOWN' | 'SIDEWAYS';
export type Direction = 'BUY' | 'SELL';
export type ChannelId = 'with' | 'counter';
export type CondState = 'pass' | 'fail' | 'wait';

/** Chuỗi chỉ báo đã tính sẵn cho một khung thời gian. */
export interface Series {
  candles: Candle[];
  open: number[];
  high: number[];
  low: number[];
  close: number[];
  ema20: (number | null)[];
  sma64: (number | null)[];
  sma128: (number | null)[];
  rsi: (number | null)[];
  bbUpper: (number | null)[];
  bbMid: (number | null)[];
  bbLower: (number | null)[];
}

export interface TrendCriterion {
  key: string;
  label: string;
  weight: number;
  /** +1 ủng hộ tăng, -1 ủng hộ giảm, 0 trung tính, null = thiếu dữ liệu */
  vote: 1 | -1 | 0 | null;
  /** Số điểm tiêu chí này cộng cho phe tăng / phe giảm (tối đa `weight` tổng cộng) */
  up: number;
  down: number;
  note: string;
}

export interface TrendResult {
  trend: Trend;
  upScore: number;
  downScore: number;
  maxScore: number;
  criteria: TrendCriterion[];
}

export interface Condition {
  label: string;
  state: CondState;
  detail: string;
}

/** Điểm đánh dấu trên biểu đồ (đáy 1, đáy 2, nến N...). */
export interface ChartMark {
  idx: number;
  price: number;
  label: string;
  side: 'above' | 'below';
}

export interface ChannelResult {
  id: ChannelId;
  name: string;
  direction: Direction | null;
  conditions: Condition[]; // 4 điều kiện
  entry: Condition; // điều kiện "nến vào lệnh"
  ready: boolean; // đủ 4 điều kiện + nến vào lệnh
  passed: number; // số điều kiện đạt (0..5)
  marks: ChartMark[];
  anchorIdx: number | null; // chỉ số nến N / M / đáy 2 / đỉnh 2
  triggerLevel: number | null; // đỉnh N-1 hoặc đáy M-1
  stopLoss: number | null;
}

export interface Settings {
  rr: number; // tỉ lệ lợi nhuận / rủi ro khi backtest
  lookbackWith: number; // số nến quét sự kiện BB/RSI cho kênh cùng xu hướng
  lookbackCounter: number; // số nến quét cho kênh ngược xu hướng
  minGap: number; // khoảng cách tối thiểu giữa đáy/đỉnh 1 và 2
  pivotLeft: number;
  pivotRight: number;
  rsiLow: number;
  rsiHigh: number;
}

export const DEFAULT_SETTINGS: Settings = {
  rr: 1.5,
  lookbackWith: 40,
  lookbackCounter: 80,
  minGap: 9,
  pivotLeft: 3,
  pivotRight: 2,
  rsiLow: 30,
  rsiHigh: 70,
};

export interface Trade {
  channel: ChannelId;
  direction: Direction;
  entryIdx: number;
  entryTime: number;
  entry: number;
  stopLoss: number;
  takeProfit: number;
  exitIdx: number | null;
  exitTime: number | null;
  result: 'win' | 'loss' | 'open';
}

export interface ChannelStats {
  total: number; // lệnh đã đóng
  wins: number;
  losses: number;
  open: number;
  winRate: number; // %
  netR: number; // tổng lợi nhuận tính theo R
}

export interface BacktestResult {
  trades: Trade[];
  byChannel: Record<ChannelId, ChannelStats>;
  all: ChannelStats;
}

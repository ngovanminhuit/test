import { evaluateChannels } from './channels';
import { trendAt } from './trend';
import type {
  BacktestResult, ChannelId, ChannelStats, Series, Settings, Trade, TrendResult,
} from './types';

const DAY = 86_400_000;

/**
 * Backtest không nhìn trước tương lai:
 *  - Xu hướng D1 tại một nến khung giao dịch chỉ dùng các nến ngày ĐÃ ĐÓNG trước khi nến đó đóng.
 *  - Mọi pivot/đáy/đỉnh chỉ dùng dữ liệu tới nến đang xét.
 *  - Vào lệnh ở giá đóng cửa nến tín hiệu, SL = râu nến N/M (hoặc đáy/đỉnh 2), TP = rr × rủi ro.
 *  - Nếu một nến chạm cả SL và TP, tính là thua (giả định thận trọng).
 *  - Mỗi kênh chỉ giữ 1 lệnh tại một thời điểm, mỗi nến N/M chỉ được dùng 1 lần.
 */
/** pre: xu hướng tính sẵn (không phụ thuộc tham số kênh) để quét tham số nhanh. */
export function runBacktest(tf: Series, d1: Series, tfMs: number, cfg: Settings, warmup = 130, pre?: { d1Trends: TrendResult[]; tfTrends: TrendResult[] }): BacktestResult {
  const n = tf.close.length;
  const d1Trends: TrendResult[] = pre?.d1Trends ?? d1.close.map((_, k) => trendAt(d1, k));
  const trades: Trade[] = [];
  const busyUntil: Record<ChannelId, number> = { with: -1, counter: -1 };
  const usedAnchor: Record<ChannelId, Set<number>> = { with: new Set(), counter: new Set() };

  let dPtr = -1;
  for (let i = Math.min(warmup, n); i < n - 1; i++) {
    const barClose = tf.candles[i].t + tfMs;
    while (dPtr + 1 < d1.candles.length && d1.candles[dPtr + 1].t + DAY <= barClose) dPtr++;
    if (dPtr < 0) continue;

    const d1t = d1Trends[dPtr];
    if (d1t.trend === 'SIDEWAYS') continue; // cả 2 kênh đều cần D1 có xu hướng
    const tft = pre?.tfTrends[i] ?? trendAt(tf, i);
    const res = evaluateChannels({ d1: d1t, tf: tft, series: tf, i, cfg });

    for (const ch of [res.with, res.counter]) {
      if (!ch.ready || ch.anchorIdx === null || ch.stopLoss === null || !ch.direction) continue;
      if (i <= busyUntil[ch.id] || usedAnchor[ch.id].has(ch.anchorIdx)) continue;
      const entry = tf.close[i];
      const buy = ch.direction === 'BUY';
      const risk = buy ? entry - ch.stopLoss : ch.stopLoss - entry;
      if (!(risk > 0)) continue;
      const tp = buy ? entry + cfg.rr * risk : entry - cfg.rr * risk;
      const t: Trade = {
        channel: ch.id, direction: ch.direction, entryIdx: i, entryTime: tf.candles[i].t,
        entry, stopLoss: ch.stopLoss, takeProfit: tp, exitIdx: null, exitTime: null, result: 'open',
      };
      for (let j = i + 1; j < n; j++) {
        const hitSL = buy ? tf.low[j] <= ch.stopLoss : tf.high[j] >= ch.stopLoss;
        const hitTP = buy ? tf.high[j] >= tp : tf.low[j] <= tp;
        if (hitSL || hitTP) {
          t.result = hitSL ? 'loss' : 'win';
          t.exitIdx = j;
          t.exitTime = tf.candles[j].t;
          break;
        }
      }
      usedAnchor[ch.id].add(ch.anchorIdx);
      busyUntil[ch.id] = t.exitIdx ?? n;
      trades.push(t);
    }
  }

  const stats = (list: Trade[]): ChannelStats => {
    const wins = list.filter((t) => t.result === 'win').length;
    const losses = list.filter((t) => t.result === 'loss').length;
    const open = list.filter((t) => t.result === 'open').length;
    const total = wins + losses;
    return { total, wins, losses, open, winRate: total ? (wins / total) * 100 : 0, netR: wins * cfg.rr - losses };
  };

  return {
    trades,
    byChannel: {
      with: stats(trades.filter((t) => t.channel === 'with')),
      counter: stats(trades.filter((t) => t.channel === 'counter')),
    },
    all: stats(trades),
  };
}

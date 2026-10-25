import type { Series, TrendCriterion, TrendResult } from './types';

/**
 * Xu hướng tại nến i (chỉ dùng dữ liệu <= i) theo MỘT điều kiện duy nhất, được 2/2 điểm khi thỏa:
 *   SMA64 > SMA128 → tăng (UP);  SMA64 < SMA128 → giảm (DOWN);  bằng nhau hoặc chưa đủ 128 nến → đi ngang.
 */
export const TREND_WEIGHTS = { maOrder: 2 } as const;

const position = (a: number, b: number): string => (a > b ? 'nằm trên' : a < b ? 'nằm dưới' : 'bằng');

export function trendAt(s: Series, i: number): TrendResult {
  const W = TREND_WEIGHTS.maOrder;
  const m64 = s.sma64[i], m128 = s.sma128[i];
  const label = 'SMA64 so với SMA128';
  let criterion: TrendCriterion;
  if (m64 !== null && m128 !== null) {
    const vote: 1 | -1 | 0 = m64 > m128 ? 1 : m64 < m128 ? -1 : 0;
    criterion = {
      key: 'maOrder', label, weight: W, vote, up: vote === 1 ? W : 0, down: vote === -1 ? W : 0,
      note: `SMA64 ${position(m64, m128)} SMA128`,
    };
  } else {
    criterion = { key: 'maOrder', label, weight: W, vote: null, up: 0, down: 0, note: 'Cần ít nhất 128 nến' };
  }
  const trend: TrendResult['trend'] = criterion.up ? 'UP' : criterion.down ? 'DOWN' : 'SIDEWAYS';
  return { trend, upScore: criterion.up, downScore: criterion.down, maxScore: W, criteria: [criterion] };
}

export const TREND_LABEL: Record<TrendResult['trend'], string> = {
  UP: 'Xu hướng tăng',
  DOWN: 'Xu hướng giảm',
  SIDEWAYS: 'Không có xu hướng',
};

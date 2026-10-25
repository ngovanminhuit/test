# Khai phá quy luật vào lệnh · huấn luyện BTC 4h → kiểm tra BTC → thử SUIUSDT 4h

- Hướng lệnh = hướng D1. SL = 1,5 ATR, TP = 1.5 × SL (hòa vốn ở 40% trước phí). Phí khứ hồi 0.1% (đã trừ vào R). Không chồng lệnh. Nến chạm cả SL và TP = thua.
- Huấn luyện BTC: trước 2023-01-01; kiểm tra BTC: từ ngày đó; **SUIUSDT không dùng để chọn quy luật** (chỉ để thử cuối).
- Số quy luật thử: 9936 (1–2 điều kiện, ngưỡng theo phân vị 20/40/60/80% của huấn luyện BTC).

## Đường cơ sở (vào mọi tín hiệu theo hướng D1, không điều kiện)

| Tập | Lệnh | R/lệnh | t | Thắng% |
|---|---|---|---|---|
| BTC huấn luyện | 871 | -0.016 | -0.37 | 40.8 |
| BTC kiểm tra | 741 | -0.091 | -2.02 | 38.5 |
| SUIUSDT | 599 | -0.045 | -0.90 | 39.1 |

## Phễu lọc

- Quy luật đủ lệnh huấn luyện (≥60): 9595
- Có R/lệnh ròng > 0 và t ≥ 2 ở huấn luyện: 152 (kỳ vọng do may mắn thuần túy với 9595 phép thử: khoảng 219)
- Trong đó vẫn > 0 ở BTC kiểm tra (≥15 lệnh): 102
- Trong đó vẫn > 0 trên SUIUSDT (≥10 lệnh): 65

## Top 15 theo huấn luyện (xem kiểm tra và SUIUSDT)

| Quy luật | HL lệnh | HL R/lệnh | HL t | KT lệnh | KT R/lệnh | SUIUSDT lệnh | SUIUSDT R/lệnh | SUIUSDT thắng% |
|---|---|---|---|---|---|---|---|---|
| pullback20 >= 1.45 & ret20 >= 2.59 | 136 | 0.345 | 3.2 | 107 | 0.047 | 83 | 0.033 | 42 |
| sma_gap >= 4.99 & bb_width <= 6.39 | 72 | 0.460 | 3.2 | 34 | 0.061 | 31 | 0.022 | 42 |
| dist_sma128 >= 4.41 & close_pos <= 0.243 | 124 | 0.339 | 3.0 | 85 | 0.040 | 78 | 0.068 | 44 |
| dist_sma64 >= 2.86 & close_pos <= 0.243 | 141 | 0.314 | 3.0 | 99 | -0.064 | 77 | 0.146 | 47 |
| sma_gap >= 4.99 & range_atr <= 0.599 | 111 | 0.347 | 2.9 | 34 | 0.065 | 121 | -0.049 | 39 |
| rsi >= 62.5 & vol_rel >= 1.33 | 256 | 0.223 | 2.8 | 207 | 0.034 | 153 | 0.039 | 42 |
| rsi >= 54.5 & bb_pos <= 0.644 | 175 | 0.266 | 2.8 | 116 | -0.082 | 104 | 0.035 | 42 |
| rsi >= 62.5 & bb_width <= 13.8 | 280 | 0.210 | 2.8 | 235 | 0.052 | 112 | 0.201 | 49 |
| sma_gap >= 4.99 & ret6 <= -1.07 | 103 | 0.334 | 2.7 | 26 | 0.212 | 98 | -0.075 | 38 |
| dist_sma64 >= 2.86 & atr_pct <= 2.86 | 232 | 0.222 | 2.7 | 180 | 0.074 | 62 | 0.140 | 47 |
| sma_gap >= 4.99 & vol_rel <= 0.615 | 95 | 0.343 | 2.7 | 31 | 0.091 | 123 | -0.085 | 37 |
| rsi >= 62.5 & range_atr >= 0.94 | 317 | 0.186 | 2.7 | 226 | 0.009 | 184 | -0.030 | 40 |
| dist_sma64 >= 2.86 & sma_gap <= 4.99 | 207 | 0.231 | 2.7 | 170 | 0.051 | 88 | 0.140 | 47 |
| rsi >= 54.5 & ret6 <= -0.247 | 203 | 0.232 | 2.6 | 116 | -0.018 | 115 | 0.021 | 42 |
| dist_sma64 >= 2.86 & pullback20 >= 1.45 | 116 | 0.306 | 2.6 | 90 | 0.063 | 64 | 0.269 | 52 |

## Quy luật sống sót qua BTC kiểm tra (chọn tiếp theo t huấn luyện)

| Quy luật | HL lệnh | HL R/lệnh | HL t | KT lệnh | KT R/lệnh | SUIUSDT lệnh | SUIUSDT R/lệnh | SUIUSDT thắng% |
|---|---|---|---|---|---|---|---|---|
| pullback20 >= 1.45 & ret20 >= 2.59 | 136 | 0.345 | 3.2 | 107 | 0.047 | 83 | 0.033 | 42 |
| sma_gap >= 4.99 & bb_width <= 6.39 | 72 | 0.460 | 3.2 | 34 | 0.061 | 31 | 0.022 | 42 |
| dist_sma128 >= 4.41 & close_pos <= 0.243 | 124 | 0.339 | 3.0 | 85 | 0.040 | 78 | 0.068 | 44 |
| sma_gap >= 4.99 & range_atr <= 0.599 | 111 | 0.347 | 2.9 | 34 | 0.065 | 121 | -0.049 | 39 |
| rsi >= 62.5 & vol_rel >= 1.33 | 256 | 0.223 | 2.8 | 207 | 0.034 | 153 | 0.039 | 42 |
| rsi >= 62.5 & bb_width <= 13.8 | 280 | 0.210 | 2.8 | 235 | 0.052 | 112 | 0.201 | 49 |
| sma_gap >= 4.99 & ret6 <= -1.07 | 103 | 0.334 | 2.7 | 26 | 0.212 | 98 | -0.075 | 38 |
| dist_sma64 >= 2.86 & atr_pct <= 2.86 | 232 | 0.222 | 2.7 | 180 | 0.074 | 62 | 0.140 | 47 |
| sma_gap >= 4.99 & vol_rel <= 0.615 | 95 | 0.343 | 2.7 | 31 | 0.091 | 123 | -0.085 | 37 |
| rsi >= 62.5 & range_atr >= 0.94 | 317 | 0.186 | 2.7 | 226 | 0.009 | 184 | -0.030 | 40 |
| dist_sma64 >= 2.86 & sma_gap <= 4.99 | 207 | 0.231 | 2.7 | 170 | 0.051 | 88 | 0.140 | 47 |
| dist_sma64 >= 2.86 & pullback20 >= 1.45 | 116 | 0.306 | 2.6 | 90 | 0.063 | 64 | 0.269 | 52 |
| ret20 >= 2.59 & close_pos <= 0.243 | 176 | 0.244 | 2.6 | 122 | 0.054 | 102 | -0.091 | 37 |
| vol_rel >= 1.33 & ret20 >= 2.59 | 235 | 0.209 | 2.6 | 177 | 0.049 | 133 | 0.049 | 43 |
| rsi <= 62.5 & dist_sma64 >= 2.86 | 115 | 0.295 | 2.5 | 73 | 0.046 | 64 | 0.149 | 47 |

## Thử cuối trên SUIUSDT: quy luật tốt nhất sau lọc BTC

`pullback20 >= 1.45 & ret20 >= 2.59`

- Lệnh: 83, R ròng/lệnh 0.033, t 0.24, thắng 42.2% (hòa vốn ~40% + phí).
- Đối chứng ngẫu nhiên (cùng số lệnh, 10.000 lần): p = 0.228. Số quy luật sống sót qua BTC: 102 → ngưỡng Bonferroni cho bước này ≈ 0.0005.
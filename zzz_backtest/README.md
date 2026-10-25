# Phòng thử nghiệm zzz (4v2)

Thư mục này là **bản sao riêng** của lõi phân tích trang zzz (`websitefreetools/src/stock/core`). Sửa ở đây không ảnh hưởng website. Khi ưng ý, đem phần thay đổi về repo website.

## Quy trình
1. **Đổi tham số:** thêm file `experiments/<tên>.json` (xem `base.json`). Ghi đè được `rr`, `lookbackWith`, `lookbackCounter`, `minGap`, `pivotLeft`, `pivotRight`, `rsiLow`, `rsiHigh`, cặp, khung, khoảng ngày.
2. **Đổi luật (xu hướng, kênh, điều kiện vào lệnh):** sửa trực tiếp `core/trend.ts`, `core/channels.ts`, `core/backtest.ts` rồi push.
3. **Chạy:** push lên `main` (tự chạy) hoặc Actions → *zzz thu nghiem* → Run workflow (nhập tên thử nghiệm, hoặc `all`).
4. **Xem kết quả:** `results/zzz/SUMMARY.md` (so sánh các thử nghiệm), `results/zzz/<tên>.md` (chi tiết theo kênh, hướng, năm), `results/zzz/<tên>_rr<R>_trades.csv` (từng lệnh).

## Chạy trên máy
```
cd zzz_backtest && npm install
EXPS=base npx tsx run.ts
```
(Nến lấy từ `data-api.binance.vision`.)

## Lưu ý đọc kết quả
- Vào lệnh ở giá đóng cửa nến tín hiệu, chưa tính phí, trượt giá, funding.
- Nến chạm cả SL và TP trong cùng một cây tính là thua.
- Ít lệnh thì sai số lớn; chỉnh nhiều lần trên cùng dữ liệu dễ bị khớp quá mức quá khứ. Nên giữ lại một giai đoạn (ví dụ từ 2024) không dùng để chỉnh, chỉ để kiểm tra cuối.

# BTC Infotrade – 100 node

Mô hình chấm điểm 100 node thông tin dự báo chiều 2 phiên BTC tiếp theo.
Giá trị node = **W × M × D** (W: trọng số −1000…1000, M: mức độ 0.01…1, D: hướng tin ±1).

## Chạy trên GitHub Actions
Tab **Actions → Huan luyen infotrade → Run workflow**. Workflow cũng tự chạy khi đẩy code lên `main`.

Workflow sẽ tự động:
1. Tải dữ liệu từ các nguồn miễn phí vào `data/`.
2. Lọc mẫu nến 2 phiên cùng chiều có tổng biến động ≥ 5%, rồi huấn luyện W và kiểm tra walk-forward theo năm.
3. Chấm điểm ngày gần nhất.
4. Ghi kết quả vào `results/`:
   - `train.log`
   - `score.log`
   - `weights_trained.csv`
   - `Infotrade_100_Node_BTC_trained.xlsx`

Tùy chọn: thêm secret `FRED_API_KEY` (đăng ký miễn phí tại fred.stlouisfed.org) để lấy CPI, PCE, PPI, NFP, GDP… đúng ngày công bố.

## Nguồn tự động
| Nhóm | Nguồn |
|---|---|
| Thị trường | Binance, Yahoo Finance, Coinbase, Upbit, Deribit |
| Vĩ mô | FRED |
| Dòng tiền ETF | Farside |
| Stablecoin | DefiLlama |
| On-chain | mempool.space, Blockchain.com, bitcoin-data.com |
| Tâm lý | alternative.me |
| Node định tính (hack, SEC, chiến tranh, thuế quan…) | GDELT – đo đột biến khối lượng và giọng điệu tin tức |

Các node không có lịch sử miễn phí (thanh lý, long/short, dòng nạp/rút sàn, cá voi…) giữ nguyên W khởi tạo.
Có thể bổ sung dữ liệu cho chúng qua `manual_dm.csv` / `manual_raw.csv`.

## Chạy trên máy
```
pip install -r requirements.txt
python infotrade.py fetch
python infotrade.py train
python infotrade.py score
```

> Đây là mô hình tham khảo, không phải khuyến nghị đầu tư.

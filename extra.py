"""
extra.py - Nguồn dữ liệu tự động bổ sung cho infotrade.py (không cần nhập tay).

Nguồn:
  FRED API (cần biến môi trường FRED_API_KEY, miễn phí) : CPI, Core CPI, Core PCE, PPI, NFP,
      thất nghiệp, đơn trợ cấp, GDP, bán lẻ, M2 - đúng NGÀY CÔNG BỐ (vintage), so với kỳ trước
  FRED csv (không cần key)  : lãi suất mục tiêu Fed (node 1, ngày công bố)
  GDELT DOC API             : khối lượng & giọng điệu tin tức cho node định tính
  Coinbase / Upbit / Yahoo  : Coinbase premium, Kimchi premium, stablecoin mất peg
  Deribit                   : DVOL
  Farside                   : dòng tiền ETF BTC / ETH
  Blockchain.com, bitcoin-data.com : địa chỉ hoạt động, phí, MVRV-Z, SOPR, NUPL
  Tính toán                 : halving, hash ribbons
"""
import hashlib, io, os, time, datetime as dt
import numpy as np
import pandas as pd

# ------------------------------------------------------------------ cấu hình
# Thang (ngưỡng 5 bậc) cho node mà đơn vị tự động khác bảng Excel
EXTRA_TH = {
    1: [5, 10, 25, 50, 75],              # thay đổi lãi suất mục tiêu (bp)
    9: [25, 50, 100, 150, 200],          # NFP tăng tốc (nghìn việc làm)
    11: [5, 10, 20, 30, 40],             # đơn trợ cấp thay đổi (nghìn)
    35: [0.02, 0.05, 0.1, 0.2, 0.3],     # Coinbase premium (%)
    44: [1, 2, 3, 5, 8],                 # Kimchi premium (%)
    52: [2, 4, 7, 10, 15],               # DVOL thay đổi (điểm)
    65: [2, 3, 4, 5, 7],                 # MVRV Z-score
    66: [0.01, 0.02, 0.03, 0.05, 0.07],  # 1 - SOPR
    67: [0.1, 0.15, 0.2, 0.3, 0.35],     # NUPL - 0.4
    70: [5, 10, 20, 30, 50],             # địa chỉ hoạt động % so TB30
    71: [20, 50, 100, 200, 300],         # phí % so TB30
    87: [0.3, 0.5, 1, 3, 5],             # lệch peg (%)
    97: [0.5, 1, 1.5, 2, 3],             # z-score giọng điệu tin bitcoin
}
GDELT_Z = [1, 2, 3, 4, 5]  # z-score khối lượng tin -> 5 bậc

# node: (truy vấn GDELT, kiểu, hệ số dấu giọng điệu)
#   "vol"  : chỉ đo đột biến khối lượng tin, D = +1
#   "both" : đột biến khối lượng x dấu giọng điệu (tone tốt = hệ số)
#   "tone" : chỉ đo giọng điệu (z-score)
GDELT_Q = {
    3: ('Powell "interest rates"', "both", -1),
    26: ("Nvidia earnings", "both", 1),
    29: ('"Bank of Japan" "rate hike"', "vol", 1),
    30: ("China stimulus", "vol", 1),
    36: ("MicroStrategy bitcoin", "vol", 1),
    37: ('bitcoin (pension OR "sovereign wealth")', "vol", 1),
    73: ("SEC crypto", "both", 1),
    74: ("crypto bill (Congress OR Senate)", "both", 1),
    75: ('"bitcoin reserve"', "vol", 1),
    76: ('("White House" OR president) crypto', "both", 1),
    77: ("tariff", "vol", 1),
    78: ("China crypto ban", "vol", 1),
    80: ('bitcoin "legal tender"', "vol", 1),
    82: ("(war OR missile OR airstrike OR invasion)", "vol", 1),
    83: ('"government shutdown"', "vol", 1),
    84: ("crypto tax", "vol", 1),
    85: ("(hack OR hacked OR exploit) crypto", "vol", 1),
    86: ("crypto exchange (bankruptcy OR insolvency OR withdrawals)", "vol", 1),
    88: ("(gox OR FTX) (repayment OR creditors)", "vol", 1),
    90: ("bitcoin ETF", "vol", 1),
    91: ("bank bitcoin", "vol", 1),
    93: ("bitcoin (vulnerability OR bug)", "vol", 1),
    94: ("accept bitcoin payment", "vol", 1),
    96: ("bitcoin", "vol", 1),
    97: ("bitcoin", "tone", 1),
    100: ("bitcoin (rumor OR rumors)", "both", 1),
}

# node: (series FRED, kiểu biến đổi)
MACRO = {
    5: ("CPIAUCSL", "mom_acc"), 6: ("CPILFESL", "mom_acc"), 7: ("PCEPILFE", "mom_acc"),
    8: ("PPIFIS", "mom_acc"), 9: ("PAYEMS", "diff_acc"), 10: ("UNRATE", "diff"),
    11: ("ICSA", "diff_k"), 12: ("GDPC1", "qoq_acc"), 14: ("RSAFS", "mom_acc"),
    32: ("M2SL", "mom"),
}

HALVINGS = ["2016-07-09", "2020-05-11", "2024-04-20", "2028-04-15"]


def slug(q):
    return hashlib.md5(q.encode()).hexdigest()[:10]


# ------------------------------------------------------------------ fetch
def fetch_all(get, save, log):
    steps = [("FRED lãi suất Fed", fetch_fed_target), ("FRED vĩ mô theo ngày công bố", fetch_macro),
             ("Coinbase", fetch_coinbase), ("Upbit", fetch_upbit), ("Yahoo bổ sung", fetch_yf_extra),
             ("Deribit DVOL", fetch_dvol), ("Farside ETF", fetch_farside),
             ("Blockchain.com", fetch_blockchain), ("bitcoin-data.com", fetch_bitcoin_data),
             ("GDELT tin tức (~15 phút)", fetch_gdelt)]
    for name, fn in steps:
        log(f"Tải {name} ...")
        try:
            fn(get, save, log)
        except Exception as e:
            log(f"  ! Lỗi {name}: {e}")


def fetch_fed_target(get, save, log):
    r = get("https://fred.stlouisfed.org/graph/fredgraph.csv", params={"id": "DFEDTARU"})
    df = pd.read_csv(io.StringIO(r.text))
    df.columns = ["date", "value"]
    df["value"] = pd.to_numeric(df["value"], errors="coerce")
    save(df.dropna(), "DFEDTARU")


def _fred_obs(get, sid, key):
    rows, off = [], 0
    while True:
        js = get("https://api.stlouisfed.org/fred/series/observations",
                 params=dict(series_id=sid, api_key=key, file_type="json",
                             realtime_start="2016-01-01", realtime_end="9999-12-31",
                             observation_start="2013-01-01", limit=100000, offset=off)).json()
        obs = js.get("observations", [])
        rows += obs
        off += len(obs)
        if not obs or off >= int(js.get("count", 0)):
            break
    df = pd.DataFrame(rows)
    df["value"] = pd.to_numeric(df["value"], errors="coerce")
    return df.dropna(subset=["value"])


def macro_transform(df, kind):
    """Từ bảng vintage FRED -> chuỗi (ngày công bố, số thô) chỉ tại các lần công bố số mới."""
    rs = df["realtime_start"].values.astype(str)
    re_ = df["realtime_end"].values.astype(str)
    dates = df["date"].values.astype(str)
    vals = df["value"].values.astype(float)
    out, last_max = [], ""
    for v in sorted(set(rs)):
        if v < "2016-06-01":
            continue
        m = (rs <= v) & (re_ >= v)
        if m.sum() < 3:
            continue
        d, x = dates[m], vals[m]
        o = np.argsort(d)
        d, x = d[o], x[o]
        if d[-1] <= last_max:
            last_max = max(last_max, d[-1])
            continue  # chỉ là điều chỉnh số cũ
        last_max = d[-1]
        a0, a1, a2 = x[-1], x[-2], x[-3]
        if kind == "mom_acc":
            val = ((a0 / a1 - 1) - (a1 / a2 - 1)) * 100
        elif kind == "diff_acc":
            val = (a0 - a1) - (a1 - a2)
        elif kind == "diff":
            val = a0 - a1
        elif kind == "diff_k":
            val = (a0 - a1) / 1000
        elif kind == "qoq_acc":
            val = (((a0 / a1) ** 4 - 1) - ((a1 / a2) ** 4 - 1)) * 100
        else:  # mom
            val = (a0 / a1 - 1) * 100
        out.append((v, val))
    return pd.DataFrame(out, columns=["date", "value"])


def fetch_macro(get, save, log):
    key = os.environ.get("FRED_API_KEY", "").strip()
    if not key:
        log("  - Bỏ qua: chưa có FRED_API_KEY (miễn phí tại fred.stlouisfed.org)")
        return
    for nid, (sid, kind) in MACRO.items():
        try:
            df = _fred_obs(get, sid, key)
            save(macro_transform(df, kind), f"macro_{nid}")
        except Exception as e:
            log(f"  ! {sid}: {e}")


def fetch_coinbase(get, save, log):
    rows, start = [], dt.datetime(2017, 8, 1)
    end_all = dt.datetime.utcnow()
    while start < end_all:
        end = min(start + dt.timedelta(days=299), end_all)
        js = get("https://api.exchange.coinbase.com/products/BTC-USD/candles",
                 params=dict(granularity=86400, start=start.isoformat(), end=end.isoformat())).json()
        rows += js if isinstance(js, list) else []
        start = end + dt.timedelta(days=1)
        time.sleep(0.4)
    df = pd.DataFrame(rows, columns=["t", "low", "high", "open", "close", "volume"])
    df["date"] = pd.to_datetime(df["t"], unit="s").dt.strftime("%Y-%m-%d")
    save(df[["date", "close"]].rename(columns={"close": "value"}).drop_duplicates("date"), "coinbase")


def fetch_upbit(get, save, log):
    rows, to = [], None
    for _ in range(30):
        p = dict(market="KRW-BTC", count=200)
        if to:
            p["to"] = to
        js = get("https://api.upbit.com/v1/candles/days", params=p).json()
        if not js:
            break
        rows += js
        to = js[-1]["candle_date_time_utc"].replace("T", " ")
        if js[-1]["candle_date_time_utc"] < "2017-10-01":
            break
        time.sleep(0.3)
    df = pd.DataFrame(rows)
    df["date"] = df["candle_date_time_utc"].str[:10]
    save(df[["date", "trade_price"]].rename(columns={"trade_price": "value"}).drop_duplicates("date"), "upbit")


def fetch_yf_extra(get, save, log):
    import yfinance as yf
    for key, tk in {"usdkrw": "KRW=X", "usdt_px": "USDT-USD", "usdc_px": "USDC-USD"}.items():
        try:
            df = yf.download(tk, start="2017-01-01", progress=False, auto_adjust=False)
            if isinstance(df.columns, pd.MultiIndex):
                df.columns = df.columns.get_level_values(0)
            save(pd.DataFrame({"date": pd.to_datetime(df.index).strftime("%Y-%m-%d"),
                               "value": df["Close"].values}), key)
        except Exception as e:
            log(f"  ! {tk}: {e}")


def fetch_dvol(get, save, log):
    rows = []
    end = int(time.time() * 1000)
    start = int(dt.datetime(2021, 3, 1).timestamp() * 1000)
    while end > start:
        js = get("https://www.deribit.com/api/v2/public/get_volatility_index_data",
                 params=dict(currency="BTC", start_timestamp=start, end_timestamp=end,
                             resolution="1D")).json()["result"]
        data = js.get("data", [])
        if not data:
            break
        rows += data
        nxt = js.get("continuation")
        if not nxt or nxt >= end:
            break
        end = nxt
        time.sleep(0.3)
    df = pd.DataFrame(rows, columns=["t", "open", "high", "low", "close"])
    df["date"] = pd.to_datetime(df["t"], unit="ms").dt.strftime("%Y-%m-%d")
    save(df[["date", "close"]].rename(columns={"close": "value"}).drop_duplicates("date"), "dvol")


def _farside(get, url):
    html = get(url, headers={"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
                             "AppleWebKit/537.36 Chrome/124 Safari/537.36"}).text
    best = None
    for t in pd.read_html(io.StringIO(html)):
        if t.shape[1] > 3 and t.shape[0] > 20:
            best = t
            break
    if best is None:
        raise ValueError("không thấy bảng dữ liệu")
    if isinstance(best.columns, pd.MultiIndex):
        best.columns = [" ".join(map(str, c)) for c in best.columns]
    d = pd.to_datetime(best.iloc[:, 0], format="%d %b %Y", errors="coerce")
    tot = best.iloc[:, -1].astype(str).str.replace(",", "").str.strip()
    neg = tot.str.startswith("(")
    v = pd.to_numeric(tot.str.strip("()"), errors="coerce")
    v[neg] = -v[neg]
    df = pd.DataFrame({"date": d.dt.strftime("%Y-%m-%d"), "value": v}).dropna()
    return df


def fetch_farside(get, save, log):
    for key, url in {"etf_btc": "https://farside.co.uk/bitcoin-etf-flow-all-data/",
                     "etf_eth": "https://farside.co.uk/ethereum-etf-flow-all-data/"}.items():
        try:
            save(_farside(get, url), key)
        except Exception as e:
            log(f"  ! {key}: {e}")


def fetch_blockchain(get, save, log):
    for key, chart in {"addresses": "n-unique-addresses", "fees": "transaction-fees-usd"}.items():
        try:
            js = get(f"https://api.blockchain.info/charts/{chart}",
                     params=dict(timespan="all", format="json", sampled="false")).json()
            df = pd.DataFrame(js["values"])
            df["date"] = pd.to_datetime(df["x"], unit="s").dt.strftime("%Y-%m-%d")
            save(df[["date", "y"]].rename(columns={"y": "value"}), key)
        except Exception as e:
            log(f"  ! {chart}: {e}")


def fetch_bitcoin_data(get, save, log):
    for key, ep in {"mvrvz": "mvrv-zscore", "sopr": "sopr", "nupl": "nupl"}.items():
        try:
            js = get(f"https://bitcoin-data.com/v1/{ep}").json()
            df = pd.DataFrame(js)
            dcol = next(c for c in ("d", "date", "day", "theDay") if c in df.columns)
            vcol = next(c for c in df.columns if c not in (dcol, "unixTs", "timestamp")
                        and pd.to_numeric(df[c], errors="coerce").notna().mean() > 0.5)
            out = pd.DataFrame({"date": pd.to_datetime(df[dcol]).dt.strftime("%Y-%m-%d"),
                                "value": pd.to_numeric(df[vcol], errors="coerce")}).dropna()
            save(out, key)
        except Exception as e:
            log(f"  ! {ep}: {e}")
        time.sleep(2)


def _gdelt_series(get, query, mode, log):
    parts = []
    now = dt.datetime.utcnow()
    for y0 in range(2017, now.year + 1, 3):
        a = dt.datetime(y0, 1, 1)
        b = min(dt.datetime(y0 + 2, 12, 31, 23, 59, 59), now)
        for attempt in range(4):
            try:
                r = get("https://api.gdeltproject.org/api/v2/doc/doc",
                        params=dict(query=query, mode=mode, format="json",
                                    startdatetime=a.strftime("%Y%m%d%H%M%S"),
                                    enddatetime=b.strftime("%Y%m%d%H%M%S")))
                js = r.json() if r.text.strip().startswith("{") else {}
                tl = js.get("timeline", [])
                if tl:
                    df = pd.DataFrame(tl[0]["data"])
                    df["date"] = pd.to_datetime(df["date"], format="%Y%m%dT%H%M%SZ").dt.strftime("%Y-%m-%d")
                    parts.append(df.groupby("date", as_index=False)["value"].mean())
                break
            except Exception as e:
                if attempt == 3:
                    log(f"    ! GDELT '{query}' {y0}: {e}")
                time.sleep(10 * (attempt + 1))
        time.sleep(5.5)  # giới hạn 1 truy vấn / 5 giây
    if not parts:
        return None
    return pd.concat(parts).drop_duplicates("date", keep="last")


def fetch_gdelt(get, save, log):
    done = set()
    for nid, (q, kind, _) in GDELT_Q.items():
        modes = {"vol": ["timelinevol"], "both": ["timelinevol", "timelinetone"],
                 "tone": ["timelinetone"]}[kind]
        for mode in modes:
            k = f"gdelt_{mode}_{slug(q)}"
            if k in done:
                continue
            done.add(k)
            df = _gdelt_series(get, q, mode, log)
            if df is not None:
                save(df, k)
            else:
                log(f"  ! GDELT không có dữ liệu: {q} ({mode})")


# ------------------------------------------------------------------ đặc trưng
def _zscore(s, win=30):
    s = s.resample("D").mean().fillna(0) if len(s) else s
    m = s.rolling(win, min_periods=10).mean().shift(1)
    sd = s.rolling(win, min_periods=10).std().shift(1)
    return (s - m) / sd.replace(0, np.nan)


def _pct_vs_mean(s, win=30):
    s = s.resample("D").mean().interpolate()
    return (s / s.rolling(win, min_periods=10).mean().shift(1) - 1) * 100


def raw_extra(series, btc):
    """Trả (raw: node -> số thô có dấu, direct: node -> D*M đã tính sẵn)."""
    raw, direct = {}, {}

    s = series("DFEDTARU")
    if s is not None:
        ch = s.diff() * 100
        ch = ch[ch != 0].dropna()
        ch.index = ch.index - pd.Timedelta(days=1)  # hiệu lực ngày sau buổi họp
        raw[1] = ch

    for nid in MACRO:
        s = series(f"macro_{nid}")
        if s is not None:
            raw[nid] = s

    bn = btc["close"]
    cb = series("coinbase")
    if cb is not None:
        raw[35] = (cb / bn.reindex(cb.index) - 1) * 100
    up, krw = series("upbit"), series("usdkrw")
    if up is not None and krw is not None:
        full = pd.date_range(up.index.min(), up.index.max())
        k = krw.reindex(full).ffill()
        raw[44] = (up / (k.reindex(up.index) * bn.reindex(up.index)) - 1) * 100

    dv = series("dvol")
    if dv is not None:
        raw[52] = dv.diff()

    for nid, key in [(33, "etf_btc"), (34, "etf_eth")]:
        s = series(key)
        if s is not None:
            raw[nid] = s

    s = series("mvrvz")
    if s is not None:
        raw[65] = s
    s = series("sopr")
    if s is not None:
        raw[66] = 1 - s
    s = series("nupl")
    if s is not None:
        raw[67] = s - 0.4
    s = series("addresses")
    if s is not None:
        raw[70] = _pct_vs_mean(s)
    s = series("fees")
    if s is not None:
        raw[71] = _pct_vs_mean(s)

    pegs = [x for x in (series("usdt_px"), series("usdc_px")) if x is not None]
    if pegs:
        raw[87] = (pd.concat(pegs, axis=1) - 1).abs().max(axis=1) * 100

    # GDELT
    for nid, (q, kind, sign) in GDELT_Q.items():
        vol = series(f"gdelt_timelinevol_{slug(q)}")
        tone = series(f"gdelt_timelinetone_{slug(q)}")
        if kind == "tone":
            if tone is not None:
                raw[nid] = _zscore(tone) * sign
            continue
        if vol is None:
            continue
        z = _zscore(vol).clip(lower=0)
        m = pd.Series(np.interp(z.fillna(0), [0] + GDELT_Z, [0, 0.1, 0.3, 0.5, 0.75, 1.0]),
                      index=z.index)
        if kind == "both":
            if tone is None:
                continue
            t = tone.resample("D").mean()
            dev = (t - t.rolling(30, min_periods=10).mean().shift(1)).reindex(m.index)
            m = m * np.sign(dev).fillna(0) * sign
        direct[nid] = m

    # halving: số ngày tới lần halving kế tiếp
    days = pd.date_range("2017-01-01", "2029-01-01")
    hv = pd.to_datetime(HALVINGS)
    left = pd.Series([(hv[hv >= d].min() - d).days if (hv >= d).any() else 9999 for d in days],
                     index=days)
    direct[89] = pd.Series(np.select([left == 0, left <= 7, left <= 30, left <= 90, left <= 180],
                                     [1.0, 0.75, 0.5, 0.3, 0.1], 0.0), index=days)

    # hash ribbons: MA30 cắt MA60 của hashrate
    hr = series("hashrate")
    if hr is not None:
        h = hr.resample("D").mean().interpolate()
        a, b = h.rolling(30).mean(), h.rolling(60).mean()
        cu = (a > b) & (a.shift(1) <= b.shift(1))
        cd = (a < b) & (a.shift(1) >= b.shift(1))
        direct[64] = pd.Series(np.select([cu, cd], [0.5, -0.5], 0.0), index=h.index)

    return raw, direct
